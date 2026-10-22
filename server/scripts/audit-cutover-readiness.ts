import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";
import { env } from "../src/config/env.js";
import { workflowMirrorTables } from "../src/repositories/workflow-data.mongo.js";
import { listStaffAccounts } from "../src/repositories/staff-accounts.mongo.js";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
}

async function compareTable(table: (typeof workflowMirrorTables)[number]) {
  const { count, error } = await adminSupabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Failed to count Supabase ${table}: ${error.message}`);
  const mongoCount = await (await getMongoDb()).collection(table).countDocuments();
  check(`workflow:${table}`, (count ?? 0) === mongoCount, `Supabase=${count ?? 0}, Mongo=${mongoCount}`);
}

async function compareCollection(table: string) {
  const { count, error } = await adminSupabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Failed to count Supabase ${table}: ${error.message}`);
  const mongoCount = await (await getMongoDb()).collection(table).countDocuments();
  check(`reconciliation:${table}`, (count ?? 0) === mongoCount, `Supabase=${count ?? 0}, Mongo=${mongoCount}`);
}

async function main() {
  check("mongo-configured", isMongoConfigured(), "MONGODB_URI and MONGODB_DB_NAME must be configured");
  const auth0Ready = env.AUTH_MODE === "dual" || env.AUTH_MODE === "auth0";
  check("auth0-workflow-access", env.AUTH0_WORKFLOW_ACCESS_ENABLED === true, `AUTH0_WORKFLOW_ACCESS_ENABLED=${String(env.AUTH0_WORKFLOW_ACCESS_ENABLED)}`);
  check("auth0-mode", auth0Ready, `AUTH_MODE=${env.AUTH_MODE}; expected dual or auth0`);
  check("auth0-configured", Boolean(env.AUTH0_ISSUER_BASE_URL && env.AUTH0_AUDIENCE), "AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE must be configured");
  check(
    "auth0-staff-reconciliation",
    env.AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_ENABLED === true,
    `AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_ENABLED=${String(env.AUTH0_STAFF_ACCOUNTS_MONGO_RECONCILIATION_ENABLED)}`,
  );
  check(
    "workflow-write-authority",
    env.WORKFLOW_DATA_MONGO_WRITE_MODE === "dual" || env.WORKFLOW_DATA_MONGO_WRITE_MODE === "mongo",
    `WORKFLOW_DATA_MONGO_WRITE_MODE=${env.WORKFLOW_DATA_MONGO_WRITE_MODE}`,
  );
  check("workflow-read-authority", env.WORKFLOW_DATA_MONGO_READ_MODE === "mongo", `WORKFLOW_DATA_MONGO_READ_MODE=${env.WORKFLOW_DATA_MONGO_READ_MODE}`);
  check("certificate-read-authority", env.CERTIFICATES_MONGO_READ_MODE === "mongo", `CERTIFICATES_MONGO_READ_MODE=${env.CERTIFICATES_MONGO_READ_MODE}`);
  check("public-intake-read-authority", env.PUBLIC_INTAKE_MONGO_READ_MODE === "mongo", `PUBLIC_INTAKE_MONGO_READ_MODE=${env.PUBLIC_INTAKE_MONGO_READ_MODE}`);
  check("public-intake-write-authority", env.PUBLIC_INTAKE_WRITE_MODE === "mongo", `PUBLIC_INTAKE_WRITE_MODE=${env.PUBLIC_INTAKE_WRITE_MODE}`);
  check("public-intake-otp-authority", env.PUBLIC_INTAKE_OTP_STORAGE_MODE === "mongo", `PUBLIC_INTAKE_OTP_STORAGE_MODE=${env.PUBLIC_INTAKE_OTP_STORAGE_MODE}`);
  check("staff-directory-read-authority", env.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo", `STAFF_DIRECTORY_MONGO_READ_MODE=${env.STAFF_DIRECTORY_MONGO_READ_MODE}`);
  check("staff-directory-write-authority", env.STAFF_DIRECTORY_MONGO_WRITE_MODE === "mongo", `STAFF_DIRECTORY_MONGO_WRITE_MODE=${env.STAFF_DIRECTORY_MONGO_WRITE_MODE}`);
  check("notification-preferences-write-authority", env.NOTIFICATION_PREFERENCES_WRITE_MODE === "mongo", `NOTIFICATION_PREFERENCES_WRITE_MODE=${env.NOTIFICATION_PREFERENCES_WRITE_MODE}`);
  check("notification-preferences-mongo", env.NOTIFICATION_PREFERENCES_DATA_SOURCE === "mongo", `NOTIFICATION_PREFERENCES_DATA_SOURCE=${env.NOTIFICATION_PREFERENCES_DATA_SOURCE}`);
  check("notifications-write-authority", env.NOTIFICATIONS_WRITE_MODE === "mongo", `NOTIFICATIONS_WRITE_MODE=${env.NOTIFICATIONS_WRITE_MODE}`);
  check("notifications-mongo", env.NOTIFICATIONS_DATA_SOURCE === "mongo", `NOTIFICATIONS_DATA_SOURCE=${env.NOTIFICATIONS_DATA_SOURCE}`);
  check("notification-audit-read-authority", env.NOTIFICATION_AUDIT_MONGO_READ_MODE === "mongo", `NOTIFICATION_AUDIT_MONGO_READ_MODE=${env.NOTIFICATION_AUDIT_MONGO_READ_MODE}`);
  check("audit-log-read-authority", env.AUDIT_LOGS_MONGO_READ_MODE === "mongo", `AUDIT_LOGS_MONGO_READ_MODE=${env.AUDIT_LOGS_MONGO_READ_MODE}`);
  check("security-audit-write-authority", env.SECURITY_AUDIT_MONGO_WRITE_MODE === "mongo", `SECURITY_AUDIT_MONGO_WRITE_MODE=${env.SECURITY_AUDIT_MONGO_WRITE_MODE}`);
  check("announcements-authority", env.ANNOUNCEMENTS_DATA_SOURCE === "mongo" && env.ANNOUNCEMENTS_WRITE_MODE === "mongo", `ANNOUNCEMENTS_DATA_SOURCE=${env.ANNOUNCEMENTS_DATA_SOURCE}, ANNOUNCEMENTS_WRITE_MODE=${env.ANNOUNCEMENTS_WRITE_MODE}`);
  check("s3-authority", env.STORAGE_PROVIDER === "s3" && env.STORAGE_S3_READ_FALLBACK_TO_SUPABASE !== true, `STORAGE_PROVIDER=${env.STORAGE_PROVIDER}, STORAGE_S3_READ_FALLBACK_TO_SUPABASE=${String(env.STORAGE_S3_READ_FALLBACK_TO_SUPABASE)}`);
  check("render-notification-worker", env.NOTIFICATION_RENDER_WORKER_ENABLED === true, `NOTIFICATION_RENDER_WORKER_ENABLED=${String(env.NOTIFICATION_RENDER_WORKER_ENABLED)}`);
  check("notification-authorities", [env.BIRTHDAY_DELIVERY_AUTHORITY, env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY, env.PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY, env.MATURITY_REMINDER_DELIVERY_AUTHORITY, env.PAYMENT_REMINDER_DELIVERY_AUTHORITY, env.MONTHLY_REPORT_DELIVERY_AUTHORITY].every((authority) => authority === "render"), "All scheduled notification authorities must be render");

  if (isMongoConfigured()) {
    const staffAccounts = await listStaffAccounts();
    const inactiveStaffAccounts = staffAccounts.filter((account) => !account.isActive);
    check(
      "auth0-staff-mappings",
      staffAccounts.length > 0 && inactiveStaffAccounts.length === 0,
      `mapped=${staffAccounts.length}, inactive=${inactiveStaffAccounts.length}`,
    );
    for (const table of workflowMirrorTables) await compareTable(table);
    await compareCollection("audit_logs");
    await compareCollection("security_audit_logs");
  }

  const failed = checks.filter((result) => !result.passed);
  console.log("[cutover-readiness]", { passed: failed.length === 0, checks });
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[cutover-readiness] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
