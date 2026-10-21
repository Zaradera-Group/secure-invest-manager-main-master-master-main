import { adminSupabase } from "../lib/supabase.js";

const queueStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;

type NotificationJobStatus = (typeof queueStatuses)[number];

export type NotificationWorkerQueueSnapshot = {
  observedAt: string;
  statusCounts: Record<NotificationJobStatus, number>;
  duePending: number;
  staleProcessing: number;
};

const countJobs = async (status: NotificationJobStatus, filters?: { dueBefore?: string; lockedBefore?: string }) => {
  let query = adminSupabase
    .from("notification_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (filters?.dueBefore) query = query.lte("scheduled_for", filters.dueBefore);
  if (filters?.lockedBefore) query = query.lte("locked_at", filters.lockedBefore);

  const { count, error } = await query;
  if (error) throw new Error(`Failed to inspect ${status} notification jobs: ${error.message}`);
  return count ?? 0;
};

export class NotificationWorkerShadowService {
  async inspectQueue(now = new Date()): Promise<NotificationWorkerQueueSnapshot> {
    const observedAt = now.toISOString();
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

    const [pending, processing, completed, failed, cancelled, duePending, staleProcessing] = await Promise.all([
      countJobs("pending"),
      countJobs("processing"),
      countJobs("completed"),
      countJobs("failed"),
      countJobs("cancelled"),
      countJobs("pending", { dueBefore: observedAt }),
      countJobs("processing", { lockedBefore: staleBefore }),
    ]);

    return {
      observedAt,
      statusCounts: { pending, processing, completed, failed, cancelled },
      duePending,
      staleProcessing,
    };
  }
}

export const notificationWorkerShadowService = new NotificationWorkerShadowService();
