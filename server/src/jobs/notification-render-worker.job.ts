import cron from "node-cron";
import { env } from "../config/env.js";
import { sendBirthdayEmail } from "../lib/email.js";
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
const supportedNotificationTypes = ["birthday_greeting"] as const;
let workerRunning = false;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function processBirthdayGreeting(job: NotificationDeliveryOutboxRecord) {
  if (job.channel !== "sms") throw new Error(`Unsupported birthday delivery channel: ${job.channel}`);
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

async function processDelivery(job: NotificationDeliveryOutboxRecord) {
  if (job.notificationType === "birthday_greeting") return processBirthdayGreeting(job);
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
    let completed = 0;
    let failed = 0;
    let emailFallback = 0;

    for (let index = 0; index < env.NOTIFICATION_RENDER_WORKER_BATCH_SIZE; index += 1) {
      const job = await claimNextNotificationDelivery(supportedNotificationTypes);
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
      console.log(`[notification-render-worker] birthday deliveries: completed=${completed} failed=${failed} email_fallback=${emailFallback} stale_requeued=${requeued}`);
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
  if (env.SMS_ENABLED !== true) {
    console.log("[notification-render-worker] Inactive because SMS delivery is disabled");
    return null;
  }

  const schedule = env.NOTIFICATION_RENDER_WORKER_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid Render notification worker cron expression: ${schedule}`);

  const job = cron.schedule(schedule, () => {
    void runNotificationRenderWorker();
  }, { timezone: "Africa/Lagos" });
  console.log(`[notification-render-worker] Scheduled with cron "${schedule}" (Africa/Lagos); supports birthday_greeting only`);
  void runNotificationRenderWorker();
  return job;
}
