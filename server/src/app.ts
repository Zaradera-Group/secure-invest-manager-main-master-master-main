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
