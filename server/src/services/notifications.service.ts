import { adminSupabase } from "../lib/supabase.js";
import { z } from "zod";
import type { AppRole, AuthenticatedUser } from "../types/certificates.js";

type WorkflowNotificationRole = "manager" | "general_manager" | "ceo" | "investor";
type AuditTable =
  | "email_notifications"
  | "notification_jobs"
  | "job_runs"
  | "email_notifications_archive"
  | "notification_jobs_archive"
  | "job_runs_archive";

type DashboardNotificationRecord = {
  id: string;
  user_role: WorkflowNotificationRole;
  recipient_user_id: string | null;
  recipient_email: string | null;
};

const notificationPreferencesSchema = z.object({
  email_enabled: z.boolean().optional(),
  maturity_reminders: z.boolean().optional(),
  payment_reminders: z.boolean().optional(),
  monthly_reports: z.boolean().optional(),
  birthday_notifications: z.boolean().optional(),
  reminder_days_before: z.array(z.number().int().min(0).max(365)).min(1).max(30).optional(),
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
  async getNotificationPreferences(actor: AuthenticatedUser) {
    const { data, error } = await adminSupabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", actor.id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch notification preferences: ${error.message}`);
    }

    return data;
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

    return data;
  }

  async getDashboardNotifications(actor: AuthenticatedUser, limit: number) {
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
    const { data, error } = await adminSupabase
      .from("notifications")
      .select("id, user_role, recipient_user_id, recipient_email")
      .eq("id", notificationId)
      .maybeSingle<DashboardNotificationRecord>();

    if (error || !data || !isVisibleToActor(data, actor)) {
      throw new Error("Notification not found");
    }

    const { error: updateError } = await adminSupabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);

    if (updateError) {
      throw new Error(`Failed to mark notification as read: ${updateError.message}`);
    }
  }

  async markAllDashboardNotificationsRead(actor: AuthenticatedUser) {
    const { error } = await adminSupabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false)
      .or(this.getDashboardNotificationFilter(actor));

    if (error) {
      throw new Error(`Failed to mark notifications as read: ${error.message}`);
    }
  }

  async getAuditRecords(table: AuditTable, orderColumn: string, page: number, pageSize: number) {
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
}
