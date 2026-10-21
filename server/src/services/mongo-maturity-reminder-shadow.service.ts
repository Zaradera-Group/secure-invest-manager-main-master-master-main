import { listWorkflowRecordsFromMongo } from "../repositories/workflow-data.mongo.js";

type InvestorReminderRecord = Record<string, unknown> & {
  id?: unknown;
  created_by?: unknown;
  liquidation_status?: unknown;
  maturity_date?: unknown;
  email?: unknown;
};

export type MongoMaturityReminderShadowReport = {
  evaluated: number;
  eligible: number;
  missingEmail: number;
  dueToday: number;
  dueInFiveDays: number;
  invalidMaturityDate: number;
};

const localDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const daysBetweenDateKeys = (from: string, to: string) => {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return Number.NaN;
    return Date.UTC(year, month - 1, day);
  };
  const fromMs = parse(from);
  const toMs = parse(to);
  return Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.round((toMs - fromMs) / 86_400_000) : Number.NaN;
};

const dateOnly = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 10) : "";
const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export async function inspectMongoMaturityReminderCandidates(now = new Date()): Promise<MongoMaturityReminderShadowReport> {
  const investors = await listWorkflowRecordsFromMongo("investors") as InvestorReminderRecord[];
  const today = localDateKey(now);
  const report: MongoMaturityReminderShadowReport = {
    evaluated: investors.length,
    eligible: 0,
    missingEmail: 0,
    dueToday: 0,
    dueInFiveDays: 0,
    invalidMaturityDate: 0,
  };

  for (const investor of investors) {
    if (!hasText(investor.id) || !hasText(investor.created_by) || investor.liquidation_status !== "Active") continue;

    const daysUntilMaturity = daysBetweenDateKeys(today, dateOnly(investor.maturity_date));
    if (!Number.isFinite(daysUntilMaturity)) {
      report.invalidMaturityDate += 1;
      continue;
    }
    if (daysUntilMaturity !== 0 && daysUntilMaturity !== 5) continue;

    report.eligible += 1;
    if (!hasText(investor.email)) report.missingEmail += 1;
    if (daysUntilMaturity === 0) report.dueToday += 1;
    if (daysUntilMaturity === 5) report.dueInFiveDays += 1;
  }

  return report;
}
