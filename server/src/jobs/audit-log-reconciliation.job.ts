import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { purgeExpiredAuditLogsFromMongo, reconcileAuditLogsToMongo } from "../repositories/audit-logs.mongo.js";

const defaultSchedule = "*/5 * * * *";
let reconciliationRunning = false;

export async function runAuditLogReconciliation() {
  if (reconciliationRunning) {
    console.warn("[audit-logs.mongo] Previous reconciliation is still running; skipping overlap");
    return;
  }

  reconciliationRunning = true;
  try {
    const mirrored = await reconcileAuditLogsToMongo();
    const deleted = await purgeExpiredAuditLogsFromMongo(env.AUDIT_LOGS_MONGO_RETENTION_DAYS);
    if (mirrored > 0 || deleted > 0) {
      console.log(`[audit-logs.mongo] Reconciled ${mirrored} audit log record(s); removed ${deleted} expired record(s)`);
    }
  } catch (error) {
    console.error("[audit-logs.mongo] Reconciliation failed", error);
  } finally {
    reconciliationRunning = false;
  }
}

export function startAuditLogReconciliationJob() {
  if (!env.AUDIT_LOGS_MONGO_RECONCILIATION_ENABLED) {
    console.log("[audit-logs.mongo] Reconciliation job is disabled");
    return null;
  }

  if (!isMongoConfigured()) {
    console.log("[audit-logs.mongo] Reconciliation job is inactive because MongoDB is not configured");
    return null;
  }

  const schedule = env.AUDIT_LOGS_MONGO_RECONCILIATION_CRON || defaultSchedule;
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid audit-log reconciliation cron expression: ${schedule}`);
  }

  const job = cron.schedule(schedule, () => {
    void runAuditLogReconciliation();
  }, { timezone: "Africa/Lagos" });

  console.log(`[audit-logs.mongo] Reconciliation scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runAuditLogReconciliation();
  return job;
}
