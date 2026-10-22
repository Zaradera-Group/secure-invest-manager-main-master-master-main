import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth.js";
import { certificatesRouter } from "./routes/certificates.js";
import { investorsRouter } from "./routes/investors.js";
import { env } from "./config/env.js";
import {
  createSignedObjectUrl,
  deleteObject,
  downloadObject,
  uploadObject,
} from "./lib/storage.js";
import { sendPlainEmail } from "./lib/email.js";
import { checkMongoHealth, isMongoConfigured } from "./lib/mongodb.js";
import { publicIntakeRouter } from "./routes/public-intake.js";
import { notificationsRouter } from "./routes/notifications.js";
import { adminRouter } from "./routes/admin.js";
import { announcementsRouter } from "./routes/announcements.js";
import { settingsRouter } from "./routes/settings.js";
import { intakeRouter } from "./routes/intake.js";
import { identityRouter } from "./routes/identity.js";

export const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/health/storage", async (request, response, next) => {
  try {
    if (!env.STORAGE_HEALTH_CHECK_ENABLED) {
      response.status(404).json({ message: "Storage health check is disabled" });
      return;
    }

    if (env.STORAGE_HEALTH_CHECK_TOKEN) {
      const suppliedToken = request.header("x-health-check-token") ?? request.query.token;
      if (suppliedToken !== env.STORAGE_HEALTH_CHECK_TOKEN) {
        response.status(401).json({ message: "Unauthorized" });
        return;
      }
    }

    const path = `health-check/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const expectedText = `zaradera-storage-health-check:${new Date().toISOString()}`;
    const storedPath = await uploadObject({
      path,
      bytes: Buffer.from(expectedText, "utf8"),
      contentType: "text/plain; charset=utf-8",
    });
    const signedUrl = await createSignedObjectUrl(storedPath, 60);
    const downloadedBytes = await downloadObject(storedPath);
    await deleteObject(storedPath);

    response.json({
      status: "ok",
      provider: env.STORAGE_PROVIDER,
      path: storedPath,
      signedUrlCreated: Boolean(signedUrl),
      roundTripMatched: downloadedBytes.toString("utf8") === expectedText,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/health/mongodb", async (_request, response, next) => {
  try {
    if (!isMongoConfigured()) {
      response.status(404).json({ message: "MongoDB is not configured" });
      return;
    }

    response.json(await checkMongoHealth());
  } catch (error) {
    next(error);
  }
});

app.get("/health/migration", async (request, response) => {
  if (!env.MIGRATION_HEALTH_CHECK_ENABLED) {
    response.status(404).json({ message: "Migration health check is disabled" });
    return;
  }

  if (env.MIGRATION_HEALTH_CHECK_TOKEN) {
    const suppliedToken = request.header("x-health-check-token") ?? request.query.token;
    if (suppliedToken !== env.MIGRATION_HEALTH_CHECK_TOKEN) {
      response.status(401).json({ message: "Unauthorized" });
      return;
    }
  }

  let mongo: { configured: boolean; healthy: boolean } = {
    configured: isMongoConfigured(),
    healthy: false,
  };

  if (mongo.configured) {
    try {
      await checkMongoHealth();
      mongo = { ...mongo, healthy: true };
    } catch (error) {
      console.error("[migration-health] MongoDB check failed", error);
    }
  }

  const auth0Configured = Boolean(env.AUTH0_ISSUER_BASE_URL && env.AUTH0_AUDIENCE);
  const ready = mongo.healthy && (env.AUTH_MODE === "supabase" || auth0Configured);
  const cutoverBlockers: string[] = [];
  const auth0ModeReady = env.AUTH_MODE === "dual" || env.AUTH_MODE === "auth0";
  const allNotificationAuthoritiesAreRender = [
    env.BIRTHDAY_DELIVERY_AUTHORITY,
    env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY,
    env.PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY,
    env.MATURITY_REMINDER_DELIVERY_AUTHORITY,
    env.PAYMENT_REMINDER_DELIVERY_AUTHORITY,
    env.MONTHLY_REPORT_DELIVERY_AUTHORITY,
  ].every((authority) => authority === "render");

  if (!mongo.healthy) cutoverBlockers.push("MongoDB is not healthy");
  if (!env.AUTH0_WORKFLOW_ACCESS_ENABLED) cutoverBlockers.push("Auth0 workflow access is disabled");
  if (!auth0ModeReady) cutoverBlockers.push(`AUTH_MODE=${env.AUTH_MODE}; expected dual or auth0`);
  if (!auth0Configured) cutoverBlockers.push("Auth0 issuer and audience are not configured");
  if (!["dual", "mongo"].includes(env.WORKFLOW_DATA_MONGO_WRITE_MODE)) cutoverBlockers.push("Workflow writes are not Mongo-authoritative");
  if (env.PUBLIC_INTAKE_WRITE_MODE !== "mongo") cutoverBlockers.push("Public intake writes are not Mongo-authoritative");
  if (env.STAFF_DIRECTORY_MONGO_READ_MODE !== "mongo" || env.STAFF_DIRECTORY_MONGO_WRITE_MODE !== "mongo") cutoverBlockers.push("Staff directory is not Mongo-authoritative");
  if (env.NOTIFICATION_PREFERENCES_DATA_SOURCE !== "mongo" || env.NOTIFICATION_PREFERENCES_WRITE_MODE !== "mongo") cutoverBlockers.push("Notification preferences are not Mongo-authoritative");
  if (env.NOTIFICATIONS_DATA_SOURCE !== "mongo" || env.NOTIFICATIONS_WRITE_MODE !== "mongo") cutoverBlockers.push("Notifications are not Mongo-authoritative");
  if (env.ANNOUNCEMENTS_DATA_SOURCE !== "mongo" || env.ANNOUNCEMENTS_WRITE_MODE !== "mongo") cutoverBlockers.push("Announcements are not Mongo-authoritative");
  if (env.STORAGE_PROVIDER !== "s3" || env.STORAGE_S3_READ_FALLBACK_TO_SUPABASE) cutoverBlockers.push("S3 is not the exclusive storage read authority");
  if (!env.NOTIFICATION_RENDER_WORKER_ENABLED || !allNotificationAuthoritiesAreRender) cutoverBlockers.push("Render is not the sole notification delivery authority");

  response.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "degraded",
    mongo,
    authentication: {
      mode: env.AUTH_MODE,
      auth0Configured,
      workflowAccessEnabled: env.AUTH0_WORKFLOW_ACCESS_ENABLED,
    },
    persistence: {
      publicIntakeOtp: env.PUBLIC_INTAKE_OTP_STORAGE_MODE,
      publicIntakeRead: env.PUBLIC_INTAKE_MONGO_READ_MODE,
      workflowRead: env.WORKFLOW_DATA_MONGO_READ_MODE,
      certificatesRead: env.CERTIFICATES_MONGO_READ_MODE,
      announcementsRead: env.ANNOUNCEMENTS_MONGO_READ_MODE,
      announcementsSource: env.ANNOUNCEMENTS_DATA_SOURCE,
      notificationsRead: env.NOTIFICATIONS_MONGO_READ_MODE,
      notificationPreferencesRead: env.NOTIFICATION_PREFERENCES_MONGO_READ_MODE,
    },
    notificationWorker: {
      shadowEnabled: env.NOTIFICATION_WORKER_SHADOW_ENABLED,
      shadowCron: env.NOTIFICATION_WORKER_SHADOW_CRON || "*/5 * * * *",
      queueMongoReconciliationEnabled: env.NOTIFICATION_QUEUE_MONGO_RECONCILIATION_ENABLED,
      queueMongoReconciliationCron: env.NOTIFICATION_QUEUE_MONGO_RECONCILIATION_CRON || "*/5 * * * *",
      renderWorkerEnabled: env.NOTIFICATION_RENDER_WORKER_ENABLED,
      renderWorkerCron: env.NOTIFICATION_RENDER_WORKER_CRON || "*/5 * * * *",
      birthdayDeliveryAuthority: env.BIRTHDAY_DELIVERY_AUTHORITY,
      certificateNotificationDeliveryAuthority: env.CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY,
      deliveryAuthority: "supabase-edge",
    },
    storage: { provider: env.STORAGE_PROVIDER },
    cutover: {
      ready: cutoverBlockers.length === 0,
      blockers: cutoverBlockers,
    },
  });
});

app.get("/health/email", async (request, response, next) => {
  try {
    if (!env.EMAIL_HEALTH_CHECK_ENABLED) {
      response.status(404).json({ message: "Email health check is disabled" });
      return;
    }

    if (env.EMAIL_HEALTH_CHECK_TOKEN) {
      const suppliedToken = request.header("x-health-check-token") ?? request.query.token;
      if (suppliedToken !== env.EMAIL_HEALTH_CHECK_TOKEN) {
        response.status(401).json({ message: "Unauthorized" });
        return;
      }
    }

    const recipient = typeof request.query.to === "string"
      ? request.query.to.trim()
      : env.EMAIL_REDIRECT_TO;

    if (!recipient) {
      response.status(400).json({ message: "Provide a test recipient with ?to=email@example.com or set EMAIL_REDIRECT_TO" });
      return;
    }

    await sendPlainEmail(
      recipient,
      "Zaradera Vest email health check",
      `<p>This confirms the Render backend can send email through the configured SMTP provider.</p><p>Sent at ${new Date().toISOString()}.</p>`,
    );

    response.json({
      status: "ok",
      recipient,
      redirectedTo: env.EMAIL_REDIRECT_TO ?? null,
    });
  } catch (error) {
    next(error);
  }
});

app.use("/auth", authRouter);
app.use("/public", publicIntakeRouter);
app.use("/intake", intakeRouter);
app.use("/identity", identityRouter);
app.use("/announcements", announcementsRouter);
app.use("/certificates", certificatesRouter);
app.use("/investors", investorsRouter);
app.use("/notifications", notificationsRouter);
app.use("/admin", adminRouter);
app.use("/settings", settingsRouter);

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({
    message: error.message || "Unexpected server error",
  });
});
