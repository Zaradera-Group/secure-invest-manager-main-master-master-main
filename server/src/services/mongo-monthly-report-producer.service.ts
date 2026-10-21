import { enqueueNotificationDelivery, type NotificationDeliveryMode } from "../repositories/notification-delivery-outbox.mongo.js";
import { getNotificationPreferencesFromMongo } from "../repositories/notification-preferences.mongo.js";
import { listActiveStaffContactsByRoles, type StaffContact } from "../repositories/staff-contacts.mongo.js";
import { listWorkflowRecordsFromMongo } from "../repositories/workflow-data.mongo.js";

type InvestorRecord = Record<string, unknown> & {
  id?: unknown;
  created_by?: unknown;
  name?: unknown;
  investment_amount?: unknown;
  maturity_date?: unknown;
  investment_type?: unknown;
  liquidation_status?: unknown;
  created_at?: unknown;
};

export type MonthlyReportStats = {
  total_investments: number;
  active_investments: number;
  matured_this_month: number;
  total_investment_value: number;
  maturing_next_month: number;
  recent_investments: Array<{ name: string; amount: number; maturity_date: string; investment_type: string }>;
};

export type MongoMonthlyReportProducerReport = {
  evaluated: number;
  eligible: number;
  missingRecipients: number;
  disabledByPreference: number;
  inserted: number;
  alreadyQueued: number;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const dateOnly = (value: unknown) => text(value).slice(0, 10);
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const nextMonthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
const monthAfterNextStart = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 2, 1);

function dateInRange(value: string, start: Date, end: Date) {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
}

export function buildMongoMonthlyReportStats(investors: InvestorRecord[], userId: string, now = new Date()): MonthlyReportStats {
  const owned = investors.filter((investor) => text(investor.created_by) === userId);
  const thisMonth = monthStart(now);
  const nextMonth = nextMonthStart(now);
  const monthAfterNext = monthAfterNextStart(now);
  const recentCutoff = now.getTime() - 30 * 86_400_000;

  return {
    total_investments: owned.length,
    active_investments: owned.filter((investor) => text(investor.liquidation_status) === "Active").length,
    matured_this_month: owned.filter((investor) => text(investor.liquidation_status) === "Liquidated" && dateInRange(dateOnly(investor.maturity_date), thisMonth, nextMonth)).length,
    total_investment_value: owned.reduce((sum, investor) => sum + Number(investor.investment_amount ?? 0), 0),
    maturing_next_month: owned.filter((investor) => text(investor.liquidation_status) === "Active" && dateInRange(dateOnly(investor.maturity_date), nextMonth, monthAfterNext)).length,
    recent_investments: owned
      .filter((investor) => {
        const createdAt = Date.parse(text(investor.created_at));
        return Number.isFinite(createdAt) && createdAt >= recentCutoff;
      })
      .sort((left, right) => Date.parse(text(right.created_at)) - Date.parse(text(left.created_at)))
      .slice(0, 5)
      .map((investor) => ({
        name: text(investor.name) || "Investor",
        amount: Number(investor.investment_amount ?? 0),
        maturity_date: dateOnly(investor.maturity_date),
        investment_type: text(investor.investment_type),
      })),
  };
}

export async function produceMongoMonthlyReportDeliveries(deliveryMode: NotificationDeliveryMode, now = new Date()): Promise<MongoMonthlyReportProducerReport> {
  const [investors, contacts] = await Promise.all([
    listWorkflowRecordsFromMongo("investors") as Promise<InvestorRecord[]>,
    listActiveStaffContactsByRoles(["investment_manager", "accountant", "general_manager", "super_admin", "admin"]),
  ]);
  const report: MongoMonthlyReportProducerReport = { evaluated: contacts.length, eligible: 0, missingRecipients: 0, disabledByPreference: 0, inserted: 0, alreadyQueued: 0 };
  const reportMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  for (const contact of contacts as StaffContact[]) {
    if (!contact.email) { report.missingRecipients += 1; continue; }
    const preferences = await getNotificationPreferencesFromMongo(contact.userId) as { email_enabled?: unknown; monthly_reports?: unknown } | null;
    if (preferences?.email_enabled !== true || preferences.monthly_reports !== true) { report.disabledByPreference += 1; continue; }
    const stats = buildMongoMonthlyReportStats(investors, contact.userId, now);
    const result = await enqueueNotificationDelivery({
      notificationType: "monthly_report",
      channel: "email",
      deliveryMode,
      recipient: contact.email,
      dedupeKey: `monthly_report:${contact.userId}:${reportMonth}`,
      payload: { staffUserId: contact.userId, reportMonth, stats },
    });
    report.eligible += 1;
    if (result.inserted) report.inserted += 1; else report.alreadyQueued += 1;
  }
  return report;
}
