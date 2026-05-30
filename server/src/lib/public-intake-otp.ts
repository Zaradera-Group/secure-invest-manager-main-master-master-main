import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { env } from "../config/env.js";

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

type PublicIntakeOtpRecord = {
  id: string;
  phone: string;
  email: string | null;
  code_hash: string;
  attempt_count: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

export function generatePublicIntakeOtpCode() {
  const value = randomInt(0, 10 ** OTP_LENGTH);
  return String(value).padStart(OTP_LENGTH, "0");
}

export function hashPublicIntakeOtpCode(code: string) {
  const secret = getOtpSecret();
  return createHmac("sha256", secret).update(normalizeOtp(code)).digest("base64url");
}

export function isOtpExpired(record: PublicIntakeOtpRecord) {
  return new Date(record.expires_at).getTime() <= Date.now();
}

export function isOtpConsumed(record: PublicIntakeOtpRecord) {
  return !!record.consumed_at;
}

export function isOtpAttemptsExceeded(record: PublicIntakeOtpRecord) {
  return record.attempt_count >= record.max_attempts;
}

export function verifyPublicIntakeOtpCode(code: string, record: PublicIntakeOtpRecord) {
  const expectedHash = hashPublicIntakeOtpCode(code);
  const actualHash = record.code_hash;

  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash));
}

export function createOtpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MS).toISOString();
}

export function getOtpMaxAttempts() {
  return OTP_MAX_ATTEMPTS;
}

export function normalizeOtp(value: string) {
  return value.trim().replace(/\D+/g, "");
}

function getOtpSecret() {
  if (!env.PUBLIC_INTAKE_CONSENT_TOKEN_SECRET) {
    throw new Error("Public intake consent is not configured");
  }

  return env.PUBLIC_INTAKE_CONSENT_TOKEN_SECRET;
}
