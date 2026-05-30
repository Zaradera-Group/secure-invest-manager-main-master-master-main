import { z } from "zod";
import { adminSupabase } from "../lib/supabase.js";
import { sendPlainEmail } from "../lib/email.js";
import { env } from "../config/env.js";
import { verifyTurnstileToken } from "../lib/turnstile.js";
import { createPublicIntakeConsentToken, verifyPublicIntakeConsentToken } from "../lib/public-intake-consent.js";
import { sendPlainSms } from "../lib/sms.js";
import {
  createOtpExpiryDate,
  generatePublicIntakeOtpCode,
  getOtpMaxAttempts,
  hashPublicIntakeOtpCode,
  isOtpAttemptsExceeded,
  isOtpConsumed,
  isOtpExpired,
  normalizeOtp,
  verifyPublicIntakeOtpCode,
} from "../lib/public-intake-otp.js";

const publicInvestorIntakeSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  investmentAmount: z.coerce.number().positive(),
  startDate: z.string().min(1),
  tenure: z.coerce.number().int().positive(),
  investmentType: z.enum(["Upfront", "Monthly", "Quarterly", "At Maturity"]),
  clientAccountNumber: z.string().min(4),
  clientBank: z.string().min(2),
  broughtBy: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.enum(["Male", "Female", "Other"]).optional().nullable(),
  occupation: z.string().optional().nullable(),
  sourceOfFunds: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  nextOfKinName: z.string().optional().nullable(),
  nextOfKinPhone: z.string().optional().nullable(),
  nextOfKinRelationship: z.string().optional().nullable(),
  currencyCode: z.string().trim().length(3).optional(),
  investorCategory: z.string().optional(),
  categoryReferenceName: z.string().optional().nullable(),
  categoryReferenceEmail: z.string().email().optional().nullable(),
  categoryNotes: z.string().optional().nullable(),
  turnstileToken: z.string().min(1),
  website: z.string().optional().nullable(),
  percentage: z.coerce.number().positive().optional().nullable(),
  consentToken: z.string().min(1),
});

type PublicInvestorIntakeInput = z.infer<typeof publicInvestorIntakeSchema>;

type IntakeRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export async function createPublicInvestorIntake(payload: unknown, context: IntakeRequestContext = {}) {
  const input = publicInvestorIntakeSchema.parse(payload);

  if (input.website?.trim()) {
    throw new Error("Spam protection was triggered");
  }

  await verifyTurnstileToken(input.turnstileToken, context.ip ?? null);
  verifyPublicIntakeConsentToken(input.consentToken, input.phone);

  const assigneeUserId = env.PUBLIC_INTAKE_ASSIGNEE_USER_ID;

  if (!assigneeUserId) {
    throw new Error("Public intake is not configured. Set PUBLIC_INTAKE_ASSIGNEE_USER_ID.");
  }

  const assigneeEmail = await resolveAssigneeEmail(assigneeUserId, env.PUBLIC_INTAKE_NOTIFY_EMAIL);
  const normalizedCurrencyCode = (input.currencyCode ?? "NGN").trim().toUpperCase();
  const maturityDate = calculateMaturityDate(input.startDate, input.tenure);

  const categoryReferenceEmail = input.categoryReferenceEmail?.trim()
    ? input.categoryReferenceEmail.trim().toLowerCase()
    : null;

  const intakeRecord = {
    submitted_by_name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    date_of_birth: input.dateOfBirth?.trim() || null,
    gender: input.gender ?? null,
    address: input.address?.trim() || null,
    investment_amount: input.investmentAmount,
    start_date: input.startDate,
    maturity_date: maturityDate,
    tenure: input.tenure,
    percentage: input.percentage ?? null,
    investment_type: input.investmentType,
    client_account_number: input.clientAccountNumber.trim(),
    client_bank: input.clientBank.trim(),
    brought_by: input.broughtBy?.trim() || "Self",
    currency_code: normalizedCurrencyCode,
    occupation: input.occupation?.trim() || null,
    source_of_funds: input.sourceOfFunds?.trim() || null,
    next_of_kin_name: input.nextOfKinName?.trim() || null,
    next_of_kin_phone: input.nextOfKinPhone?.trim() || null,
    next_of_kin_relationship: input.nextOfKinRelationship?.trim() || null,
    investor_category: input.investorCategory?.trim() || "nw",
    category_reference_name: input.categoryReferenceName?.trim() || null,
    category_reference_email: categoryReferenceEmail,
    category_notes: input.categoryNotes?.trim() || null,
    assigned_user_id: assigneeUserId,
    assigned_email: assigneeEmail,
    status: "submitted",
    submitted_ip: context.ip ?? null,
    submitted_user_agent: context.userAgent ?? null,
  };

  const { data: requestRecord, error } = await adminSupabase
    .from("public_intake_requests")
    .insert(intakeRecord)
    .select("*")
    .single();

  if (error || !requestRecord) {
    throw new Error(`Failed to create public intake request: ${error?.message ?? "Unknown error"}`);
  }

  const requestId = requestRecord.id as string;
  const recipients = await resolveNotificationRecipients({
    assigneeEmail,
    submitterEmail: input.email.trim().toLowerCase(),
  });

  await adminSupabase.from("notifications").insert({
    user_role: "manager",
    recipient_user_id: assigneeUserId,
    recipient_email: assigneeEmail ?? null,
    title: "New public investor intake",
    detail: `${input.name.trim()} submitted an external investor intake form for review.`,
    message: `${input.name.trim()} submitted an external investor intake form for review.`,
    action_path: "/public-intake-inbox",
    is_read: false,
  });

  const deliveryResults = await Promise.allSettled(
    recipients.map((recipient) =>
      sendPlainEmail(
        recipient,
        `New public investor intake: ${input.name.trim()}`,
        buildPublicIntakeEmailHtml({
          investor: input,
          requestId,
          maturityDate,
        }),
      ),
    ),
  );

  const failedDeliveries = deliveryResults.filter((result) => result.status === "rejected");
  if (failedDeliveries.length > 0) {
    console.warn("[public-intake] One or more email deliveries failed:", failedDeliveries.length);
  }

  return {
    requestId,
    assigneeEmail,
  };
}

export async function sendPublicIntakeOtp(payload: unknown) {
  const schema = z.object({
    phone: z.string().min(7),
    email: z.string().email().optional().nullable(),
  });

  const input = schema.parse(payload);
  const codeTarget = normalizePhoneNumber(input.phone);
  const emailTarget = input.email?.trim().toLowerCase() ?? null;
  assertOtpConfigured();

  const otpCode = generatePublicIntakeOtpCode();
  const codeHash = hashPublicIntakeOtpCode(otpCode);
  const expiresAt = createOtpExpiryDate();

  await adminSupabase
    .from("public_intake_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("phone", codeTarget)
    .is("consumed_at", null);

  const { error: insertError } = await adminSupabase.from("public_intake_otp_codes").insert({
    phone: codeTarget,
    email: emailTarget,
    code_hash: codeHash,
    attempt_count: 0,
    max_attempts: getOtpMaxAttempts(),
    expires_at: expiresAt,
  });

  if (insertError) {
    throw new Error(`Failed to create OTP record: ${insertError.message}`);
  }

  const deliveryTasks: Promise<unknown>[] = [];
  const channels: string[] = [];

  if (canSendPublicIntakeSms()) {
    deliveryTasks.push(
      sendPlainSms(
        codeTarget,
        `Your Zaradera public intake verification code is ${otpCode}. It expires in 10 minutes.`,
      ),
    );
    channels.push("sms");
  }

  if (emailTarget && canSendPublicIntakeEmail()) {
    deliveryTasks.push(
      sendPlainEmail(
        emailTarget,
        "Your Zaradera public intake verification code",
        buildOtpEmailHtml(otpCode),
      ),
    );
    channels.push("email");
  }

  if (deliveryTasks.length === 0) {
    throw new Error("No OTP delivery channel is configured");
  }

  const deliveryResults = await Promise.allSettled(deliveryTasks);
  const failedDeliveries = deliveryResults.filter((result) => result.status === "rejected");
  if (failedDeliveries.length > 0) {
    throw new Error("Failed to deliver verification code");
  }

  return {
    message: channels.includes("email") && channels.includes("sms")
      ? "Verification code sent to phone and email"
      : channels.includes("email")
        ? "Verification code sent to email"
        : "Verification code sent to phone",
  };
}

export async function verifyPublicIntakeOtp(payload: unknown) {
  const schema = z.object({
    phone: z.string().min(7),
    code: z.string().min(4).max(10),
  });

  const input = schema.parse(payload);
  const codeTarget = normalizePhoneNumber(input.phone);
  assertOtpConfigured();
  const normalizedCode = normalizeOtp(input.code);

  const { data: record, error } = await adminSupabase
    .from("public_intake_otp_codes")
    .select("*")
    .eq("phone", codeTarget)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!record) {
    throw new Error("No active verification code was found");
  }

  const typedRecord = record as {
    id: string;
    phone: string;
    email: string | null;
    code_hash: string;
    attempt_count: number;
    max_attempts: number;
    expires_at: string;
    consumed_at: string | null;
    created_at: string;
  };

  if (isOtpExpired(typedRecord)) {
    throw new Error("Verification code has expired");
  }

  if (isOtpConsumed(typedRecord)) {
    throw new Error("Verification code has already been used");
  }

  if (isOtpAttemptsExceeded(typedRecord)) {
    throw new Error("Verification attempts exceeded");
  }

  const matches = verifyPublicIntakeOtpCode(normalizedCode, typedRecord);

  if (!matches) {
    await adminSupabase
      .from("public_intake_otp_codes")
      .update({ attempt_count: typedRecord.attempt_count + 1 })
      .eq("id", typedRecord.id);
    throw new Error("Verification failed");
  }

  await adminSupabase
    .from("public_intake_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", typedRecord.id);

  return {
    message: "Phone number verified",
    consentToken: createPublicIntakeConsentToken(codeTarget),
  };
}

async function resolveAssigneeEmail(assigneeUserId: string, fallbackEmail?: string | null) {
  if (fallbackEmail) {
    return fallbackEmail;
  }

  const { data, error } = await adminSupabase.auth.admin.listUsers();
  if (error) {
    throw error;
  }

  return data.users.find((user) => user.id === assigneeUserId)?.email?.trim() ?? null;
}

async function resolveNotificationRecipients(args: {
  assigneeEmail: string | null;
  submitterEmail: string;
}) {
  const managerEmails = await resolveEmailsByRoles(["general_manager", "super_admin"]);
  const recipients = new Set<string>();

  if (args.assigneeEmail) {
    recipients.add(args.assigneeEmail.trim().toLowerCase());
  }

  for (const email of managerEmails) {
    recipients.add(email.trim().toLowerCase());
  }

  recipients.add(args.submitterEmail.trim().toLowerCase());

  return Array.from(recipients).filter(Boolean);
}

async function resolveEmailsByRoles(roles: Array<"general_manager" | "super_admin">) {
  const { data: userRoles, error: rolesError } = await adminSupabase
    .from("user_roles")
    .select("user_id, role");

  if (rolesError) {
    throw rolesError;
  }

  const targetUserIds = new Set(
    (userRoles ?? [])
      .filter((row) => roles.includes(row.role as "general_manager" | "super_admin"))
      .map((row) => row.user_id as string),
  );

  if (targetUserIds.size === 0) {
    return [] as string[];
  }

  const { data, error } = await adminSupabase.auth.admin.listUsers();
  if (error) {
    throw error;
  }

  return data.users
    .filter((user) => targetUserIds.has(user.id))
    .map((user) => user.email?.trim())
    .filter((email): email is string => !!email);
}

function calculateMaturityDate(startDate: string, tenure: number) {
  const date = new Date(startDate);
  date.setMonth(date.getMonth() + tenure);
  return date.toISOString().split("T")[0];
}

function normalizePhoneNumber(phone: string) {
  return phone.trim().replace(/\s+/g, "");
}

function assertOtpConfigured() {
  if (!env.PUBLIC_INTAKE_CONSENT_TOKEN_SECRET) {
    throw new Error("Public intake OTP is not configured");
  }
}

function canSendPublicIntakeSms() {
  return Boolean(
    env.SMS_DELIVERY_ENABLED
    && env.TWILIO_ACCOUNT_SID
    && env.TWILIO_AUTH_TOKEN
    && (env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_FROM_NUMBER),
  );
}

function canSendPublicIntakeEmail() {
  return Boolean(env.EMAIL_DELIVERY_ENABLED && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

function buildOtpEmailHtml(code: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 12px;">Verify Your Public Intake</h2>
      <p>Your verification code is:</p>
      <div style="font-size: 28px; letter-spacing: 0.2em; font-weight: 700; margin: 16px 0;">${code}</div>
      <p>This code expires in 10 minutes and can only be used once.</p>
    </div>
  `;
}

function buildPublicIntakeEmailHtml(args: {
  investor: PublicInvestorIntakeInput;
  requestId: string;
  maturityDate: string;
}) {
  const appUrl = env.APP_URL?.replace(/\/$/, "") ?? "";
  const inboxLink = `${appUrl}/public-intake-inbox`;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 12px;">New Public Investor Intake</h2>
      <p><strong>Request ID:</strong> ${escapeHtml(args.requestId)}</p>
      <p><strong>Name:</strong> ${escapeHtml(args.investor.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(args.investor.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(args.investor.phone)}</p>
      <p><strong>Amount:</strong> ${args.investor.investmentAmount.toLocaleString()}</p>
      <p><strong>Type:</strong> ${escapeHtml(args.investor.investmentType)}</p>
      <p><strong>Maturity Date:</strong> ${escapeHtml(args.maturityDate)}</p>
      <p><strong>Action:</strong> Review, copy, and convert this request into an investor record manually.</p>
      <p><strong>Open Inbox:</strong> <a href="${inboxLink}">${inboxLink}</a></p>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
