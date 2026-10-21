import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { inspectMongoMaturityReminderCandidates } from "../services/mongo-maturity-reminder-shadow.service.js";

const defaultSchedule = "15 7 * * *";
let shadowRunning = false;

export async function runMongoMaturityReminderShadow() {
  if (shadowRunning) {
    console.warn("[mongo-maturity-reminder-shadow] Previous run is still active; skipping overlap");
    return;
  }

  shadowRunning = true;
  try {
    const report = await inspectMongoMaturityReminderCandidates();
    console.log("[mongo-maturity-reminder-shadow] Candidate report", report);
  } catch (error) {
    console.error("[mongo-maturity-reminder-shadow] Inspection failed", error);
  } finally {
    shadowRunning = false;
  }
}

export function startMongoMaturityReminderShadowJob() {
  if (!env.MONGO_MATURITY_REMINDER_SHADOW_ENABLED) {
    console.log("[mongo-maturity-reminder-shadow] Disabled; Supabase reminder scheduler remains authoritative");
    return null;
  }
  if (!isMongoConfigured()) {
    console.log("[mongo-maturity-reminder-shadow] Inactive because MongoDB is not configured");
    return null;
  }

  const schedule = env.MONGO_MATURITY_REMINDER_SHADOW_CRON || defaultSchedule;
  if (!cron.validate(schedule)) throw new Error(`Invalid Mongo maturity reminder shadow cron expression: ${schedule}`);

  const job = cron.schedule(schedule, () => {
    void runMongoMaturityReminderShadow();
  }, { timezone: "Africa/Lagos" });
  console.log(`[mongo-maturity-reminder-shadow] Scheduled with cron "${schedule}" (Africa/Lagos); no jobs or messages will be created`);
  void runMongoMaturityReminderShadow();
  return job;
}
