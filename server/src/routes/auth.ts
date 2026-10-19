import { Router } from "express";
import { verifyTurnstileToken } from "../lib/turnstile.js";
import { requireDualAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.get("/me", requireDualAuth, (request, response) => {
  response.json({
    id: request.authUser!.id,
    email: request.authUser!.email || null,
    role: request.authUser!.role,
    provider: request.authUser!.provider ?? "supabase",
    permissions: request.authUser!.permissions ?? [],
  });
});

authRouter.post("/verify-human", async (request, response) => {
  const token = typeof request.body?.token === "string" ? request.body.token : "";

  try {
    const verification = await verifyTurnstileToken(token);

    response.json({
      success: verification.success,
      mode: verification.mode,
    });
  } catch (error) {
    console.error("[auth] Turnstile verification request failed:", error);
    const message = error instanceof Error ? error.message : "Human verification failed";
    const status = message.includes("not configured") || message.includes("temporarily unavailable") ? 503 : 400;
    response.status(status).json({
      message,
    });
  }
});
