import cron from "node-cron";
import { env } from "../config/env.js";
import { canSendEmail, sendBirthdayEmail, sendPlainEmail } from "../lib/email.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { sendPlainSms } from "../lib/sms.js";
import { getPublicIntakeRequestFromMongo } from "../repositories/public-intake.mongo.js";
import {
  claimNextNotificationDelivery,
  completeNotificationDelivery,
  failNotificationDelivery,
  requeueStaleNotificationDeliveries,
  type NotificationDeliveryOutboxRecord,
} from "../repositories/notification-delivery-outbox.mongo.js";
import { createNativeDashboardNotification } from "../repositories/notifications.mongo.js";

const defaultSchedule = "*/5 * * * *";
let workerRunning = false;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

const getWorkerNotificationTypes = () => [
  ...(env.BIRTHDAY_DELIVERY_AUTHORITY === "render" ? ["birthday_greeting"] : []),
  ...(env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY === "render" ? ["certificate_stage_notification"] : []),
  ...(env.PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY === "render" ? ["public_intake_receipt"] : []),
  ...(env.MATURITY_REMINDER_DELIVERY_AUTHORITY === "render" ? ["maturity_reminder"] : []),
  ...(env.PAYMENT_REMINDER_DELIVERY_AUTHORITY === "render" ? ["payment_reminder"] : []),
  ...(env.MONTHLY_REPORT_DELIVERY_AUTHORITY === "render" ? ["monthly_report"] : []),
];

async function processBirthdayGreeting(job: NotificationDeliveryOutboxRecord) {
  if (job.channel !== "sms") throw new Error(`Unsupported birthday delivery channel: ${job.channel}`);
  if (env.SMS_ENABLED !== true) throw new Error("Birthday SMS delivery is disabled");
  const name = text(job.payload.investorName);
  if (!name) throw new Error("Birthday delivery is missing investorName");

  try {
    await sendPlainSms(job.recipient, `Happy Birthday, ${name}! Wishing you prosperity, joy, and success.`);
    return "sms";
  } catch (smsError) {
    const email = text(job.payload.email);
    if (!email) throw smsError;

    const dateOfBirth = text(job.payload.dateOfBirth);
    const year = Number.parseInt(dateOfBirth.slice(0, 4), 10);
    const age = Number.isFinite(year) ? new Date().getFullYear() - year : null;
    await sendBirthdayEmail(email, name, age);
    return "email_fallback";
  }
}

async function processCertificateStageNotification(job: NotificationDeliveryOutboxRecord) {
  const investorName = text(job.payload.investorName);
  const stage = text(job.payload.stage);
  if (!investorName) throw new Error("Certificate stage delivery is missing investorName");

  const contentByStage: Record<string, { subject: string; email: string; sms: string }> = {
    pending_manager: {
      subject: "Certificate awaiting manager review",
      email: `<p>A certificate for <strong>${investorName}</strong> is ready for manager review.</p><p>Status: pending_manager</p>`,
      sms: `Certificate for ${investorName} is awaiting Investment Manager review.`,
    },
    pending_general_manager: {
      subject: "Certificate awaiting general manager review",
      email: `<p>A certificate for <strong>${investorName}</strong> is ready for general manager review.</p><p>Status: pending_general_manager</p>`,
      sms: `Certificate for ${investorName} is awaiting General Manager review.`,
    },
    pending_ceo: {
      subject: "Certificate awaiting CEO approval",
      email: `<p>A certificate for <strong>${investorName}</strong> is ready for CEO approval.</p><p>Status: pending_ceo</p>`,
      sms: `Certificate for ${investorName} is awaiting CEO approval.`,
    },
  };
  const content = contentByStage[stage];
  if (!content) throw new Error(`Unsupported certificate notification stage: ${stage || "missing"}`);

  if (job.channel === "email") {
    if (!canSendEmail()) throw new Error("Certificate email delivery is disabled or not configured");
    await sendPlainEmail(job.recipient, content.subject, content.email);
    return "email";
  }
  if (job.channel === "sms") {
    if (env.SMS_ENABLED !== true) throw new Error("Certificate SMS delivery is disabled");
    await sendPlainSms(job.recipient, content.sms);
    return "sms";
  }
  throw new Error(`Unsupported certificate delivery channel: ${job.channel}`);
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

async function processPublicIntakeReceipt(job: NotificationDeliveryOutboxRecord) {
  if (job.channel !== "email") throw new Error(`Unsupported public-intake delivery channel: ${job.channel}`);
  if (!canSendEmail()) throw new Error("Public-intake email delivery is disabled or not configured");

  const requestId = text(job.payload.requestId);
  const recipientKind = text(job.payload.recipientKind);
  if (!requestId || !["internal", "investor"].includes(recipientKind)) {
    throw new Error("Public-intake receipt delivery is missing request metadata");
  }

  const record = await getPublicIntakeRequestFromMongo(requestId);
  if (!record) throw new Error("Mirrored public-intake request is not available yet");

  const investorName = text(record.submitted_by_name) || "Investor";
  const amount = record.investment_amount == null ? "Not provided" : Number(record.investment_amount).toLocaleString();
  const currency = text(record.currency_code) || "NGN";
  const tenure = record.tenure == null ? "Not provided" : String(record.tenure);
  const maturityDate = text(record.maturity_date) || "Not provided";
  const appUrl = env.APP_URL?.replace(/\/$/, "") ?? "";

  if (recipientKind === "internal") {
    await sendPlainEmail(
      job.recipient,
      `Your Zaraderavest form has been received: ${investorName}`,
      `<p>A public investment form has been received for <strong>${escapeHtml(investorName)}</strong>.</p><p><strong>Request ID:</strong> ${escapeHtml(requestId)}</p><p><strong>Amount:</strong> ${escapeHtml(amount)} ${escapeHtml(currency)}</p><p><strong>Tenure:</strong> ${escapeHtml(tenure)} month(s)</p><p><strong>Maturity date:</strong> ${escapeHtml(maturityDate)}</p><p><a href="${escapeHtml(`${appUrl}/public-intake-inbox`)}">Open Public Intake Inbox</a></p>`,
    );
    return "email";
  }

  await sendPlainEmail(
    job.recipient,
    "Zaraderavest Form Received - Confirmation",
    `<p>Thank you, ${escapeHtml(investorName)}. Your submission has been received and queued for review.</p><p><strong>Request ID:</strong> ${escapeHtml(requestId)}</p><p><strong>Investment amount:</strong> ${escapeHtml(amount)} ${escapeHtml(currency)}</p><p><strong>Tenure:</strong> ${escapeHtml(tenure)} month(s)</p><p><strong>Maturity date:</strong> ${escapeHtml(maturityDate)}</p><p>Your investment certificate will be sent within 72 hours. Thank you.</p>`,
  );
  return "email";
}

async function processMaturityReminder(job: NotificationDeliveryOutboxRecord) {
  if (job.channel !== "email") throw new Error(`Unsupported maturity reminder delivery channel: ${job.channel}`);
  if (!canSendEmail()) throw new Error("Maturity reminder email delivery is disabled or not configured");

  const investorId = text(job.payload.investorId);
  const investorName = text(job.payload.investorName) || "Investor";
  const maturityDate = text(job.payload.maturityDate);
  const staffUserId = text(job.payload.staffUserId);
  const staffEmail = text(job.payload.staffEmail) || job.recipient;
  const daysUntilMaturity = Number(job.payload.daysUntilMaturity);
  const amount = Number(job.payload.investmentAmount ?? 0);
  if (!investorId || !maturityDate || !staffUserId || !staffEmail || !Number.isFinite(daysUntilMaturity)) {
    throw new Error("Maturity reminder delivery is missing required payload data");
  }

  const timing = daysUntilMaturity <= 0 ? "matures today" : `matures in ${daysUntilMaturity} day${daysUntilMaturity === 1 ? "" : "s"}`;
  const title = daysUntilMaturity <= 0 ? "Investment matured today" : "Investment maturity reminder";
  const detail = `${investorName}'s investment ${timing} on ${maturityDate}.`;
  await createNativeDashboardNotification({
    dedupeKey: `dashboard:${job.dedupeKey}`,
    recipientUserId: staffUserId,
    recipientEmail: staffEmail,
    userRole: "manager",
    investorId,
    title,
    detail,
    actionPath: `/investors/${investorId}`,
  });
  await sendPlainEmail(
    job.recipient,
    `Investment Maturity Reminder: ${investorName} ${timing}`,
    `<p><strong>${escapeHtml(investorName)}</strong>'s investment ${escapeHtml(timing)}.</p><p><strong>Maturity date:</strong> ${escapeHtml(maturityDate)}</p><p><strong>Investment amount:</strong> NGN ${escapeHtml(amount.toLocaleString())}</p>`,
  );
  return "email";
}

async function processPaymentReminder(job: NotificationDeliveryOutboxRecord) {
  const investorName = text(job.payload.investorName) || "Investor";
  const reminderType = text(job.payload.reminderType) || "Payment reminder";
  const nextPaymentDate = text(job.payload.nextPaymentDate);
  const maturityDate = text(job.payload.maturityDate);
  const amount = Number(job.payload.paymentAmount ?? 0);
  if (!nextPaymentDate || !Number.isFinite(amount)) throw new Error("Payment reminder delivery is missing required payload data");

  if (job.channel === "email") {
    if (!canSendEmail()) throw new Error("Payment reminder email delivery is disabled or not configured");
    await sendPlainEmail(
      job.recipient,
      `${reminderType}: ${investorName}`,
      `<p><strong>${escapeHtml(investorName)}</strong> has a payment due on <strong>${escapeHtml(nextPaymentDate)}</strong>.</p><p><strong>Payment amount:</strong> NGN ${escapeHtml(amount.toLocaleString())}</p><p><strong>Maturity date:</strong> ${escapeHtml(maturityDate || "Not provided")}</p>`,
    );
    return "email";
  }
  if (job.channel === "sms") {
    if (env.SMS_ENABLED !== true) throw new Error("Payment reminder SMS delivery is disabled");
    await sendPlainSms(job.recipient, `Payment reminder: ${investorName} has ${reminderType.toLowerCase()} on ${nextPaymentDate}. Amount: NGN ${amount.toLocaleString()}.`);
    return "sms";
  }
  throw new Error(`Unsupported payment reminder delivery channel: ${job.channel}`);
}

async function processMonthlyReport(job: NotificationDeliveryOutboxRecord) {
  if (job.channel !== "email") throw new Error(`Unsupported monthly report delivery channel: ${job.channel}`);
  if (!canSendEmail()) throw new Error("Monthly report email delivery is disabled or not configured");
  const reportMonth = text(job.payload.reportMonth);
  const stats = job.payload.stats as Record<string, unknown> | undefined;
  if (!reportMonth || !stats) throw new Error("Monthly report delivery is missing report data");
  const recent = Array.isArray(stats.recent_investments) ? stats.recent_investments as Array<Record<string, unknown>> : [];
  const recentHtml = recent.map((investment) => `<li><strong>${escapeHtml(text(investment.name) || "Investor")}</strong> - NGN ${escapeHtml(Number(investment.amount ?? 0).toLocaleString())} (${escapeHtml(text(investment.investment_type))}) - Matures: ${escapeHtml(text(investment.maturity_date) || "Not provided")}</li>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#172033;max-width:640px"><div style="background:#173b75;color:#fff;padding:20px"><h1 style="margin:0">Zaradera Vest</h1><p style="margin:8px 0 0">Monthly Investment Report - ${escapeHtml(reportMonth)}</p></div><div style="padding:20px"><h2>Portfolio Summary</h2><p><strong>Total investments:</strong> ${escapeHtml(String(stats.total_investments ?? 0))}</p><p><strong>Active investments:</strong> ${escapeHtml(String(stats.active_investments ?? 0))}</p><p><strong>Total value:</strong> NGN ${escapeHtml(Number(stats.total_investment_value ?? 0).toLocaleString())}</p><p><strong>Maturing next month:</strong> ${escapeHtml(String(stats.maturing_next_month ?? 0))}</p>${Number(stats.matured_this_month ?? 0) > 0 ? `<p><strong>${escapeHtml(String(stats.matured_this_month))} investment(s) matured this month.</strong></p>` : ""}${recentHtml ? `<h3>Recent Investments</h3><ul>${recentHtml}</ul>` : ""}</div><p style="color:#667085;font-size:12px;padding:0 20px 20px">Automated report from Zaradera Vest Investment Management.</p></div>`;
  await sendPlainEmail(job.recipient, `Monthly Investment Report - ${reportMonth}`, html);
  return "email";
}

async function processDelivery(job: NotificationDeliveryOutboxRecord) {
  if (job.notificationType === "birthday_greeting") return processBirthdayGreeting(job);
  if (job.notificationType === "certificate_stage_notification") return processCertificateStageNotification(job);
  if (job.notificationType === "public_intake_receipt") return processPublicIntakeReceipt(job);
  if (job.notificationType === "maturity_reminder") return processMaturityReminder(job);
  if (job.notificationType === "payment_reminder") return processPaymentReminder(job);
  if (job.notificationType === "monthly_report") return processMonthlyReport(job);
  throw new Error(`Unsupported Render notification type: ${job.notificationType}`);
}

export async function runNotificationRenderWorker() {
  if (workerRunning) {
    console.warn("[notification-render-worker] Previous run is still active; skipping overlap");
    return;
  }

  workerRunning = true;
  try {
    const requeued = await requeueStaleNotificationDeliveries();
    const notificationTypes = getWorkerNotificationTypes();
    if (notificationTypes.length === 0) return;
    let completed = 0;
    let failed = 0;
    let emailFallback = 0;

    for (let index = 0; index < env.NOTIFICATION_RENDER_WORKER_BATCH_SIZE; index += 1) {
      const job = await claimNextNotificationDelivery(notificationTypes);
      if (!job) break;

      try {
        const deliveryChannel = await processDelivery(job);
        await completeNotificationDelivery(job.id);
        completed += 1;
        if (deliveryChannel === "email_fallback") emailFallback += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failNotificationDelivery(job.id, message);
        failed += 1;
        console.error("[notification-render-worker] Delivery failed", { jobId: job.id, notificationType: job.notificationType, reason: message });
      }
    }

    if (requeued > 0 || completed > 0 || failed > 0) {
      console.log(`[notification-render-worker] deliveries: completed=${completed} failed=${failed} email_fallback=${emailFallback} stale_requeued=${requeued}`);
    }
  } catch (error) {
    console.error("[notification-render-worker] Run failed", error);
  } finally {
    workerRunning = false;
  }
}

export function startNotificationRenderWorkerJob() {
  if (!env.NOTIFICATION_RENDER_WORKER_ENABLED) {
    console.log("[notification-render-worker] Disabled; Supabase Edge remains the notification delivery authority");
    return null;
  }
  if (!isMongoConfigured()) {
    console.log("[notification-render-worker] Inactive because MongoDB is not configured");
    return null;
  }
  const schedule = env.NOTIFICATION_RENDER_WORKER_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid Render notification worker cron expression: ${schedule}`);

  const job = cron.schedule(schedule, () => {
    void runNotificationRenderWorker();
  }, { timezone: "Africa/Lagos" });
    console.log(`[notification-render-worker] Scheduled with cron "${schedule}" (Africa/Lagos); active authorities: birthday=${env.BIRTHDAY_DELIVERY_AUTHORITY}, certificate=${env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY}, publicIntake=${env.PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY}, maturity=${env.MATURITY_REMINDER_DELIVERY_AUTHORITY}, payment=${env.PAYMENT_REMINDER_DELIVERY_AUTHORITY}, monthlyReport=${env.MONTHLY_REPORT_DELIVERY_AUTHORITY}`);
  void runNotificationRenderWorker();
  return job;
}
