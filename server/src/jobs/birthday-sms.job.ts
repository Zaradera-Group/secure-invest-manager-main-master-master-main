import cron from "node-cron";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { adminSupabase } from "../lib/supabase.js";
import { sendBirthdaySmsBatch } from "../lib/sms.js";
import { sendBirthdayEmail } from "../lib/email.js";
import { listWorkflowRecordsFromMongo } from "../repositories/workflow-data.mongo.js";
import { enqueueNotificationDelivery } from "../repositories/notification-delivery-outbox.mongo.js";

type BirthdayInvestor = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  date_of_birth: string | null;
};

const DEFAULT_BIRTHDAY_CRON = "0 8 * * *";
let birthdayJobRunning = false;

async function getTodaysBirthdayInvestors(now = new Date()) {
  const investors = await getBirthdayInvestorCandidates();
  const todayMonth = now.getMonth() + 1;
  const todayDate = now.getDate();

  return investors.filter((investor) => {
    if (!investor.date_of_birth) {
      return false;
    }

    const dob = new Date(investor.date_of_birth);
    return dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDate;
  });
}

async function getBirthdayInvestorCandidates(): Promise<BirthdayInvestor[]> {
  if (env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo" && isMongoConfigured()) {
    try {
      return (await listWorkflowRecordsFromMongo("investors"))
        .map(toBirthdayInvestor)
        .filter((investor): investor is BirthdayInvestor => investor !== null);
    } catch (error) {
      console.warn("[birthday-sms-job] MongoDB investor read failed; falling back to Supabase", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { data, error } = await adminSupabase
    .from("investors")
    .select("id, name, email, phone, date_of_birth")
    .not("date_of_birth", "is", null)
    .not("phone", "is", null);

  if (error) {
    throw new Error(`Failed to load birthday investors: ${error.message}`);
  }

  return (data ?? []).map(toBirthdayInvestor).filter((investor): investor is BirthdayInvestor => investor !== null);
}

function toBirthdayInvestor(candidate: Record<string, unknown>): BirthdayInvestor | null {
  if (
    typeof candidate.id !== "string"
    || typeof candidate.name !== "string"
    || typeof candidate.phone !== "string"
    || typeof candidate.date_of_birth !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    email: typeof candidate.email === "string" ? candidate.email : null,
    phone: candidate.phone,
    date_of_birth: candidate.date_of_birth,
  };
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

    const outboxResult = await enqueueBirthdaySmsToOutbox(investors, now);
    if (env.BIRTHDAY_DELIVERY_AUTHORITY === "render") {
      if (!outboxResult) throw new Error("Render birthday authority requires a configured MongoDB outbox");
      if (outboxResult.failed > 0) throw new Error(`Failed to enqueue ${outboxResult.failed} birthday delivery job(s)`);
      console.log(`[birthday-sms-job] queued for Render delivery: total=${investors.length} inserted=${outboxResult.inserted} existing=${outboxResult.existing}`);
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
      `[birthday-sms-job] completed: total=${smsResult.total} sms_sent=${smsResult.sent} sms_failed=${smsResult.failed} email_fallback=${emailFallbackCount}${outboxResult ? ` outbox_shadow_inserted=${outboxResult.inserted} outbox_shadow_existing=${outboxResult.existing} outbox_shadow_failed=${outboxResult.failed}` : ""}`,
    );
  } catch (error) {
    console.error("[birthday-sms-job] failed:", error);
  } finally {
    birthdayJobRunning = false;
  }
}

async function enqueueBirthdaySmsToOutbox(investors: BirthdayInvestor[], now: Date) {
  const deliveryMode = env.BIRTHDAY_DELIVERY_AUTHORITY === "render" ? "live" : "shadow";
  if (deliveryMode === "shadow" && !env.BIRTHDAY_OUTBOX_SHADOW_ENABLED) return null;
  if (!isMongoConfigured()) {
    console.warn("[birthday-sms-job] MongoDB birthday outbox is enabled but MongoDB is not configured");
    return null;
  }

  const dateKey = now.toISOString().slice(0, 10);
  const results = await Promise.allSettled(investors.map((investor) => enqueueNotificationDelivery({
    notificationType: "birthday_greeting",
    channel: "sms",
    deliveryMode,
    recipient: investor.phone,
    payload: {
      investorId: investor.id,
      investorName: investor.name,
      email: investor.email,
      dateOfBirth: investor.date_of_birth,
      eventDate: dateKey,
    },
    dedupeKey: `birthday_greeting:sms:${investor.id}:${dateKey}`,
  })));

  return results.reduce((summary, result) => {
    if (result.status === "rejected") {
      summary.failed += 1;
    } else if (result.value.inserted) {
      summary.inserted += 1;
    } else {
      summary.existing += 1;
    }
    return summary;
  }, { inserted: 0, existing: 0, failed: 0 });
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
