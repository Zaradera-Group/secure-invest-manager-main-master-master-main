import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { Auth0StaffAccountService } from "../services/auth0-staff-account.service.js";

const defaultSchedule = "*/5 * * * *";
let reconciliationRunning = false;

export async function runAuth0StaffAccountReconciliation() {
  if (reconciliationRunning) {
    console.warn("[auth0-staff-accounts.mongo] Previous reconciliation is still running; skipping overlap");
    return;
  }

  reconciliationRunning = true;
  try {
    const result = await new Auth0StaffAccountService().reconcileMappings();
    if (result.checked > 0) {
      console.log(`[auth0-staff-accounts.mongo] Reconciled ${result.checked} mapping(s): ${result.active} active, ${result.disabled} disabled, ${result.changed} changed`);
    }
  } catch (error) {
    console.error("[auth0-staff-accounts.mongo] Reconciliation failed", error);
  } finally {
    reconciliationRunning = false;
  }
}

export function startAuth0StaffAccountReconciliationJob() {
  if (!env.AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_ENABLED) {
    console.log("[auth0-staff-accounts.mongo] Reconciliation job is disabled");
    return null;
  }

  if (!isMongoConfigured()) {
    console.log("[auth0-staff-accounts.mongo] Reconciliation job is inactive because MongoDB is not configured");
    return null;
  }

  const schedule = env.AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_CRON || defaultSchedule;
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid Auth0 staff-account reconciliation cron expression: ${schedule}`);
  }

  const job = cron.schedule(schedule, () => {
    void runAuth0StaffAccountReconciliation();
  }, { timezone: "Africa/Lagos" });

  console.log(`[auth0-staff-accounts.mongo] Reconciliation scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runAuth0StaffAccountReconciliation();
  return job;
}
