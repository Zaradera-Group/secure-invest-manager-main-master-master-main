import cron from "node-cron";
import { env } from "../config/env.js";
import { notificationWorkerShadowService } from "../services/notification-worker-shadow.service.js";

const defaultSchedule = "*/5 * * * *";
let shadowRunInProgress = false;

export async function runNotificationWorkerShadow() {
  if (shadowRunInProgress) {
    console.warn("[notification-worker.shadow] Previous observation is still running; skipping overlap");
    return;
  }

  shadowRunInProgress = true;
  try {
    const snapshot = await notificationWorkerShadowService.inspectQueue();
    console.log("[notification-worker.shadow] Observed legacy Supabase notification queue; no jobs claimed or delivered", snapshot);
  } catch (error) {
    console.error("[notification-worker.shadow] Queue observation failed", error);
  } finally {
    shadowRunInProgress = false;
  }
}

export function startNotificationWorkerShadowJob() {
  if (!env.NOTIFICATION_WORKER_SHADOW_ENABLED) {
    console.log("[notification-worker.shadow] Read-only observer is disabled; Supabase Edge worker remains authoritative");
    return null;
  }

  const schedule = env.NOTIFICATION_WORKER_SHADOW_CRON || defaultSchedule;
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid notification-worker shadow cron expression: ${schedule}`);
  }

  const job = cron.schedule(schedule, () => {
    void runNotificationWorkerShadow();
  }, { timezone: "Africa/Lagos" });

  console.log(`[notification-worker.shadow] Read-only observer scheduled with cron "${schedule}" (Africa/Lagos)`);
  void runNotificationWorkerShadow();
  return job;
}
