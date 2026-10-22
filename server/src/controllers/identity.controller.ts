import type { Request, Response } from "express";
import { ZodError } from "zod";
import { IdentityService } from "../services/identity.service.js";

const service = new IdentityService();

const handleError = (response: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  response.status(error instanceof ZodError || message.includes("5 MB") ? 400 : 500).json({ message });
};

export const uploadInvestorPassport = async (request: Request, response: Response) => {
  try {
    response.status(201).json(await service.uploadPassport(request.authUser!, request.body));
  } catch (error) {
    handleError(response, error);
  }
};
