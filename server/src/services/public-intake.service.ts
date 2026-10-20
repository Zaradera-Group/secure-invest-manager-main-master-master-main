import { z } from "zod";
import { adminSupabase } from "../lib/supabase.js";
import { canSendEmail, sendPlainEmail } from "../lib/email.js";
import { env } from "../config/env.js";
import { verifyTurnstileToken } from "../lib/turnstile.js";
import { createPublicIntakeConsentToken, verifyPublicIntakeConsentToken } from "../lib/public-intake-consent.js";
import {
  deletePublicIntakeRequestFromMongoSafely,
  mirrorPublicIntakeRequestToMongoSafely,
} from "../repositories/public-intake.mongo.js";
import type { AuthenticatedUser } from "../types/certificates.js";
import { mirrorNotificationToMongoSafely } from "../repositories/notifications.mongo.js";
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
  investmentType: z.enum(["Monthly", "Quarterly", "At Maturity"]),
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
  verifiedOtpCode: z.string().optional().nullable(),
  consentToken: z.string().min(1),
});

type PublicInvestorIntakeInput = z.infer<typeof publicInvestorIntakeSchema>;

type IntakeRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

const intakeReviewSchema = z.object({
  status: z.enum(["submitted", "reviewed", "archived", "rejected"]),
  reviewNotes: z.string().trim().max(5_000).nullable().optional(),
});

export async function listPublicIntakeRequests() {
  const { data, error } = await adminSupabase
    .from("public_intake_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch public intake requests: ${error.message}`);
  return data ?? [];
}

export async function getPublicIntakeRequestForStaff(requestId: string) {
  const { data, error } = await adminSupabase
    .from("public_intake_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch public intake request: ${error.message}`);
  if (!data) throw new Error("Public intake request not found");
  return data;
}

export async function reviewPublicIntakeRequest(requestId: string, actor: AuthenticatedUser, input: unknown) {
  const review = intakeReviewSchema.parse(input);
  const { data, error } = await adminSupabase
    .from("public_intake_requests")
    .update({
      status: review.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor.id,
      review_notes: review.reviewNotes?.trim() || null,
    })
    .eq("id", requestId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`Failed to update public intake request: ${error.message}`);
  if (!data) throw new Error("Public intake request not found");

  mirrorPublicIntakeRequestToMongoSafely({
    requestId,
    intakeRecord: data as Record<string, unknown>,
    requestRecord: data as Record<string, unknown>,
    submittedAt: String(data.created_at ?? new Date().toISOString()),
  });
  return data;
}

export async function deletePublicIntakeRequest(requestId: string) {
  const { error, count } = await adminSupabase
    .from("public_intake_requests")
    .delete({ count: "exact" })
    .eq("id", requestId);

  if (error) throw new Error(`Failed to delete public intake request: ${error.message}`);
  if (!count) throw new Error("Public intake request not found");
  deletePublicIntakeRequestFromMongoSafely(requestId);
}

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
  const submittedAt = new Date().toISOString();
  mirrorPublicIntakeRequestToMongoSafely({
    requestId,
    intakeRecord,
    requestRecord: requestRecord as Record<string, unknown>,
    submittedAt,
  });

  const notificationPayload = buildPublicIntakeNotificationPayload({
    investor: input,
    requestId,
    maturityDate,
    submittedAt,
  });
  const internalRecipients = await resolveInternalRecipients({
    assigneeUserId,
    assigneeEmail,
  });

  const notificationResults = await Promise.allSettled(
    internalRecipients.map(async (recipient) => {
      const notification = {
        user_role: recipient.role,
        recipient_user_id: recipient.userId ?? null,
        recipient_email: recipient.email,
        title: "Zaraderavest form received",
        detail: notificationPayload,
        message: notificationPayload,
        action_path: "/public-intake-inbox",
        is_read: false,
      };
      const { data, error } = await adminSupabase.from("notifications").insert(notification).select("*").single();

      if (error || !data) {
        throw new Error(`Failed to create dashboard notification: ${error?.message ?? "Unknown error"}`);
      }

      mirrorNotificationToMongoSafely({
        notificationId: String(data.id),
        notification: data as Record<string, unknown>,
        createdAt: String(data.created_at ?? submittedAt),
      });
    }),
  );

  const failedNotifications = notificationResults.filter((result) => result.status === "rejected");
  if (failedNotifications.length > 0) {
    console.warn("[public-intake] One or more dashboard notifications failed:", failedNotifications.length);
  }

  const deliveryResults = await Promise.allSettled([
    ...internalRecipients.map((recipient) =>
      sendPlainEmail(
        recipient.email,
        `Your Zaraderavest form has been received: ${input.name.trim()}`,
        buildPublicIntakeInternalEmailHtml({
          investor: input,
          requestId,
          maturityDate,
          submittedAt,
        }),
      ),
    ),
    sendPlainEmail(
      input.email.trim().toLowerCase(),
      "Zaraderavest Form Received – Confirmation",
      buildPublicIntakeInvestorEmailHtml({
        investor: input,
        requestId,
        maturityDate,
        submittedAt,
      }),
    ),
  ]);

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

  if (emailTarget && canSendPublicIntakeEmail()) {
    deliveryTasks.push(
      sendPlainEmail(
        emailTarget,
        "Your Zaraderavest verification code",
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
    failedDeliveries.forEach((result) => {
      if (result.status === "rejected") {
        console.warn("[public-intake.otp] Email delivery failed", {
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    throw new Error("Failed to deliver verification code");
  }

  return {
    message: channels.includes("email")
      ? "Verification code sent to email"
      : "Verification code sent",
  };
}

export async function verifyPublicIntakeOtp(payload: unknown) {
  const schema = z.object({
    phone: z.string().min(7),
    code: z.string().min(4).max(10),
  });

  const input = schema.parse(payload);
  const codeTarget = normalizePhoneNumber(input.phone);
  assertConsentConfigured();
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

type InternalPublicIntakeRecipient = {
  role: "manager" | "general_manager" | "ceo";
  userId: string | null;
  email: string;
};

async function resolveInternalRecipients(args: {
  assigneeUserId: string;
  assigneeEmail: string | null;
}) {
  const recipients = new Map<string, InternalPublicIntakeRecipient>();
  const userLookup = await resolveUserLookup();

  const assigneeEmail = args.assigneeEmail?.trim().toLowerCase() ?? null;
  if (assigneeEmail) {
    recipients.set(`manager:${assigneeEmail}`, {
      role: "manager",
      userId: args.assigneeUserId,
      email: assigneeEmail,
    });
  }

  const targetEmails = await resolveEmailsByRoles(["investment_manager", "accountant", "general_manager", "super_admin"]);

  for (const email of targetEmails) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = userLookup.byEmail.get(normalizedEmail);
    const role = mapRecipientRole(user?.role);

    recipients.set(`${role}:${normalizedEmail}`, {
      role,
      userId: user?.id ?? null,
      email: normalizedEmail,
    });
  }

  return Array.from(recipients.values());
}

async function resolveEmailsByRoles(roles: Array<"investment_manager" | "accountant" | "general_manager" | "super_admin">) {
  const { data: userRoles, error: rolesError } = await adminSupabase
    .from("user_roles")
    .select("user_id, role");

  if (rolesError) {
    throw rolesError;
  }

  const targetUserIds = new Set(
    (userRoles ?? [])
      .filter((row) => roles.includes(row.role as "investment_manager" | "accountant" | "general_manager" | "super_admin"))
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

function mapRecipientRole(role?: string | null): "manager" | "general_manager" | "ceo" {
  switch (role) {
    case "investment_manager":
    case "accountant":
      return "manager";
    case "general_manager":
      return "general_manager";
    case "super_admin":
      return "ceo";
    default:
      return "manager";
  }
}

async function resolveUserLookup() {
  const { data, error } = await adminSupabase.auth.admin.listUsers();
  if (error) {
    throw error;
  }

  const { data: userRoles, error: rolesError } = await adminSupabase
    .from("user_roles")
    .select("user_id, role");

  if (rolesError) {
    throw rolesError;
  }

  const roleByUserId = new Map(
    (userRoles ?? []).map((row) => [row.user_id as string, row.role as string]),
  );

  return {
    byEmail: new Map(
      data.users
        .map((user) => {
          const email = user.email?.trim().toLowerCase();
          return email
            ? [
                email,
                {
                  id: user.id,
                  email,
                  role: roleByUserId.get(user.id) ?? null,
                },
              ]
            : null;
        })
        .filter((entry): entry is [string, { id: string; email: string; role: string | null }] => entry !== null),
    ),
  };
}

function calculateMaturityDate(startDate: string, tenure: number) {
  const date = new Date(startDate);
  date.setMonth(date.getMonth() + tenure);
  return date.toISOString().split("T")[0];
}

function normalizePhoneNumber(phone: string) {
  return phone.trim().replace(/\s+/g, "");
}

function assertConsentConfigured() {
  if (!env.PUBLIC_INTAKE_CONSENT_TOKEN_SECRET) {
    throw new Error("Public intake consent is not configured");
  }
}

function canSendPublicIntakeEmail() {
  return canSendEmail();
}

function buildOtpEmailHtml(code: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 12px;">Verify Your Zaraderavest Form</h2>
      <p>Your verification code is:</p>
      <div style="font-size: 28px; letter-spacing: 0.2em; font-weight: 700; margin: 16px 0;">${code}</div>
      <p>This code expires in 10 minutes and can only be used once.</p>
    </div>
  `;
}

function buildPublicIntakeNotificationPayload(args: {
  investor: PublicInvestorIntakeInput;
  requestId: string;
  maturityDate: string;
  submittedAt: string;
}) {
  const relationship = args.investor.nextOfKinRelationship?.trim() || "Not provided";
  const address = args.investor.address?.trim() || "Not provided";
  const gender = args.investor.gender ?? "Not provided";
  const dateOfBirth = args.investor.dateOfBirth?.trim() || "Not provided";
  const occupation = args.investor.occupation?.trim() || "Not provided";
  const sourceOfFunds = args.investor.sourceOfFunds?.trim() || "Not provided";
  const currencyCode = args.investor.currencyCode?.trim().toUpperCase() || "NGN";
  const percentage = args.investor.percentage == null ? "Not provided" : `${Number(args.investor.percentage).toFixed(2)}%`;
  const bankName = args.investor.clientBank.trim();
  const accountNumber = args.investor.clientAccountNumber.trim();

  const lines = [
    "Zaraderavest form received",
    `Request ID: ${args.requestId}`,
    `Investor: ${args.investor.name.trim()}`,
    `Email: ${args.investor.email.trim().toLowerCase()}`,
    `Phone: ${args.investor.phone.trim()}`,
    `Verified OTP: ${args.investor.verifiedOtpCode?.trim() || "Not provided"}`,
    `Date of Birth: ${dateOfBirth}`,
    `Address: ${address}`,
    `Gender: ${gender}`,
    `Occupation: ${occupation}`,
    `Source of Funds: ${sourceOfFunds}`,
    `Next of Kin: ${args.investor.nextOfKinName?.trim() || "Not provided"} (${relationship})`,
    `Next of Kin Phone: ${args.investor.nextOfKinPhone?.trim() || "Not provided"}`,
    `Amount: ${args.investor.investmentAmount.toLocaleString()}`,
    `Currency: ${currencyCode}`,
    `Type: ${args.investor.investmentType}`,
    `Tenure: ${args.investor.tenure} month(s)`,
    `Rate: ${percentage}`,
    `Bank: ${bankName}`,
    `Account Number: ${accountNumber}`,
    `Maturity Date: ${args.maturityDate}`,
    `Submitted Date: ${formatDisplayDate(args.submittedAt)}`,
    "",
    "I/We hereby declare that the information provided is true and complete. I/We understand and accept the terms and agree to comply with the partnership.",
    `Investor's OTP number: ${args.investor.verifiedOtpCode?.trim() || "Not provided"}`,
    `Date: ${formatDisplayDate(args.submittedAt)}`,
  ];

  return lines.join("\n");
}

function buildPublicIntakeInternalEmailHtml(args: {
  investor: PublicInvestorIntakeInput;
  requestId: string;
  maturityDate: string;
  submittedAt: string;
}) {
  const appUrl = env.APP_URL?.replace(/\/$/, "") ?? "";
  const inboxLink = `${appUrl}/public-intake-inbox`;
  const relationship = args.investor.nextOfKinRelationship?.trim() || "Not provided";
  const address = args.investor.address?.trim() || "Not provided";
  const gender = args.investor.gender ?? "Not provided";
  const dateOfBirth = args.investor.dateOfBirth?.trim() || "Not provided";
  const occupation = args.investor.occupation?.trim() || "Not provided";
  const sourceOfFunds = args.investor.sourceOfFunds?.trim() || "Not provided";
  const currencyCode = args.investor.currencyCode?.trim().toUpperCase() || "NGN";
  const percentage = args.investor.percentage == null ? "Not provided" : `${Number(args.investor.percentage).toFixed(2)}%`;
  const bankName = args.investor.clientBank.trim();
  const accountNumber = args.investor.clientAccountNumber.trim();

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 12px;">Zaraderavest form received</h2>
      <p><strong>Request ID:</strong> ${escapeHtml(args.requestId)}</p>
      <p><strong>Name:</strong> ${escapeHtml(args.investor.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(args.investor.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(args.investor.phone)}</p>
      <p><strong>Verified OTP:</strong> ${escapeHtml(args.investor.verifiedOtpCode?.trim() || "Not provided")}</p>
      <p><strong>Date of Birth:</strong> ${escapeHtml(dateOfBirth)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Gender:</strong> ${escapeHtml(gender)}</p>
      <p><strong>Occupation:</strong> ${escapeHtml(occupation)}</p>
      <p><strong>Source of Funds:</strong> ${escapeHtml(sourceOfFunds)}</p>
      <p><strong>Amount:</strong> ${args.investor.investmentAmount.toLocaleString()}</p>
      <p><strong>Currency:</strong> ${escapeHtml(currencyCode)}</p>
      <p><strong>Type:</strong> ${escapeHtml(args.investor.investmentType)}</p>
      <p><strong>Tenure:</strong> ${escapeHtml(String(args.investor.tenure))} month(s)</p>
      <p><strong>Rate:</strong> ${escapeHtml(percentage)}</p>
      <p><strong>Bank Details:</strong> ${escapeHtml(bankName)} - ${escapeHtml(accountNumber)}</p>
      <p><strong>Next of Kin:</strong> ${escapeHtml(args.investor.nextOfKinName?.trim() || "Not provided")}</p>
      <p><strong>Next of Kin Relationship:</strong> ${escapeHtml(relationship)}</p>
      <p><strong>Next of Kin Phone:</strong> ${escapeHtml(args.investor.nextOfKinPhone?.trim() || "Not provided")}</p>
      <p><strong>Maturity Date:</strong> ${escapeHtml(args.maturityDate)}</p>
      <p><strong>Submitted Date:</strong> ${escapeHtml(formatDisplayDate(args.submittedAt))}</p>
      <p><strong>Action:</strong> Review, copy, and convert this request into an investor record manually.</p>
      <p><strong>Open Inbox:</strong> <a href="${inboxLink}">${inboxLink}</a></p>
      <div style="margin-top: 20px; padding: 16px; border: 1px solid #d1d5db; border-radius: 10px; background: #f9fafb;">
        <p style="margin: 0 0 10px; font-weight: 600;">Declaration & Consent</p>
        <p style="margin: 0 0 12px;">
          I/We hereby declare that the information provided is true and complete. I/We understand and accept the terms and agree to comply with the partnership.
        </p>
        <p style="margin: 0 0 8px;"><strong>Investor's OTP number:</strong> ${escapeHtml(args.investor.verifiedOtpCode?.trim() || "Not provided")}</p>
        <p style="margin: 0;"><strong>Date:</strong> ${escapeHtml(formatDisplayDate(args.submittedAt))}</p>
      </div>
    </div>
  `;
}

function buildPublicIntakeInvestorEmailHtml(args: {
  investor: PublicInvestorIntakeInput;
  requestId: string;
  maturityDate: string;
  submittedAt: string;
}) {
  const fullName = escapeHtml(args.investor.name.trim());
  const submittedDate = escapeHtml(formatDisplayDate(args.submittedAt));
  const nextOfKinName = escapeHtml(args.investor.nextOfKinName?.trim() || "Not provided");
  const nextOfKinPhone = escapeHtml(args.investor.nextOfKinPhone?.trim() || "Not provided");
  const nextOfKinRelationship = escapeHtml(args.investor.nextOfKinRelationship?.trim() || "Not provided");
  const bankName = escapeHtml(args.investor.clientBank.trim());
  const accountNumber = escapeHtml(args.investor.clientAccountNumber.trim());
  const address = escapeHtml(args.investor.address?.trim() || "Not provided");
  const gender = escapeHtml(args.investor.gender ?? "Not provided");
  const verifiedOtpCode = escapeHtml(args.investor.verifiedOtpCode?.trim() || "Not provided");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 12px;">Zaraderavest form received</h2>
      <p>Thank you, ${fullName}. Your submission has been received and queued for review.</p>
      <p><strong>Request ID:</strong> ${escapeHtml(args.requestId)}</p>
      <p><strong>Submitted Date:</strong> ${submittedDate}</p>
      <p><strong>Tenure (Months):</strong> ${escapeHtml(String(args.investor.tenure))}</p>
      <p><strong>Investment Amount:</strong> ${args.investor.investmentAmount.toLocaleString()}</p>
      <p><strong>Type:</strong> ${escapeHtml(args.investor.investmentType)}</p>
      <p><strong>Maturity Date:</strong> ${escapeHtml(args.maturityDate)}</p>
      <p><strong>Bank Details:</strong> ${bankName} - ${accountNumber}</p>
      <p><strong>Address:</strong> ${address}</p>
      <p><strong>Gender:</strong> ${gender}</p>
      <p><strong>Next of Kin:</strong> ${nextOfKinName}</p>
      <p><strong>Next of Kin Relationship:</strong> ${nextOfKinRelationship}</p>
      <p><strong>Next of Kin Phone:</strong> ${nextOfKinPhone}</p>
      <p>Your details have been received, your investment certificate will be sent to you in 72 hours. Thank you.</p>
      <div style="margin-top: 20px; padding: 16px; border: 1px solid #d1d5db; border-radius: 10px; background: #f9fafb;">
        <p style="margin: 0 0 10px; font-weight: 600;">Declaration & Consent</p>
        <p style="margin: 0 0 12px;">
          I/We hereby declare that the information provided is true and complete. I/We understand and accept the terms and agree to comply with the partnership.
        </p>
        <p style="margin: 0 0 8px;"><strong>Investor's OTP number:</strong> ${verifiedOtpCode}</p>
        <p style="margin: 0;"><strong>Date:</strong> ${submittedDate}</p>
      </div>
    </div>
  `;
}

function formatDisplayDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
