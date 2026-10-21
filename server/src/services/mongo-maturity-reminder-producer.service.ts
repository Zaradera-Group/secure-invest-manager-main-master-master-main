import { enqueueNotificationDelivery, type NotificationDeliveryMode } from "../repositories/notification-delivery-outbox.mongo.js";
import { getNotificationPreferencesFromMongo } from "../repositories/notification-preferences.mongo.js";
import { getStaffContactFromMongo } from "../repositories/staff-contacts.mongo.js";
import { listWorkflowRecordsFromMongo } from "../repositories/workflow-data.mongo.js";

type InvestorRecord = Record<string, unknown> & {
  id?: unknown;
  created_by?: unknown;
  liquidation_status?: unknown;
  maturity_date?: unknown;
  name?: unknown;
  investment_type?: unknown;
  investment_amount?: unknown;
};

type PreferenceRecord = { maturity_reminders?: unknown };

export type MongoMaturityReminderProducerReport = {
  evaluated: number;
  eligible: number;
  missingStaffMapping: number;
  disabledByPreference: number;
  inserted: number;
  alreadyQueued: number;
  invalidMaturityDate: number;
};

const localDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const daysBetweenDateKeys = (from: string, to: string) => {
  const [year, month, day] = to.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.UTC(year, month - 1, day);
  return Number.isFinite(fromMs) ? Math.round((toMs - fromMs) / 86_400_000) : Number.NaN;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const dateOnly = (value: unknown) => text(value).slice(0, 10);

export async function produceMongoMaturityReminderDeliveries(
  deliveryMode: NotificationDeliveryMode,
  now = new Date(),
): Promise<MongoMaturityReminderProducerReport> {
  const investors = await listWorkflowRecordsFromMongo("investors") as InvestorRecord[];
  const today = localDateKey(now);
  const report: MongoMaturityReminderProducerReport = {
    evaluated: investors.length,
    eligible: 0,
    missingStaffMapping: 0,
    disabledByPreference: 0,
    inserted: 0,
    alreadyQueued: 0,
    invalidMaturityDate: 0,
  };

  for (const investor of investors) {
    const investorId = text(investor.id);
    const managerId = text(investor.created_by);
    if (!investorId || !managerId || investor.liquidation_status !== "Active") continue;

    const maturityDate = dateOnly(investor.maturity_date);
    const daysUntilMaturity = daysBetweenDateKeys(today, maturityDate);
    if (!Number.isFinite(daysUntilMaturity)) {
      report.invalidMaturityDate += 1;
      continue;
    }
    if (daysUntilMaturity !== 0 && daysUntilMaturity !== 5) continue;
    report.eligible += 1;

    const [staffContact, preference] = await Promise.all([
      getStaffContactFromMongo(managerId),
      getNotificationPreferencesFromMongo(managerId),
    ]);
    if (!staffContact?.isActive || !staffContact.roles.includes("investment_manager") || !staffContact.email) {
      report.missingStaffMapping += 1;
      continue;
    }
    if ((preference as PreferenceRecord | null)?.maturity_reminders !== true) {
      report.disabledByPreference += 1;
      continue;
    }

    const dedupeKey = `maturity:${investorId}:${daysUntilMaturity}:${maturityDate}:email`;
    const result = await enqueueNotificationDelivery({
      notificationType: "maturity_reminder",
      channel: "email",
      deliveryMode,
      recipient: staffContact.email,
      dedupeKey,
      payload: {
        investorId,
        investorName: text(investor.name) || "Investor",
        investmentType: text(investor.investment_type),
        investmentAmount: Number(investor.investment_amount ?? 0),
        maturityDate,
        daysUntilMaturity,
        staffUserId: managerId,
        staffEmail: staffContact.email,
      },
    });
    if (result.inserted) report.inserted += 1;
    else report.alreadyQueued += 1;
  }

  return report;
}
