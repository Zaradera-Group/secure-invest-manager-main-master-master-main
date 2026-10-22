import type { Request, Response } from "express";
import { AnnouncementsService, AnnouncementValidationError } from "../services/announcements.service.js";

const service = new AnnouncementsService();

const getBoundedNumber = (value: unknown, fallback: number, maximum: number) => {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
};

const handleError = (response: Response, error: unknown) => {
  const status = error instanceof AnnouncementValidationError ? 400 : 500;
  response.status(status).json({ message: error instanceof Error ? error.message : "Unexpected error" });
};

export const listAnnouncements = async (request: Request, response: Response) => {
  try {
    const page = getBoundedNumber(request.query.page, 0, 10_000);
    const pageSize = Math.max(1, getBoundedNumber(request.query.pageSize, 8, 100));
    response.json(await service.list(page, pageSize));
  } catch (error) {
    handleError(response, error);
  }
};

export const createAnnouncement = async (request: Request, response: Response) => {
  try {
    response.status(201).json(await service.create(request.body));
  } catch (error) {
    handleError(response, error);
  }
};

export const deleteAnnouncement = async (request: Request, response: Response) => {
  try {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    await service.remove(id);
    response.status(204).send();
  } catch (error) {
    handleError(response, error);
  }
};
