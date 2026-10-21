import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { reconcileNotificationQueueToMongo } from "../repositories/notification-queue.mongo.js";

const defaultSchedule = "*/5 * * * *";
let reconciliationRunning = false;

export async function runNotificationQueueReconciliation() {
  if (reconciliationRunning) {
    console.warn("[notification-queue.mongo] Previous reconciliation is still running; skipping overlap");
    return;
  }

  reconciliationRunning = true;
  try {
    const mirrored = await reconcileNotificationQueueToMongo();
    console.log(`[notification-queue.mongo] Reconciled ${mirrored} notification queue job(s)`);
  } catch (error) {
    console.error("[notification-queue.mongo] Reconciliation failed", error);
  } finally {
    reconciliationRunning = false;
  }
}

export function startNotificationQueueReconciliationJob() {
  if (!env.NOTIFICATION_QUEUE_MONGO_RECONCILIATION_ENABLED) {
    console.log("[notification-queue.mongo] Reconciliation job is disabled");
    return null;
  }
  if (!isMongoConfigured()) {
    console.log("[notification-queue.mongo] Reconciliation job is inactive because MongoDB is not configured");
    return null;
  }

  const schedule = env.NOTIFICATION_QUEUE_MONGO_RECONCILIATION_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid notification-queue reconciliation cron expression: ${schedule}`);

  const job = cron.schedule(schedule, () => {
    void runNotificationQueueReconciliation();
  }, { timezone: "Africa/Lagos" });
  console.log(`[notification-queue.mongo] Reconciliation scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runNotificationQueueReconciliation();
  return job;
}
