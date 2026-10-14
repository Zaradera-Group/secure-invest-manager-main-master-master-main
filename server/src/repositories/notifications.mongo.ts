import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

type NotificationMirrorInput = {
  notificationId: string;
  notification: Record<string, unknown>;
  createdAt?: string;
};

let indexesReady: Promise<void> | null = null;

async function ensureNotificationIndexes() {
  if (!isMongoConfigured()) {
    return;
  }

  const db = await getMongoDb();
  const collection = db.collection("notifications");

  await Promise.all([
    collection.createIndex({ supabaseNotificationId: 1 }, { unique: true }),
    collection.createIndex({ recipientUserId: 1, createdAt: -1 }),
    collection.createIndex({ recipientEmail: 1, createdAt: -1 }),
    collection.createIndex({ certificateId: 1, createdAt: -1 }),
    collection.createIndex({ isRead: 1, createdAt: -1 }),
  ]);
}

export async function mirrorNotificationToMongo(input: NotificationMirrorInput) {
  if (!env.NOTIFICATIONS_MONGO_MIRROR_ENABLED || !isMongoConfigured()) {
    return;
  }

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;

  const db = await getMongoDb();

  await db.collection("notifications").updateOne(
    { supabaseNotificationId: input.notificationId },
    buildNotificationUpdate(input),
    { upsert: true },
  );
}

export async function mirrorNotificationsToMongo(inputs: NotificationMirrorInput[]) {
  if (inputs.length === 0 || !env.NOTIFICATIONS_MONGO_MIRROR_ENABLED || !isMongoConfigured()) {
    return;
  }

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;

  const db = await getMongoDb();
  await db.collection("notifications").bulkWrite(
    inputs.map((input) => ({
      updateOne: {
        filter: { supabaseNotificationId: input.notificationId },
        update: buildNotificationUpdate(input),
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

function buildNotificationUpdate(input: NotificationMirrorInput) {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    $set: {
      supabaseNotificationId: input.notificationId,
      certificateId: input.notification.certificate_id ?? null,
      recipientUserId: input.notification.recipient_user_id ?? null,
      recipientEmail: input.notification.recipient_email ?? null,
      userRole: input.notification.user_role ?? null,
      title: input.notification.title ?? null,
      detail: input.notification.detail ?? null,
      message: input.notification.message ?? null,
      actionPath: input.notification.action_path ?? null,
      isRead: input.notification.is_read ?? false,
      readAt: input.notification.read_at ?? null,
      createdAt,
      source: "supabase_notifications",
      rawSupabaseRecord: input.notification,
      mirroredAt: new Date().toISOString(),
    },
    $setOnInsert: {
      insertedAt: new Date().toISOString(),
    },
  };
}

export function mirrorNotificationToMongoSafely(input: NotificationMirrorInput) {
  void mirrorNotificationToMongo(input).catch((error) => {
    console.warn("[notifications.mongo] Failed to mirror notification", {
      notificationId: input.notificationId,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}
