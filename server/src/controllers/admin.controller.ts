import type { Request, Response } from "express";
import { AdminService } from "../services/admin.service.js";

const service = new AdminService();

const handleError = (response: Response, error: unknown) => {
  response.status(500).json({ message: error instanceof Error ? error.message : "Unexpected error" });
};

export const getCreatorDirectory = async (_request: Request, response: Response) => {
  try {
    response.json(await service.getCreatorDirectory());
  } catch (error) {
    handleError(response, error);
  }
};

export const getRoleCounts = async (_request: Request, response: Response) => {
  try {
    response.json(await service.getRoleCounts());
  } catch (error) {
    handleError(response, error);
  }
};

export const getRecentInvestorActivity = async (request: Request, response: Response) => {
  try {
    const requestedLimit = typeof request.query.limit === "string" ? Number.parseInt(request.query.limit, 10) : 10;
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 10;
    response.json(await service.getRecentInvestorActivity(limit));
  } catch (error) {
    handleError(response, error);
  }
};
