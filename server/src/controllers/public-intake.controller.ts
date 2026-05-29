import type { Request, Response } from "express";
import { ZodError } from "zod";
import { createPublicInvestorIntake } from "../services/public-intake.service.js";

export const submitPublicInvestorIntake = async (request: Request, response: Response) => {
  try {
    const result = await createPublicInvestorIntake(request.body, {
      ip: request.ip,
      userAgent: request.get("user-agent"),
    });
    response.status(201).json({
      message: "Investor intake submitted successfully.",
      requestId: result.requestId,
      assigneeEmail: result.assigneeEmail,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        message: "Validation failed",
        issues: error.flatten(),
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    const status =
      message.includes("not configured") || message.includes("temporarily unavailable")
        ? 503
        : message.includes("verification") || message.includes("Spam protection")
          ? 403
          : 500;
    response.status(status).json({ message });
  }
};
