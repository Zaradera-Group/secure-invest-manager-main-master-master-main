import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { produceMongoPaymentReminderDeliveries } from "../services/mongo-payment-reminder-producer.service.js";

const defaultSchedule = "25 7 * * *";
let producerRunning = false;

export async function runMongoPaymentReminderProducer() {
  if (producerRunning) {
    console.warn("[mongo-payment-reminder-producer] Previous run is still active; skipping overlap");
    return;
  }
  producerRunning = true;
  try {
    const deliveryMode = env.PAYMENT_REMINDER_DELIVERY_AUTHORITY === "render" ? "live" : "shadow";
    const report = await produceMongoPaymentReminderDeliveries(deliveryMode);
    console.log("[mongo-payment-reminder-producer] Outbox report", { deliveryMode, ...report });
  } catch (error) {
    console.error("[mongo-payment-reminder-producer] Run failed", error);
  } finally {
    producerRunning = false;
  }
}

export function startMongoPaymentReminderProducerJob() {
  const shouldRun = env.MONGO_PAYMENT_REMINDER_OUTBOX_SHADOW_ENABLED
    || env.PAYMENT_REMINDER_DELIVERY_AUTHORITY === "render";
  if (!shouldRun) {
    console.log("[mongo-payment-reminder-producer] Disabled; Supabase remains the payment reminder authority");
    return null;
  }
  if (!isMongoConfigured()) {
    console.log("[mongo-payment-reminder-producer] Inactive because MongoDB is not configured");
    return null;
  }
  const schedule = env.MONGO_PAYMENT_REMINDER_PRODUCER_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid Mongo payment reminder producer cron expression: ${schedule}`);
  const job = cron.schedule(schedule, () => void runMongoPaymentReminderProducer(), { timezone: "Africa/Lagos" });
  console.log(`[mongo-payment-reminder-producer] Scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runMongoPaymentReminderProducer();
  return job;
}
