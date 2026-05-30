import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env.js";

type ConsentTokenPayload = {
  phone: string;
  exp: number;
};

const CONSENT_TOKEN_TTL_MS = 15 * 60 * 1000;

export function createPublicIntakeConsentToken(phone: string) {
  const secret = getConsentSecret();
  const payload: ConsentTokenPayload = {
    phone: normalizePhone(phone),
    exp: Date.now() + CONSENT_TOKEN_TTL_MS,
  };

  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = signPayload(payloadPart, secret);

  return `${payloadPart}.${signaturePart}`;
}

export function verifyPublicIntakeConsentToken(token: string, phone: string) {
  const secret = getConsentSecret();
  const [payloadPart, signaturePart] = token.split(".");

  if (!payloadPart || !signaturePart) {
    throw new Error("Invalid consent token");
  }

  const expectedSignature = signPayload(payloadPart, secret);
  const signatureMatches =
    signaturePart.length === expectedSignature.length
    && timingSafeEqual(Buffer.from(signaturePart), Buffer.from(expectedSignature));

  if (!signatureMatches) {
    throw new Error("Invalid consent token");
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart)) as ConsentTokenPayload;
  if (!payload?.phone || !payload?.exp) {
    throw new Error("Invalid consent token");
  }

  if (payload.exp < Date.now()) {
    throw new Error("Consent token has expired");
  }

  if (normalizePhone(payload.phone) !== normalizePhone(phone)) {
    throw new Error("Consent token does not match this phone number");
  }

  return payload;
}

function getConsentSecret() {
  if (!env.PUBLIC_INTAKE_CONSENT_TOKEN_SECRET) {
    throw new Error("Public intake consent is not configured");
  }

  return env.PUBLIC_INTAKE_CONSENT_TOKEN_SECRET;
}

function normalizePhone(phone: string) {
  return phone.trim().replace(/\s+/g, "");
}

function signPayload(payloadPart: string, secret: string) {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}
