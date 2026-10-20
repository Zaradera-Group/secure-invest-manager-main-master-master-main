import type { Request, Response } from "express";
import { ZodError } from "zod";
import {
  deletePublicIntakeRequest,
  getPublicIntakeRequestForStaff,
  listPublicIntakeRequests,
  reviewPublicIntakeRequest,
} from "../services/public-intake.service.js";

const getRequestId = (value: string | string[] | undefined) => {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error("Public intake request ID is required");
};

const handleError = (response: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const status = error instanceof ZodError ? 400 : message.includes("not found") ? 404 : 500;
  response.status(status).json({ message });
};

export const listIntakeRequests = async (_request: Request, response: Response) => {
  try {
    response.json(await listPublicIntakeRequests());
  } catch (error) {
    handleError(response, error);
  }
};

export const getIntakeRequest = async (request: Request, response: Response) => {
  try {
    response.json(await getPublicIntakeRequestForStaff(getRequestId(request.params.id)));
  } catch (error) {
    handleError(response, error);
  }
};

export const updateIntakeRequest = async (request: Request, response: Response) => {
  try {
    response.json(await reviewPublicIntakeRequest(getRequestId(request.params.id), request.authUser!, request.body));
  } catch (error) {
    handleError(response, error);
  }
};

export const removeIntakeRequest = async (request: Request, response: Response) => {
  try {
    await deletePublicIntakeRequest(getRequestId(request.params.id));
    response.status(204).end();
  } catch (error) {
    handleError(response, error);
  }
};
