import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { produceMongoMonthlyReportDeliveries } from "../services/mongo-monthly-report-producer.service.js";

const defaultSchedule = "30 7 1 * *";
let producerRunning = false;

export async function runMongoMonthlyReportProducer() {
  if (producerRunning) return;
  producerRunning = true;
  try {
    const deliveryMode = env.MONTHLY_REPORT_DELIVERY_AUTHORITY === "render" ? "live" : "shadow";
    const report = await produceMongoMonthlyReportDeliveries(deliveryMode);
    console.log("[mongo-monthly-report-producer] Outbox report", { deliveryMode, ...report });
  } catch (error) {
    console.error("[mongo-monthly-report-producer] Run failed", error);
  } finally {
    producerRunning = false;
  }
}

export function startMongoMonthlyReportProducerJob() {
  const shouldRun = env.MONGO_MONTHLY_REPORT_OUTBOX_SHADOW_ENABLED || env.MONTHLY_REPORT_DELIVERY_AUTHORITY === "render";
  if (!shouldRun) { console.log("[mongo-monthly-report-producer] Disabled; Supabase remains the monthly report authority"); return null; }
  if (!isMongoConfigured()) { console.log("[mongo-monthly-report-producer] Inactive because MongoDB is not configured"); return null; }
  const schedule = env.MONGO_MONTHLY_REPORT_PRODUCER_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid Mongo monthly report producer cron expression: ${schedule}`);
  const job = cron.schedule(schedule, () => void runMongoMonthlyReportProducer(), { timezone: "Africa/Lagos" });
  console.log(`[mongo-monthly-report-producer] Scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runMongoMonthlyReportProducer();
  return job;
}
