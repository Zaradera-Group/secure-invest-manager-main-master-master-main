import { Router } from "express";
import { env } from "../config/env.js";

export const authRouter = Router();

authRouter.post("/verify-human", async (request, response) => {
  const token = typeof request.body?.token === "string" ? request.body.token : "";

  if (!env.TURNSTILE_SECRET_KEY) {
    response.status(503).json({ message: "Human verification is not configured" });
    return;
  }

  if (!token) {
    response.status(400).json({ message: "Human verification token is required" });
    return;
  }

  try {
    const verificationResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const verification = (await verificationResponse.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (!verification.success) {
      const errors = verification["error-codes"] ?? [];
      let message = "Human verification failed";

      if (errors.includes("110200")) {
        message = "Cloudflare rejected this hostname. Add your current domain or localhost in Turnstile hostname settings.";
      }

      response.status(403).json({
        message,
        errors,
      });
      return;
    }

    response.json({
      success: true,
      mode: env.TURNSTILE_TEST_MODE ? "test" : "live",
    });
  } catch (error) {
    console.error("[auth] Turnstile verification request failed:", error);
    response.status(503).json({
      message: "Human verification is temporarily unavailable. Please try again shortly.",
    });
  }
});
