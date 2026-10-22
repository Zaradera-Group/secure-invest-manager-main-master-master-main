import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { produceMongoMaturityReminderDeliveries } from "../services/mongo-maturity-reminder-producer.service.js";

const defaultSchedule = "20 7 * * *";
let producerRunning = false;

export async function runMongoMaturityReminderProducer() {
  if (producerRunning) {
    console.warn("[mongo-maturity-reminder-producer] Previous run is still active; skipping overlap");
    return;
  }

  producerRunning = true;
  try {
    const deliveryMode = env.MATURITY_REMINDER_DELIVERY_AUTHORITY === "render" ? "live" : "shadow";
    const report = await produceMongoMaturityReminderDeliveries(deliveryMode);
    console.log("[mongo-maturity-reminder-producer] Outbox report", { deliveryMode, ...report });
  } catch (error) {
    console.error("[mongo-maturity-reminder-producer] Run failed", error);
  } finally {
    producerRunning = false;
  }
}

export function startMongoMaturityReminderProducerJob() {
  const shouldRun = env.MONGO_MATURITY_REMINDER_OUTBOX_SHADOW_ENABLED
    || env.MATURITY_REMINDER_DELIVERY_AUTHORITY === "render";
  if (!shouldRun) {
    console.log("[mongo-maturity-reminder-producer] Disabled; Supabase remains the maturity reminder authority");
    return null;
  }
  if (!isMongoConfigured()) {
    console.log("[mongo-maturity-reminder-producer] Inactive because MongoDB is not configured");
    return null;
  }

  const schedule = env.MONGO_MATURITY_REMINDER_PRODUCER_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid Mongo maturity reminder producer cron expression: ${schedule}`);
  const job = cron.schedule(schedule, () => void runMongoMaturityReminderProducer(), { timezone: "Africa/Lagos" });
  console.log(`[mongo-maturity-reminder-producer] Scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runMongoMaturityReminderProducer();
  return job;
}
