import type { Request, Response } from "express";
import { ZodError } from "zod";
import { CertificatesService } from "../services/certificates.service.js";

const service = new CertificatesService();

const getRouteParam = (value: string | string[] | undefined) => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value[0]) {
    return value[0];
  }

  throw new Error("Missing route parameter");
};

const handleError = (response: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const status =
    error instanceof ZodError
      ? 400
      : message === "Forbidden for current role"
      || message.includes("can only")
      ? 403
      : message.includes("not found")
        ? 404
        : 500;

  response.status(status).json({ message });
};

export const refreshInvestorCertificate = async (request: Request, response: Response) => {
  try {
    const investorId = getRouteParam(request.params.id);
    const certificate = await service.refreshCertificateForInvestor(request.authUser!, investorId);
    response.json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const createInvestor = async (request: Request, response: Response) => {
  try {
    const investor = await service.createInvestor(request.authUser!, request.body);
    response.status(201).json(investor);
  } catch (error) {
    handleError(response, error);
  }
};

export const getInvestor = async (request: Request, response: Response) => {
  try {
    const investorId = getRouteParam(request.params.id);
    const investor = await service.getInvestorForRead(investorId);
    response.json(investor);
  } catch (error) {
    handleError(response, error);
  }
};

export const updateInvestorAndRefreshCertificate = async (request: Request, response: Response) => {
  try {
    const investorId = getRouteParam(request.params.id);
    const investor = await service.updateInvestorAndRefreshCertificate(request.authUser!, investorId, request.body);
    response.json(investor);
  } catch (error) {
    handleError(response, error);
  }
};

export const deleteInvestorCompletely = async (request: Request, response: Response) => {
  try {
    const investorId = getRouteParam(request.params.id);
    const result = await service.permanentlyDeleteInvestor(request.authUser!, investorId);
    response.json(result);
  } catch (error) {
    handleError(response, error);
  }
};
