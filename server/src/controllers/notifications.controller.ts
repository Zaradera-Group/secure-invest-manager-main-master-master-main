import type { Request, Response } from "express";
import { ZodError } from "zod";
import { NotificationsService } from "../services/notifications.service.js";

const service = new NotificationsService();

const getRouteParam = (value: string | string[] | undefined) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  throw new Error("Missing route parameter");
};

const getBoundedInteger = (value: unknown, fallback: number, maximum: number) => {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
};

const handleError = (response: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  response.status(error instanceof ZodError ? 400 : message.includes("not found") ? 404 : 500).json({ message });
};

export const getNotificationPreferences = async (request: Request, response: Response) => {
  try {
    response.json(await service.getNotificationPreferences(request.authUser!));
  } catch (error) {
    handleError(response, error);
  }
};

export const updateNotificationPreferences = async (request: Request, response: Response) => {
  try {
    response.json(await service.updateNotificationPreferences(request.authUser!, request.body));
  } catch (error) {
    handleError(response, error);
  }
};

export const executeAdminNotificationAction = async (request: Request, response: Response) => {
  try {
    response.json(await service.executeAdminAction(request.body));
  } catch (error) {
    handleError(response, error);
  }
};

export const getDashboardNotifications = async (request: Request, response: Response) => {
  try {
    const limit = Math.max(1, getBoundedInteger(request.query.limit, 20, 100));
    response.json(await service.getDashboardNotifications(request.authUser!, limit));
  } catch (error) {
    handleError(response, error);
  }
};

export const getUnreadDashboardNotificationCount = async (request: Request, response: Response) => {
  try {
    response.json({ count: await service.getUnreadDashboardNotificationCount(request.authUser!) });
  } catch (error) {
    handleError(response, error);
  }
};

export const markDashboardNotificationRead = async (request: Request, response: Response) => {
  try {
    await service.markDashboardNotificationRead(request.authUser!, getRouteParam(request.params.id));
    response.status(204).end();
  } catch (error) {
    handleError(response, error);
  }
};

export const markAllDashboardNotificationsRead = async (request: Request, response: Response) => {
  try {
    await service.markAllDashboardNotificationsRead(request.authUser!);
    response.status(204).end();
  } catch (error) {
    handleError(response, error);
  }
};

const getAuditRecords = (table: Parameters<NotificationsService["getAuditRecords"]>[0], orderColumn: string) =>
  async (request: Request, response: Response) => {
    try {
      const page = getBoundedInteger(request.query.page, 0, 10_000);
      const pageSize = Math.max(1, getBoundedInteger(request.query.pageSize, 20, 100));
      response.json(await service.getAuditRecords(table, orderColumn, page, pageSize));
    } catch (error) {
      handleError(response, error);
    }
  };

export const getEmailNotificationAudit = getAuditRecords("email_notifications", "sent_at");
export const getNotificationJobAudit = getAuditRecords("notification_jobs", "scheduled_for");
export const getJobRunAudit = getAuditRecords("job_runs", "started_at");
export const getArchivedEmailNotificationAudit = getAuditRecords("email_notifications_archive", "archived_at");
export const getArchivedNotificationJobAudit = getAuditRecords("notification_jobs_archive", "archived_at");
export const getArchivedJobRunAudit = getAuditRecords("job_runs_archive", "archived_at");
