import type { Request, Response } from "express";
import { ZodError } from "zod";
import { ApprovalAvailabilityService } from "../services/approval-availability.service.js";

const service = new ApprovalAvailabilityService();

const handleError = (response: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const status = error instanceof ZodError
    ? 400
    : message === "Forbidden for current role"
      ? 403
      : 500;

  response.status(status).json({ message });
};

export const getApprovalAvailability = async (request: Request, response: Response) => {
  try {
    response.json(await service.get(request.authUser!));
  } catch (error) {
    handleError(response, error);
  }
};

export const updateApprovalAvailability = async (request: Request, response: Response) => {
  try {
    response.json(await service.update(request.authUser!, request.body));
  } catch (error) {
    handleError(response, error);
  }
};
