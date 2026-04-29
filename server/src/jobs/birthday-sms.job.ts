import cron from "node-cron";
import { env } from "../config/env.js";
import { adminSupabase } from "../lib/supabase.js";
import { sendBirthdaySmsBatch } from "../lib/sms.js";

type BirthdayInvestor = {
  id: string;
  name: string;
  phone: string;
  date_of_birth: string | null;
};

const DEFAULT_BIRTHDAY_CRON = "0 8 * * *";
let birthdayJobRunning = false;

async function getTodaysBirthdayInvestors(now = new Date()) {
  const { data, error } = await adminSupabase
    .from("investors")
    .select("id, name, phone, date_of_birth")
    .not("date_of_birth", "is", null)
    .not("phone", "is", null);

  if (error) {
    throw new Error(`Failed to load birthday investors: ${error.message}`);
  }

  const todayMonth = now.getMonth() + 1;
  const todayDate = now.getDate();

  return ((data ?? []) as BirthdayInvestor[]).filter((investor) => {
    if (!investor.date_of_birth) {
      return false;
    }

    const dob = new Date(investor.date_of_birth);
    return dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDate;
  });
}

export async function runBirthdaySmsJob(now = new Date()) {
  if (birthdayJobRunning) {
    console.warn("[birthday-sms-job] previous run is still in progress; skipping overlap");
    return;
  }

  birthdayJobRunning = true;

  try {
    const investors = await getTodaysBirthdayInvestors(now);

    if (investors.length === 0) {
      console.log("[birthday-sms-job] no investors with birthdays today");
      return;
    }

    const result = await sendBirthdaySmsBatch(
      investors.map((investor) => ({
        name: investor.name,
        phone: investor.phone,
      })),
    );

    console.log(
      `[birthday-sms-job] completed: total=${result.total} sent=${result.sent} failed=${result.failed}`,
    );
  } catch (error) {
    console.error("[birthday-sms-job] failed:", error);
  } finally {
    birthdayJobRunning = false;
  }
}

export function startBirthdaySmsJob() {
  if (!env.BIRTHDAY_SMS_ENABLED) {
    console.log("[birthday-sms-job] disabled");
    return null;
  }

  const schedule = env.BIRTHDAY_SMS_CRON || DEFAULT_BIRTHDAY_CRON;
  const timezone = env.BIRTHDAY_SMS_TIMEZONE || "Africa/Lagos";

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid birthday SMS cron expression: ${schedule}`);
  }

  console.log(`[birthday-sms-job] scheduled with cron "${schedule}" (${timezone})`);

  return cron.schedule(
    schedule,
    () => {
      void runBirthdaySmsJob();
    },
    {
      timezone,
    },
  );
}
