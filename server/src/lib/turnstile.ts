import { env } from "../config/env.js";

export async function verifyTurnstileToken(token: string, remoteIp?: string | null) {
  if (!env.TURNSTILE_SECRET_KEY) {
    throw new Error("Human verification is not configured");
  }

  if (!token) {
    throw new Error("Human verification token is required");
  }

  const verificationResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
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

    throw Object.assign(new Error(message), { errors });
  }

  return {
    success: true,
    mode: env.TURNSTILE_TEST_MODE ? "test" : "live",
  } as const;
}
