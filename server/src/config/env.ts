import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config();

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: resolve(currentDir, "../../..", ".env"),
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  AUTH_MODE: z.enum(["supabase", "dual", "auth0"]).default("supabase"),
  AUTH0_ISSUER_BASE_URL: z.string().url().optional().transform((value) => value?.trim().replace(/\/+$/, "") || undefined),
  AUTH0_AUDIENCE: z.string().optional().transform((value) => value?.trim() || undefined),
  AUTH0_ROLES_CLAIM: z.string().default("https://zaraderavest.com/roles"),
  MONGODB_URI: z.string().optional().transform((value) => value?.trim() || undefined),
  MONGODB_DB_NAME: z.string().optional().transform((value) => value?.trim() || undefined),
  EMAIL_PROVIDER: z.enum(["resend", "smtp"]).default("resend"),
  RESEND_API_KEY: z.string().optional().transform((value) => value?.trim() || undefined),
  RESEND_FROM_EMAIL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.string().email().optional()),
  SMTP_HOST: z.string().optional().transform((value) => value?.trim() || undefined),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  SMTP_USER: z.string().optional().transform((value) => value?.trim() || undefined),
  SMTP_PASS: z.string().optional().transform((value) => value?.trim() || undefined),
  SMTP_FROM_EMAIL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.string().email().optional()),
  SMTP_FROM_NAME: z.string().optional().transform((value) => value?.trim() || undefined),
  EMAIL_REDIRECT_TO: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.string().email().optional()),
  EMAIL_DELIVERY_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  SMS_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "true")),
  TWILIO_ACCOUNT_SID: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_AUTH_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_FROM_NUMBER: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_PHONE_NUMBER: z.string().optional().transform((value) => value?.trim() || undefined),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional().transform((value) => value?.trim() || undefined),
  SMS_DELIVERY_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "true")),
  BIRTHDAY_SMS_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "true")),
  BIRTHDAY_SMS_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  BIRTHDAY_SMS_TIMEZONE: z.string().optional().transform((value) => value?.trim() || undefined),
  PUBLIC_INTAKE_ASSIGNEE_USER_ID: z.string().optional().transform((value) => value?.trim() || undefined),
  PUBLIC_INTAKE_NOTIFY_EMAIL: z.string().optional().transform((value) => value?.trim() || undefined),
  PUBLIC_INTAKE_CONSENT_TOKEN_SECRET: z.string().optional().transform((value) => value?.trim() || undefined),
  PUBLIC_INTAKE_MONGO_MIRROR_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  PUBLIC_INTAKE_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  NOTIFICATIONS_MONGO_MIRROR_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  NOTIFICATIONS_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  NOTIFICATION_PREFERENCES_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  WORKFLOW_DATA_MONGO_MIRROR_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  WORKFLOW_DATA_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  CERTIFICATES_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  ANNOUNCEMENTS_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  STAFF_DIRECTORY_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  TURNSTILE_SECRET_KEY: z.string().optional().transform((value) => value?.trim() || undefined),
  TURNSTILE_TEST_MODE: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  STORAGE_PROVIDER: z.enum(["supabase", "s3"]).default("supabase"),
  S3_BUCKET: z.string().optional().transform((value) => value?.trim() || undefined),
  S3_REGION: z.string().optional().transform((value) => value?.trim() || undefined),
  S3_ACCESS_KEY_ID: z.string().optional().transform((value) => value?.trim() || undefined),
  S3_SECRET_ACCESS_KEY: z.string().optional().transform((value) => value?.trim() || undefined),
  S3_PREFIX: z.string().optional().transform((value) => value?.trim().replace(/^\/+|\/+$/g, "") || undefined),
  S3_SIGNED_URL_EXPIRES_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_HEALTH_CHECK_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  STORAGE_HEALTH_CHECK_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  EMAIL_HEALTH_CHECK_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  EMAIL_HEALTH_CHECK_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  CERTIFICATE_STORAGE_BUCKET: z.string().min(1).default("certificates"),
  INVESTOR_PASSPORT_STORAGE_BUCKET: z.string().min(1).default("investor-passports"),
  CERTIFICATE_TEMPLATE_PATH: z.string().optional().transform((value) => value?.trim() || undefined),
}).superRefine((value, context) => {
  if (value.AUTH_MODE === "supabase") {
    return;
  }

  if (!value.AUTH0_ISSUER_BASE_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH0_ISSUER_BASE_URL"],
      message: "AUTH0_ISSUER_BASE_URL is required when AUTH_MODE is dual or auth0",
    });
  }

  if (!value.AUTH0_AUDIENCE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH0_AUDIENCE"],
      message: "AUTH0_AUDIENCE is required when AUTH_MODE is dual or auth0",
    });
  }
});

export const env = envSchema.parse(process.env);
