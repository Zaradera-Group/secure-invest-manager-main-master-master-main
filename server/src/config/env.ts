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
  AUTH0_EMAIL_CLAIM: z.string().default("https://zaraderavest.com/email"),
  AUTH0_WORKFLOW_ACCESS_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
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
  // Mirrors birthday SMS intent to the MongoDB outbox but does not change or send live delivery.
  BIRTHDAY_OUTBOX_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  // The legacy direct sender remains the default until the Render birthday worker is accepted.
  BIRTHDAY_DELIVERY_AUTHORITY: z.enum(["legacy", "render"]).default("legacy"),
  // Mirrors certificate-stage delivery intent to MongoDB without changing its current sender.
  CERTIFICATE_NOTIFICATION_OUTBOX_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY: z.enum(["legacy", "render"]).default("legacy"),
  // Mirrors public-intake receipt email intent to MongoDB without changing the current sender.
  PUBLIC_INTAKE_EMAIL_OUTBOX_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  // The direct sender remains the default until public-intake receipt outbox delivery is accepted.
  PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY: z.enum(["legacy", "render"]).default("legacy"),
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
  PUBLIC_INTAKE_WRITE_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  PUBLIC_INTAKE_OTP_STORAGE_MODE: z.enum(["supabase", "mongo"]).default("mongo"),
  NOTIFICATIONS_MONGO_MIRROR_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  NOTIFICATIONS_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  // Mongo-primary notification state is limited to dashboard reads and read acknowledgements.
  NOTIFICATIONS_DATA_SOURCE: z.enum(["supabase", "mongo"]).default("supabase"),
  NOTIFICATIONS_WRITE_MODE: z.enum(["supabase", "dual", "mongo"]).default("supabase"),
  NOTIFICATION_PREFERENCES_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  // Keep Supabase authoritative until every reminder producer reads MongoDB preferences.
  NOTIFICATION_PREFERENCES_DATA_SOURCE: z.enum(["supabase", "mongo"]).default("supabase"),
  NOTIFICATION_PREFERENCES_WRITE_MODE: z.enum(["supabase", "dual", "mongo"]).default("supabase"),
  NOTIFICATION_AUDIT_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  NOTIFICATION_AUDIT_MONGO_RECONCILIATION_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  NOTIFICATION_AUDIT_MONGO_RECONCILIATION_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  // Shadow mode is read-only. The legacy Supabase Edge worker remains the only delivery worker.
  NOTIFICATION_WORKER_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  NOTIFICATION_WORKER_SHADOW_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  NOTIFICATION_QUEUE_MONGO_RECONCILIATION_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  NOTIFICATION_QUEUE_MONGO_RECONCILIATION_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  // Read-only maturity reminder candidate calculation from MongoDB. It never queues or sends a message.
  MONGO_MATURITY_REMINDER_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  MONGO_MATURITY_REMINDER_SHADOW_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  // Shadow producer writes only non-claimable outbox records for comparison with Supabase jobs.
  MONGO_MATURITY_REMINDER_OUTBOX_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  MONGO_MATURITY_REMINDER_PRODUCER_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  // Render is not authoritative until the shadow outbox, recipient mappings, and dashboard notifications are accepted.
  MATURITY_REMINDER_DELIVERY_AUTHORITY: z.enum(["legacy", "render"]).default("legacy"),
  MONGO_PAYMENT_REMINDER_OUTBOX_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  MONGO_PAYMENT_REMINDER_PRODUCER_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  PAYMENT_REMINDER_DELIVERY_AUTHORITY: z.enum(["legacy", "render"]).default("legacy"),
  MONGO_MONTHLY_REPORT_OUTBOX_SHADOW_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  MONGO_MONTHLY_REPORT_PRODUCER_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  MONTHLY_REPORT_DELIVERY_AUTHORITY: z.enum(["legacy", "render"]).default("legacy"),
  // This remains false until a Mongo-native notification producer and delivery worker are approved together.
  NOTIFICATION_RENDER_WORKER_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  NOTIFICATION_RENDER_WORKER_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  NOTIFICATION_RENDER_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  SECURITY_AUDIT_MONGO_MIRROR_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  SECURITY_AUDIT_MONGO_WRITE_MODE: z.enum(["supabase", "dual", "mongo"]).default("supabase"),
  AUDIT_LOGS_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  AUDIT_LOGS_MONGO_RECONCILIATION_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  AUDIT_LOGS_MONGO_RECONCILIATION_CRON: z.string().optional().transform((value) => value?.trim() || undefined),
  AUDIT_LOGS_MONGO_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  WORKFLOW_DATA_MONGO_MIRROR_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === "true")),
  // Supabase remains authoritative in supabase mode. Dual mode makes Mongo mirroring synchronous and failure-visible.
  WORKFLOW_DATA_MONGO_WRITE_MODE: z.enum(["supabase", "dual", "mongo"]).default("supabase"),
  WORKFLOW_DATA_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  CERTIFICATES_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  ANNOUNCEMENTS_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  ANNOUNCEMENTS_DATA_SOURCE: z.enum(["supabase", "mongo"]).default("supabase"),
  ANNOUNCEMENTS_WRITE_MODE: z.enum(["supabase", "dual", "mongo"]).default("supabase"),
  STAFF_DIRECTORY_MONGO_READ_MODE: z.enum(["supabase", "mongo"]).default("supabase"),
  STAFF_DIRECTORY_MONGO_WRITE_MODE: z.enum(["supabase", "dual", "mongo"]).default("supabase"),
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
  // During the S3 cutover, allow reads of objects not copied yet to fall back to Supabase Storage.
  STORAGE_S3_READ_FALLBACK_TO_SUPABASE: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
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
  MIGRATION_HEALTH_CHECK_ENABLED: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  MIGRATION_HEALTH_CHECK_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  CERTIFICATE_STORAGE_BUCKET: z.string().min(1).default("certificates"),
  INVESTOR_PASSPORT_STORAGE_BUCKET: z.string().min(1).default("investor-passports"),
  CERTIFICATE_TEMPLATE_PATH: z.string().optional().transform((value) => value?.trim() || undefined),
}).superRefine((value, context) => {
  if (value.AUTH0_WORKFLOW_ACCESS_ENABLED && value.AUTH_MODE === "supabase") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_MODE"],
      message: "AUTH_MODE must be dual or auth0 when AUTH0_WORKFLOW_ACCESS_ENABLED=true",
    });
  }

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

  const mongoAuthorityEnabled = value.WORKFLOW_DATA_MONGO_WRITE_MODE !== "supabase"
    || value.PUBLIC_INTAKE_MONGO_READ_MODE === "mongo"
    || value.PUBLIC_INTAKE_WRITE_MODE !== "supabase"
    || value.PUBLIC_INTAKE_OTP_STORAGE_MODE === "mongo"
    || value.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo"
    || value.STAFF_DIRECTORY_MONGO_WRITE_MODE !== "supabase"
    || value.NOTIFICATION_AUDIT_MONGO_READ_MODE === "mongo"
    || value.AUDIT_LOGS_MONGO_READ_MODE === "mongo"
    || value.NOTIFICATION_PREFERENCES_DATA_SOURCE === "mongo"
    || value.NOTIFICATION_PREFERENCES_WRITE_MODE === "mongo"
    || value.NOTIFICATIONS_DATA_SOURCE === "mongo"
    || value.NOTIFICATIONS_WRITE_MODE === "mongo"
    || value.ANNOUNCEMENTS_WRITE_MODE === "mongo"
    || value.ANNOUNCEMENTS_DATA_SOURCE === "mongo"
    || value.SECURITY_AUDIT_MONGO_WRITE_MODE === "mongo";
  if (mongoAuthorityEnabled && (!value.MONGODB_URI || !value.MONGODB_DB_NAME)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MONGODB_URI"],
      message: "MONGODB_URI and MONGODB_DB_NAME are required when MongoDB authority is enabled",
    });
  }

  if (value.STORAGE_PROVIDER === "s3" && (!value.S3_BUCKET || !value.S3_REGION || !value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["S3_BUCKET"],
      message: "S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER=s3",
    });
  }

  const renderDeliveryAuthorityEnabled = [
    value.BIRTHDAY_DELIVERY_AUTHORITY,
    value.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY,
    value.PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY,
    value.MATURITY_REMINDER_DELIVERY_AUTHORITY,
    value.PAYMENT_REMINDER_DELIVERY_AUTHORITY,
    value.MONTHLY_REPORT_DELIVERY_AUTHORITY,
  ].some((authority) => authority === "render");
  if (renderDeliveryAuthorityEnabled && !value.NOTIFICATION_RENDER_WORKER_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NOTIFICATION_RENDER_WORKER_ENABLED"],
      message: "NOTIFICATION_RENDER_WORKER_ENABLED=true is required when any delivery authority is render",
    });
  }
  if (renderDeliveryAuthorityEnabled && (!value.MONGODB_URI || !value.MONGODB_DB_NAME)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MONGODB_URI"],
      message: "MONGODB_URI and MONGODB_DB_NAME are required when any delivery authority is render",
    });
  }
});

export const env = envSchema.parse(process.env);
