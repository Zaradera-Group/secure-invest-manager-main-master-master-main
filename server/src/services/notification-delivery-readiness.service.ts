import {
  listActiveNotificationQueueJobsFromMongo,
  type MirroredNotificationQueueJobRecord,
} from "../repositories/notification-queue.mongo.js";

const supportedInvestmentTypes = new Set(["Monthly", "Quarterly", "At Maturity"]);
const supportedNotificationTypes = new Set([
  "payment_reminder",
  "maturity_reminder",
  "birthday_greeting",
  "monthly_report",
]);

type RawNotificationJob = Record<string, unknown> & {
  notification_type?: unknown;
  user_id?: unknown;
  investor_id?: unknown;
  payload?: unknown;
};

export type NotificationDeliveryReadinessReport = {
  examined: number;
  ready: number;
  unsupported: number;
  invalid: number;
  byType: Record<string, number>;
  invalidReasons: Record<string, number>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

function validateJob(record: MirroredNotificationQueueJobRecord): string | null {
  const job = record.rawSupabaseRecord as RawNotificationJob;
  const notificationType = typeof job.notification_type === "string" ? job.notification_type : "";
  if (!supportedNotificationTypes.has(notificationType)) return `unsupported:${notificationType || "missing"}`;

  const payload = asRecord(job.payload);
  if (notificationType === "payment_reminder") {
    if (!hasText(job.investor_id)) return "payment_reminder:missing_investor_id";
    if (!supportedInvestmentTypes.has(String(payload.investmentType ?? ""))) return "payment_reminder:unsupported_investment_type";
    return null;
  }

  if (notificationType === "maturity_reminder") {
    return hasText(job.investor_id) ? null : "maturity_reminder:missing_investor_id";
  }

  if (!hasText(job.user_id)) return `${notificationType}:missing_user_id`;
  if (!hasText(payload.email)) return `${notificationType}:missing_email`;
  return null;
}

export class NotificationDeliveryReadinessService {
  async inspectActiveQueue(limit = 500): Promise<NotificationDeliveryReadinessReport> {
    const records = await listActiveNotificationQueueJobsFromMongo(limit);
    const report: NotificationDeliveryReadinessReport = {
      examined: records.length,
      ready: 0,
      unsupported: 0,
      invalid: 0,
      byType: {},
      invalidReasons: {},
    };

    for (const record of records) {
      const job = record.rawSupabaseRecord as RawNotificationJob;
      const notificationType = typeof job.notification_type === "string" ? job.notification_type : "missing";
      report.byType[notificationType] = (report.byType[notificationType] ?? 0) + 1;

      const validationError = validateJob(record);
      if (!validationError) {
        report.ready += 1;
        continue;
      }

      report.invalidReasons[validationError] = (report.invalidReasons[validationError] ?? 0) + 1;
      if (validationError.startsWith("unsupported:")) report.unsupported += 1;
      else report.invalid += 1;
    }

    return report;
  }
}

export const notificationDeliveryReadinessService = new NotificationDeliveryReadinessService();
