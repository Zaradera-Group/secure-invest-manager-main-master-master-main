import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { reconcileNotificationAuditToMongo } from "../repositories/notification-audit.mongo.js";

const defaultSchedule = "*/5 * * * *";
let reconciliationRunning = false;

export async function runNotificationAuditReconciliation() {
  if (reconciliationRunning) {
    console.warn("[notification-audit.mongo] Previous reconciliation is still running; skipping overlap");
    return;
  }

  reconciliationRunning = true;
  try {
    const totals = await reconcileNotificationAuditToMongo();
    const mirrored = Object.values(totals).reduce((total, count) => total + count, 0);
    if (mirrored > 0) console.log(`[notification-audit.mongo] Reconciled ${mirrored} audit record(s)`);
  } catch (error) {
    console.error("[notification-audit.mongo] Reconciliation failed", error);
  } finally {
    reconciliationRunning = false;
  }
}

export function startNotificationAuditReconciliationJob() {
  if (!env.NOTIFICATION_AUDIT_MONGO_RECONCILIATION_ENABLED) {
    console.log("[notification-audit.mongo] Reconciliation job is disabled");
    return null;
  }
  if (!isMongoConfigured()) {
    console.log("[notification-audit.mongo] Reconciliation job is inactive because MongoDB is not configured");
    return null;
  }

  const schedule = env.NOTIFICATION_AUDIT_MONGO_RECONCILIATION_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid notification-audit reconciliation cron expression: ${schedule}`);

  const job = cron.schedule(schedule, () => {
    void runNotificationAuditReconciliation();
  }, { timezone: "Africa/Lagos" });
  console.log(`[notification-audit.mongo] Reconciliation scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runNotificationAuditReconciliation();
  return job;
}
