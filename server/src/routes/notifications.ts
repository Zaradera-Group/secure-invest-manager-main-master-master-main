import { Router } from "express";
import {
  getArchivedEmailNotificationAudit,
  getArchivedJobRunAudit,
  getArchivedNotificationJobAudit,
  executeAdminNotificationAction,
  getDashboardNotifications,
  getEmailNotificationAudit,
  getJobRunAudit,
  getNotificationJobAudit,
  getNotificationPreferences,
  getUnreadDashboardNotificationCount,
  markAllDashboardNotificationsRead,
  markDashboardNotificationRead,
  updateNotificationPreferences,
} from "../controllers/notifications.controller.js";
import { requireRole, requireWorkflowAuth } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireWorkflowAuth);

const staffRoles = ["investment_manager", "accountant", "general_manager", "admin", "super_admin"] as const;

notificationsRouter.get("/dashboard", requireRole(...staffRoles), getDashboardNotifications);
notificationsRouter.get("/dashboard/unread-count", requireRole(...staffRoles), getUnreadDashboardNotificationCount);
notificationsRouter.patch("/dashboard/read-all", requireRole(...staffRoles), markAllDashboardNotificationsRead);
notificationsRouter.patch("/dashboard/:id/read", requireRole(...staffRoles), markDashboardNotificationRead);
notificationsRouter.get("/preferences", requireRole(...staffRoles), getNotificationPreferences);
notificationsRouter.patch("/preferences", requireRole(...staffRoles), updateNotificationPreferences);
notificationsRouter.post("/admin-actions", requireRole("admin"), executeAdminNotificationAction);

notificationsRouter.get("/audit/email", requireRole("admin", "super_admin"), getEmailNotificationAudit);
notificationsRouter.get("/audit/jobs", requireRole("admin", "super_admin"), getNotificationJobAudit);
notificationsRouter.get("/audit/job-runs", requireRole("admin", "super_admin"), getJobRunAudit);
notificationsRouter.get("/audit/archive/email", requireRole("admin", "super_admin"), getArchivedEmailNotificationAudit);
notificationsRouter.get("/audit/archive/jobs", requireRole("admin", "super_admin"), getArchivedNotificationJobAudit);
notificationsRouter.get("/audit/archive/job-runs", requireRole("admin", "super_admin"), getArchivedJobRunAudit);
