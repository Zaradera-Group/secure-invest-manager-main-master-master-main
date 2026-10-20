import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AccessService } from "../services/access.service.js";

const service = new AccessService();

const handleError = (response: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  response.status(error instanceof ZodError ? 400 : 500).json({ message });
};

export const getApprovedEmailAccess = async (request: Request, response: Response) => {
  try {
    response.json(await service.isApprovedEmail(request.body));
  } catch (error) {
    handleError(response, error);
  }
};

export const getApprovedUserAccess = async (request: Request, response: Response) => {
  try {
    response.json(await service.getApprovedUser(request.body));
  } catch (error) {
    handleError(response, error);
  }
};
