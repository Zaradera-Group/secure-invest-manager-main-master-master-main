import { env } from "../config/env.js";
import { enqueueNotificationDelivery, type NotificationDeliveryMode } from "../repositories/notification-delivery-outbox.mongo.js";
import { getNotificationPreferencesFromMongo } from "../repositories/notification-preferences.mongo.js";
import { listActiveStaffContactsByRoles, type StaffContact } from "../repositories/staff-contacts.mongo.js";
import { listWorkflowRecordsFromMongo } from "../repositories/workflow-data.mongo.js";

type InvestorRecord = Record<string, unknown> & {
  id?: unknown;
  created_by?: unknown;
  liquidation_status?: unknown;
  name?: unknown;
  investment_type?: unknown;
  investment_amount?: unknown;
  percentage?: unknown;
  tenure?: unknown;
  start_date?: unknown;
  maturity_date?: unknown;
};

type PaymentCandidate = {
  investorId: string;
  managerId: string;
  investorName: string;
  investmentType: "Monthly" | "Quarterly" | "At Maturity";
  paymentAmount: number;
  reminderType: string;
  nextPaymentDate: string;
  maturityDate: string;
};

export type MongoPaymentReminderProducerReport = {
  evaluated: number;
  eligible: number;
  missingRecipients: number;
  disabledByPreference: number;
  inserted: number;
  alreadyQueued: number;
  invalidDates: number;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const dateOnly = (value: unknown) => text(value).slice(0, 10);
const millisecondsPerDay = 86_400_000;

const localDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  return Date.UTC(year, month - 1, day);
}

function toDateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getPaymentCandidate(investor: InvestorRecord, today: string): PaymentCandidate | null | "invalid" {
  const investorId = text(investor.id);
  const managerId = text(investor.created_by);
  const investmentType = text(investor.investment_type);
  if (!investorId || !managerId || investor.liquidation_status !== "Active") return null;
  if (investmentType !== "Monthly" && investmentType !== "Quarterly" && investmentType !== "At Maturity") return null;

  const todayMs = parseDateKey(today);
  const maturityDate = dateOnly(investor.maturity_date);
  const maturityMs = parseDateKey(maturityDate);
  const amount = Number(investor.investment_amount ?? 0);
  const percentage = Number(investor.percentage ?? 0);
  const tenure = Number(investor.tenure ?? 0);
  if (!Number.isFinite(todayMs) || !Number.isFinite(maturityMs) || !Number.isFinite(amount) || !Number.isFinite(percentage)) return "invalid";

  let nextPaymentMs: number;
  let paymentAmount: number;
  let reminderType: string;
  let windowDays: number;
  if (investmentType === "At Maturity") {
    nextPaymentMs = maturityMs;
    paymentAmount = Math.round(amount * (percentage / 100) * tenure * 100) / 100;
    reminderType = "Maturity Payment Due";
    windowDays = 30;
  } else {
    const startMs = parseDateKey(dateOnly(investor.start_date));
    if (!Number.isFinite(startMs)) return "invalid";
    const intervalDays = investmentType === "Monthly" ? 30 : 90;
    const intervalCount = Math.floor(Math.max(0, Math.floor((todayMs - startMs) / millisecondsPerDay)) / intervalDays) + 1;
    nextPaymentMs = startMs + intervalCount * intervalDays * millisecondsPerDay;
    paymentAmount = Math.round(amount * (percentage / 100) * (investmentType === "Monthly" ? 1 : 3) * 100) / 100;
    reminderType = investmentType === "Monthly" ? "Monthly Payment Due" : "Quarterly Payment Due";
    windowDays = investmentType === "Monthly" ? 3 : 7;
  }

  const daysUntilPayment = Math.round((nextPaymentMs - todayMs) / millisecondsPerDay);
  if (daysUntilPayment < 0 || daysUntilPayment > windowDays) return null;
  return {
    investorId,
    managerId,
    investorName: text(investor.name) || "Investor",
    investmentType,
    paymentAmount,
    reminderType,
    nextPaymentDate: toDateKey(nextPaymentMs),
    maturityDate,
  };
}

async function getEligibleRecipients(managerId: string, contacts: StaffContact[]) {
  const candidates = contacts.filter((contact) => contact.roles.includes("super_admin") || contact.userId === managerId);
  const preferences = await Promise.all(candidates.map(async (contact) => ({
    contact,
    preferences: await getNotificationPreferencesFromMongo(contact.userId),
  })));
  return preferences.filter(({ contact, preferences }) => Boolean(
    contact.email
    && (preferences as { email_enabled?: unknown; payment_reminders?: unknown } | null)?.email_enabled === true
    && (preferences as { payment_reminders?: unknown } | null)?.payment_reminders === true,
  )).map(({ contact }) => contact);
}

export async function produceMongoPaymentReminderDeliveries(
  deliveryMode: NotificationDeliveryMode,
  now = new Date(),
): Promise<MongoPaymentReminderProducerReport> {
  const [investors, contacts] = await Promise.all([
    listWorkflowRecordsFromMongo("investors") as Promise<InvestorRecord[]>,
    listActiveStaffContactsByRoles(["investment_manager", "super_admin"]),
  ]);
  const report: MongoPaymentReminderProducerReport = {
    evaluated: investors.length,
    eligible: 0,
    missingRecipients: 0,
    disabledByPreference: 0,
    inserted: 0,
    alreadyQueued: 0,
    invalidDates: 0,
  };
  const today = localDateKey(now);

  for (const investor of investors) {
    const candidate = getPaymentCandidate(investor, today);
    if (candidate === "invalid") {
      report.invalidDates += 1;
      continue;
    }
    if (!candidate) continue;
    report.eligible += 1;

    const recipients = await getEligibleRecipients(candidate.managerId, contacts);
    if (!recipients.length) {
      const hasPotentialRecipient = contacts.some((contact) => contact.roles.includes("super_admin") || contact.userId === candidate.managerId);
      if (hasPotentialRecipient) report.disabledByPreference += 1;
      else report.missingRecipients += 1;
      continue;
    }

    for (const recipient of recipients) {
      const payload = { ...candidate, staffUserId: recipient.userId, staffEmail: recipient.email };
      const channels: Array<"email" | "sms"> = ["email"];
      if (recipient.phone && env.SMS_ENABLED === true) channels.push("sms");
      for (const channel of channels) {
        const result = await enqueueNotificationDelivery({
          notificationType: "payment_reminder",
          channel,
          deliveryMode,
          recipient: channel === "email" ? recipient.email! : recipient.phone!,
          payload,
          dedupeKey: `payment:${candidate.investorId}:${candidate.nextPaymentDate}:${recipient.userId}:${channel}`,
        });
        if (result.inserted) report.inserted += 1;
        else report.alreadyQueued += 1;
      }
    }
  }
  return report;
}
