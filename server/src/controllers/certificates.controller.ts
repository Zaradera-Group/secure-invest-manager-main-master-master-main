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
  if (error instanceof ZodError) {
    response.status(400).json({
      message: "Validation failed",
      issues: error.flatten(),
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  const status =
    message === "Forbidden for current role" || message === "Forbidden for current user"
      ? 403
      : message === "Invalid JWT"
        ? 401
        : message.includes("not found")
          ? 404
          : message.includes("Validation")
            ? 400
            : 500;

  response.status(status).json({ message });
};

export const createCertificate = async (request: Request, response: Response) => {
  try {
    const certificate = await service.createCertificate(request.authUser!, request.body);
    response.status(201).json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const getLatestCertificateByInvestor = async (request: Request, response: Response) => {
  try {
    const investorEmail = typeof request.query.email === "string" ? request.query.email : "";
    const investorName = typeof request.query.name === "string" ? request.query.name : "";
    const investorId = typeof request.query.investorId === "string" ? request.query.investorId : null;

    if ((!investorEmail || !investorName) && !investorId) {
      response.status(400).json({ message: "Investor email and name are required" });
      return;
    }

    const certificate = await service.getLatestCertificateForInvestor(
      request.authUser!,
      investorEmail,
      investorName,
      investorId,
    );

    response.json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const managerApprove = async (request: Request, response: Response) => {
  try {
    const certificate = await service.managerApprove(
      getRouteParam(request.params.id),
      request.authUser!,
      request.body,
    );
    response.json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const generalManagerApprove = async (request: Request, response: Response) => {
  try {
    const certificate = await service.generalManagerApprove(
      getRouteParam(request.params.id),
      request.authUser!,
      request.body,
    );
    response.json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const ceoApprove = async (request: Request, response: Response) => {
  try {
    const certificate = await service.ceoApprove(
      getRouteParam(request.params.id),
      request.authUser!,
      request.body,
    );
    response.json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const sendCertificate = async (request: Request, response: Response) => {
  try {
    const certificate = await service.sendCertificate(getRouteParam(request.params.id), request.authUser!);
    response.json(certificate);
  } catch (error) {
    handleError(response, error);
  }
};

export const getCertificateDownloadUrl = async (request: Request, response: Response) => {
  try {
    const certificateId = getRouteParam(request.params.id);
    console.info("[certificates.controller] Download URL requested", {
      certificateId,
      actorId: request.authUser?.id,
      actorRole: request.authUser?.role,
    });

    const result = await service.createDownloadUrl(certificateId, request.authUser!);
    console.info("[certificates.controller] Download URL created", {
      certificateId,
      hasSignedUrl: Boolean(result.signedUrl),
    });
    response.json(result);
  } catch (error) {
    console.error("[certificates.controller] Download URL request failed", {
      certificateId: request.params.id,
      actorId: request.authUser?.id,
      actorRole: request.authUser?.role,
      message: error instanceof Error ? error.message : "Unexpected error",
    });
    handleError(response, error);
  }
};

export const getCertificateFile = async (request: Request, response: Response) => {
  try {
    const certificateId = getRouteParam(request.params.id);
    console.info("[certificates.controller] PDF file requested", {
      certificateId,
      actorId: request.authUser?.id,
      actorRole: request.authUser?.role,
    });

    const result = await service.getCertificatePdfFile(certificateId, request.authUser!);
    console.info("[certificates.controller] PDF file ready", {
      certificateId,
      fileName: result.fileName,
      byteLength: result.bytes.length,
    });
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `inline; filename="${result.fileName}"`);
    response.send(result.bytes);
  } catch (error) {
    console.error("[certificates.controller] PDF file request failed", {
      certificateId: request.params.id,
      actorId: request.authUser?.id,
      actorRole: request.authUser?.role,
      message: error instanceof Error ? error.message : "Unexpected error",
    });
    handleError(response, error);
  }
};
