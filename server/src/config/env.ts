import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  RESEND_API_KEY: z.string().optional().transform((value) => value?.trim() || undefined),
  RESEND_FROM_EMAIL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.string().email().optional()),
  EMAIL_DELIVERY_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  TWILIO_ACCOUNT_SID: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_AUTH_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_FROM_NUMBER: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional().transform((value) => value?.trim() || undefined),
  SMS_DELIVERY_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  BIRTHDAY_SMS_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  BIRTHDAY_SMS_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  BIRTHDAY_SMS_TIMEZONE: z.string().optional().transform((value) => value?.trim() || undefined),
  PUBLIC_INTAKE_ASSIGNEE_USER_ID: z.string().optional().transform((value) => value?.trim() || undefined),
  PUBLIC_INTAKE_NOTIFY_EMAIL: z.string().optional().transform((value) => value?.trim() || undefined),
  TURNSTILE_SECRET_KEY: z.string().optional().transform((value) => value?.trim() || undefined),
  TURNSTILE_TEST_MODE: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  CERTIFICATE_STORAGE_BUCKET: z.string().min(1).default("certificates"),
  CERTIFICATE_TEMPLATE_PATH: z.string().optional().transform((value) => value?.trim() || undefined),
});

export const env = envSchema.parse(process.env);
