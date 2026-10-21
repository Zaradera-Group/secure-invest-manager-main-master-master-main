import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AccessService } from "../services/access.service.js";
import { Auth0StaffAccountService } from "../services/auth0-staff-account.service.js";

const service = new AccessService();
const auth0StaffAccountService = new Auth0StaffAccountService();

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

export const provisionAuth0StaffAccount = async (request: Request, response: Response) => {
  try {
    response.status(201).json(await auth0StaffAccountService.provision(request.authUser!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    response.status(message.includes("not approved") || message.includes("does not match") || message.includes("already linked") ? 403 : 500)
      .json({ message });
  }
};
