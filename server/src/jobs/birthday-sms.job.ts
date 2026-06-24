import cron from "node-cron";
import { env } from "../config/env.js";
import { adminSupabase } from "../lib/supabase.js";
import { sendBirthdaySmsBatch } from "../lib/sms.js";
import { sendBirthdayEmail } from "../lib/email.js";

type BirthdayInvestor = {
  id: string;
  name: string;
  email: string;
  phone: string;
  date_of_birth: string | null;
};

const DEFAULT_BIRTHDAY_CRON = "0 8 * * *";
let birthdayJobRunning = false;

async function getTodaysBirthdayInvestors(now = new Date()) {
  const { data, error } = await adminSupabase
    .from("investors")
    .select("id, name, email, phone, date_of_birth")
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

    const smsResult = await sendBirthdaySmsBatch(
      investors.map((investor) => ({
        name: investor.name,
        phone: investor.phone,
      })),
    );

    // Send email fallback for failed SMS
    const failedRecipients = smsResult.results
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.status === "rejected")
      .map(({ index }) => investors[index]);

    let emailFallbackCount = 0;
    for (const investor of failedRecipients) {
      if (investor.email) {
        try {
          const age = investor.date_of_birth
            ? new Date().getFullYear() - new Date(investor.date_of_birth).getFullYear()
            : null;
          await sendBirthdayEmail(investor.email, investor.name, age);
          emailFallbackCount++;
        } catch (emailError) {
          console.error(`[birthday-sms-job] failed to send email fallback to ${investor.email}:`, emailError);
        }
      }
    }

    console.log(
      `[birthday-sms-job] completed: total=${smsResult.total} sms_sent=${smsResult.sent} sms_failed=${smsResult.failed} email_fallback=${emailFallbackCount}`,
    );
  } catch (error) {
    console.error("[birthday-sms-job] failed:", error);
  } finally {
    birthdayJobRunning = false;
  }
}

export function startBirthdaySmsJob() {
  const schedule = env.BIRTHDAY_SMS_CRON || DEFAULT_BIRTHDAY_CRON;
  const timezone = env.BIRTHDAY_SMS_TIMEZONE || "Africa/Lagos";

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid birthday SMS cron expression: ${schedule}`);
  }

  const job = cron.schedule(
    schedule,
    () => {
      if (env.SMS_ENABLED !== true) {
        return;
      }

      void runBirthdaySmsJob();
    },
    {
      timezone,
    },
  );

  if (env.SMS_ENABLED !== true) {
    console.log("Birthday SMS job is inactive - awaiting Twilio compliance approval");
  } else {
    console.log(`[birthday-sms-job] scheduled with cron "${schedule}" (${timezone})`);
  }

  return job;
}
