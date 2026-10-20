import { adminSupabase } from "../lib/supabase.js";
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
