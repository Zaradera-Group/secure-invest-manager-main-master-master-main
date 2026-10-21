import { adminSupabase } from "../lib/supabase.js";
import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { z } from "zod";
import type { AppRole, AuthenticatedUser } from "../types/certificates.js";
import {
  countUnreadDashboardNotificationsFromMongo,
  getDashboardNotificationFromMongo,
  listDashboardNotificationsFromMongo,
  markNotificationReadInMongo,
  markNotificationReadInMongoSafely,
  markNotificationsReadInMongo,
  markNotificationsReadInMongoSafely,
} from "../repositories/notifications.mongo.js";
import type { NotificationReadFilter } from "../repositories/notifications.mongo.js";
import {
  getNotificationPreferencesFromMongo,
  mirrorNotificationPreferencesToMongoSafely,
} from "../repositories/notification-preferences.mongo.js";
import {
  listNotificationAuditRecordsFromMongo,
  type NotificationAuditTable,
} from "../repositories/notification-audit.mongo.js";

type WorkflowNotificationRole = "manager" | "general_manager" | "ceo" | "investor";
type DashboardNotificationRecord = {
  id: string;
  user_role: WorkflowNotificationRole;
  recipient_user_id: string | null;
  recipient_email: string | null;
};

type NotificationPreferencesRecord = Record<string, unknown> & {
  id: string;
  user_id: string;
  email_enabled: boolean;
  maturity_reminders: boolean;
  payment_reminders: boolean;
  monthly_reports: boolean;
  birthday_notifications: boolean;
  reminder_days_before: number[];
};

const notificationPreferencesSchema = z.object({
  email_enabled: z.boolean().optional(),
  maturity_reminders: z.boolean().optional(),
  payment_reminders: z.boolean().optional(),
  monthly_reports: z.boolean().optional(),
  birthday_notifications: z.boolean().optional(),
  reminder_days_before: z.array(z.number().int().min(0).max(365)).min(1).max(30).optional(),
});

const notificationAdminActionSchema = z.object({
  action: z.enum([
    "retry_failed_jobs",
    "process_queue_now",
    "queue_reminders_now",
    "retry_single_job",
    "retry_selected_jobs",
    "cancel_single_job",
    "cancel_selected_jobs",
  ]),
  batchSize: z.number().int().min(1).max(100).optional(),
  jobId: z.string().uuid().optional(),
  jobIds: z.array(z.string().uuid()).min(1).max(100).optional(),
});

const getWorkflowNotificationRole = (role: AppRole): WorkflowNotificationRole => {
  switch (role) {
    case "investment_manager":
    case "accountant":
      return "manager";
    case "general_manager":
      return "general_manager";
    case "super_admin":
      return "ceo";
    default:
      return "investor";
  }
};

const isVisibleToActor = (notification: DashboardNotificationRecord, actor: AuthenticatedUser) => {
  if (notification.recipient_user_id === actor.id) {
    return true;
  }

  const emailMatches = Boolean(notification.recipient_email)
    && notification.recipient_email!.toLowerCase() === actor.email.toLowerCase();
  const notificationRole = getWorkflowNotificationRole(actor.role);

  return notificationRole === "investor"
    ? emailMatches
    : notification.user_role === notificationRole;
};

export class NotificationsService {
  async executeAdminAction(payload: unknown) {
    const input = notificationAdminActionSchema.parse(payload);
    const now = new Date().toISOString();

    if (input.action === "retry_failed_jobs") {
      const result = await adminSupabase
        .from("notification_jobs")
        .update(this.buildRetryUpdate(now))
        .eq("status", "failed")
        .select("id");
      return this.formatJobUpdate(
        result.data,
        result.error,
        "Requeued failed jobs",
        "Failed to requeue notification jobs",
      );
    }

    if (input.action === "retry_single_job") {
      if (!input.jobId) throw new Error("jobId is required");
      const result = await adminSupabase
        .from("notification_jobs")
        .update(this.buildRetryUpdate(now))
        .eq("id", input.jobId)
        .select("id");
      return this.formatJobUpdate(
        result.data,
        result.error,
        `Requeued job ${input.jobId}`,
        "Failed to requeue notification job",
      );
    }

    if (input.action === "retry_selected_jobs") {
      if (!input.jobIds?.length) throw new Error("jobIds is required");
      const result = await adminSupabase
        .from("notification_jobs")
        .update(this.buildRetryUpdate(now))
        .in("id", input.jobIds)
        .select("id");
      return this.formatJobUpdate(
        result.data,
        result.error,
        "Requeued selected jobs",
        "Failed to requeue notification jobs",
      );
    }

    if (input.action === "cancel_single_job") {
      if (!input.jobId) throw new Error("jobId is required");
      const result = await adminSupabase
        .from("notification_jobs")
        .update(this.buildCancelUpdate(now))
        .eq("id", input.jobId)
        .in("status", ["pending", "failed", "processing"])
        .select("id");
      return this.formatJobUpdate(
        result.data,
        result.error,
        `Cancelled job ${input.jobId}`,
        "Failed to cancel notification job",
      );
    }

    if (input.action === "cancel_selected_jobs") {
      if (!input.jobIds?.length) throw new Error("jobIds is required");
      const result = await adminSupabase
        .from("notification_jobs")
        .update(this.buildCancelUpdate(now))
        .in("id", input.jobIds)
        .in("status", ["pending", "failed", "processing"])
        .select("id");
      return this.formatJobUpdate(
        result.data,
        result.error,
        "Cancelled selected jobs",
        "Failed to cancel notification jobs",
      );
    }

    if (input.action === "queue_reminders_now") {
      const [payment, maturity, birthday, monthly] = await Promise.all([
        this.invokeNotificationRpc("enqueue_payment_reminder_jobs"),
        this.invokeNotificationRpc("enqueue_maturity_reminder_jobs"),
        this.invokeNotificationRpc("enqueue_birthday_notification_jobs"),
        this.invokeNotificationRpc("enqueue_monthly_report_jobs"),
      ]);

      return {
        message: "Queued notification jobs successfully",
        queueSummary: { payment, maturity, birthday, monthly },
      };
    }

    return this.triggerExistingNotificationWorker(input.batchSize ?? 50);
  }

  async getNotificationPreferences(actor: AuthenticatedUser) {
    if (env.NOTIFICATION_PREFERENCES_MONGO_READ_MODE === "mongo" && isMongoConfigured()) {
      try {
        const preferences = await getNotificationPreferencesFromMongo(actor.id);
        if (preferences) return preferences as NotificationPreferencesRecord;
      } catch (error) {
        console.warn("[notification-preferences.mongo] Read failed; falling back to Supabase", {
          userId: actor.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { data, error } = await adminSupabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", actor.id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch notification preferences: ${error.message}`);
    }

    return data as NotificationPreferencesRecord | null;
  }

  async updateNotificationPreferences(actor: AuthenticatedUser, payload: unknown) {
    const updates = notificationPreferencesSchema.parse(payload);
    const existing = await this.getNotificationPreferences(actor);
    const { data, error } = await adminSupabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: actor.id,
          email_enabled: updates.email_enabled ?? existing?.email_enabled ?? true,
          maturity_reminders: updates.maturity_reminders ?? existing?.maturity_reminders ?? true,
          payment_reminders: updates.payment_reminders ?? existing?.payment_reminders ?? true,
          monthly_reports: updates.monthly_reports ?? existing?.monthly_reports ?? true,
          birthday_notifications: updates.birthday_notifications ?? existing?.birthday_notifications ?? true,
          reminder_days_before: updates.reminder_days_before ?? existing?.reminder_days_before ?? [7, 3, 1],
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to update notification preferences: ${error?.message ?? "Unknown error"}`);
    }

    const preferences = data as NotificationPreferencesRecord;
    mirrorNotificationPreferencesToMongoSafely(preferences);
    return preferences;
  }

  async getDashboardNotifications(actor: AuthenticatedUser, limit: number) {
    const requiresMongo = env.NOTIFICATIONS_DATA_SOURCE === "mongo";
    if ((requiresMongo || env.NOTIFICATIONS_MONGO_READ_MODE === "mongo") && isMongoConfigured()) {
      try {
        return await listDashboardNotificationsFromMongo(this.getMongoNotificationReadFilter(actor), limit);
      } catch (error) {
        console.warn("[notifications.mongo] MongoDB dashboard read failed; falling back to Supabase", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (requiresMongo) throw new Error("MongoDB is required when NOTIFICATIONS_DATA_SOURCE=mongo");

    const { data, error } = await adminSupabase
      .from("notifications")
      .select("*")
      .or(this.getDashboardNotificationFilter(actor))
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch dashboard notifications: ${error.message}`);
    }

    return data ?? [];
  }

  async getUnreadDashboardNotificationCount(actor: AuthenticatedUser) {
    const requiresMongo = env.NOTIFICATIONS_DATA_SOURCE === "mongo";
    if ((requiresMongo || env.NOTIFICATIONS_MONGO_READ_MODE === "mongo") && isMongoConfigured()) {
      try {
        return await countUnreadDashboardNotificationsFromMongo(this.getMongoNotificationReadFilter(actor));
      } catch (error) {
        console.warn("[notifications.mongo] MongoDB unread-count read failed; falling back to Supabase", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (requiresMongo) throw new Error("MongoDB is required when NOTIFICATIONS_DATA_SOURCE=mongo");

    const { count, error } = await adminSupabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("is_read", false)
      .or(this.getDashboardNotificationFilter(actor));

    if (error) {
      throw new Error(`Failed to fetch unread notification count: ${error.message}`);
    }

    return count ?? 0;
  }

  async markDashboardNotificationRead(actor: AuthenticatedUser, notificationId: string) {
    if (env.NOTIFICATIONS_DATA_SOURCE === "mongo") {
      const notification = await getDashboardNotificationFromMongo(notificationId) as DashboardNotificationRecord | null;
      if (!notification || !isVisibleToActor(notification, actor)) throw new Error("Notification not found");
      await markNotificationReadInMongo(notificationId, new Date().toISOString());
      return;
    }

    const { data, error } = await adminSupabase
      .from("notifications")
      .select("id, user_role, recipient_user_id, recipient_email")
      .eq("id", notificationId)
      .maybeSingle<DashboardNotificationRecord>();

    if (error || !data || !isVisibleToActor(data, actor)) {
      throw new Error("Notification not found");
    }

    const readAt = new Date().toISOString();
    const { error: updateError } = await adminSupabase
      .from("notifications")
      .update({ is_read: true, read_at: readAt })
      .eq("id", notificationId);

    if (updateError) {
      throw new Error(`Failed to mark notification as read: ${updateError.message}`);
    }

    markNotificationReadInMongoSafely(notificationId, readAt);
  }

  async markAllDashboardNotificationsRead(actor: AuthenticatedUser) {
    const readAt = new Date().toISOString();
    if (env.NOTIFICATIONS_DATA_SOURCE === "mongo") {
      await markNotificationsReadInMongo(this.getMongoNotificationReadFilter(actor), readAt);
      return;
    }

    const { error } = await adminSupabase
      .from("notifications")
      .update({ is_read: true, read_at: readAt })
      .eq("is_read", false)
      .or(this.getDashboardNotificationFilter(actor));

    if (error) {
      throw new Error(`Failed to mark notifications as read: ${error.message}`);
    }

    markNotificationsReadInMongoSafely(this.getMongoNotificationReadFilter(actor), readAt);
  }

  async getAuditRecords(table: NotificationAuditTable, orderColumn: string, page: number, pageSize: number) {
    if (env.NOTIFICATION_AUDIT_MONGO_READ_MODE === "mongo" && isMongoConfigured()) {
      try {
        return await listNotificationAuditRecordsFromMongo(table, page, pageSize);
      } catch (error) {
        console.warn("[notification-audit.mongo] Read failed; falling back to Supabase", {
          table,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await adminSupabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch notification audit records: ${error.message}`);
    }

    return data ?? [];
  }

  private getDashboardNotificationFilter(actor: AuthenticatedUser) {
    const notificationRole = getWorkflowNotificationRole(actor.role);

    if (notificationRole === "investor") {
      return `recipient_user_id.eq.${actor.id},recipient_email.eq.${actor.email.toLowerCase()}`;
    }

    return `recipient_user_id.eq.${actor.id},user_role.eq.${notificationRole}`;
  }

  private getMongoNotificationReadFilter(actor: AuthenticatedUser): NotificationReadFilter {
    return {
      recipientUserId: actor.id,
      recipientEmail: actor.email.toLowerCase(),
      userRole: getWorkflowNotificationRole(actor.role),
    };
  }

  private buildRetryUpdate(scheduledFor: string) {
    return {
      status: "pending",
      scheduled_for: scheduledFor,
      locked_at: null,
      processed_at: null,
      last_error: null,
    };
  }

  private buildCancelUpdate(processedAt: string) {
    return {
      status: "cancelled",
      locked_at: null,
      processed_at: processedAt,
      last_error: null,
    };
  }

  private formatJobUpdate(
    data: Array<{ id: string }> | null,
    error: { message: string } | null,
    message: string,
    failureMessage: string,
  ) {
    if (error) throw new Error(`${failureMessage}: ${error.message}`);
    return { message: `${message}: ${data?.length ?? 0}`, affectedJobs: data?.length ?? 0 };
  }

  private async invokeNotificationRpc(functionName: string) {
    const { data, error } = await adminSupabase.rpc(functionName);
    if (error) throw new Error(`Failed to queue notifications: ${error.message}`);
    return data ?? 0;
  }

  private async triggerExistingNotificationWorker(batchSize: number) {
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/process-notification-jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batchSize }),
      signal: AbortSignal.timeout(env.SUPABASE_REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`Notification worker failed: ${body || response.statusText}`);
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      return { message: "Notification queue processing triggered" };
    }
  }
}
