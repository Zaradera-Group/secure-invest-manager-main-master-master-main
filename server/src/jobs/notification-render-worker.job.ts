import cron from "node-cron";
import { env } from "../config/env.js";
import { canSendEmail, sendBirthdayEmail, sendPlainEmail } from "../lib/email.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { sendPlainSms } from "../lib/sms.js";
import {
  claimNextNotificationDelivery,
  completeNotificationDelivery,
  failNotificationDelivery,
  requeueStaleNotificationDeliveries,
  type NotificationDeliveryOutboxRecord,
} from "../repositories/notification-delivery-outbox.mongo.js";

const defaultSchedule = "*/5 * * * *";
let workerRunning = false;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

const getWorkerNotificationTypes = () => [
  ...(env.BIRTHDAY_DELIVERY_AUTHORITY === "render" ? ["birthday_greeting"] : []),
  ...(env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY === "render" ? ["certificate_stage_notification"] : []),
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

async function processDelivery(job: NotificationDeliveryOutboxRecord) {
  if (job.notificationType === "birthday_greeting") return processBirthdayGreeting(job);
  if (job.notificationType === "certificate_stage_notification") return processCertificateStageNotification(job);
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
  console.log(`[notification-render-worker] Scheduled with cron "${schedule}" (Africa/Lagos); active authorities: birthday=${env.BIRTHDAY_DELIVERY_AUTHORITY}, certificate=${env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY}`);
  void runNotificationRenderWorker();
  return job;
}
