import { Router } from "express";
import {
  getArchivedEmailNotificationAudit,
  getArchivedJobRunAudit,
  getArchivedNotificationJobAudit,
  getDashboardNotifications,
  getEmailNotificationAudit,
  getJobRunAudit,
  getNotificationJobAudit,
  getUnreadDashboardNotificationCount,
  markAllDashboardNotificationsRead,
  markDashboardNotificationRead,
} from "../controllers/notifications.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const staffRoles = ["investment_manager", "accountant", "general_manager", "admin", "super_admin"] as const;

notificationsRouter.get("/dashboard", requireRole(...staffRoles), getDashboardNotifications);
notificationsRouter.get("/dashboard/unread-count", requireRole(...staffRoles), getUnreadDashboardNotificationCount);
notificationsRouter.patch("/dashboard/read-all", requireRole(...staffRoles), markAllDashboardNotificationsRead);
notificationsRouter.patch("/dashboard/:id/read", requireRole(...staffRoles), markDashboardNotificationRead);

notificationsRouter.get("/audit/email", requireRole("admin", "super_admin"), getEmailNotificationAudit);
notificationsRouter.get("/audit/jobs", requireRole("admin", "super_admin"), getNotificationJobAudit);
notificationsRouter.get("/audit/job-runs", requireRole("admin", "super_admin"), getJobRunAudit);
notificationsRouter.get("/audit/archive/email", requireRole("admin", "super_admin"), getArchivedEmailNotificationAudit);
notificationsRouter.get("/audit/archive/jobs", requireRole("admin", "super_admin"), getArchivedNotificationJobAudit);
notificationsRouter.get("/audit/archive/job-runs", requireRole("admin", "super_admin"), getArchivedJobRunAudit);
