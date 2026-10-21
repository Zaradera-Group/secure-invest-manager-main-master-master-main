import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

type NotificationMirrorInput = {
  notificationId: string;
  notification: Record<string, unknown>;
  createdAt?: string;
};

type MirroredNotificationDocument = {
  rawSupabaseRecord?: Record<string, unknown>;
};

export type NotificationReadFilter = {
  recipientUserId: string;
  recipientEmail: string;
  userRole: "manager" | "general_manager" | "ceo" | "investor";
};

const buildVisibilityFilter = (filter: NotificationReadFilter) => (
  filter.userRole === "investor"
    ? { $or: [{ recipientUserId: filter.recipientUserId }, { recipientEmail: filter.recipientEmail }] }
    : { $or: [{ recipientUserId: filter.recipientUserId }, { userRole: filter.userRole }] }
);

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

export function markNotificationReadInMongoSafely(notificationId: string, readAt: string) {
  if (!env.NOTIFICATIONS_MONGO_MIRROR_ENABLED || !isMongoConfigured()) return;

  void getMongoDb()
    .then((db) => db.collection("notifications").updateOne(
      { supabaseNotificationId: notificationId },
      {
        $set: {
          isRead: true,
          readAt,
          "rawSupabaseRecord.is_read": true,
          "rawSupabaseRecord.read_at": readAt,
          mirroredAt: new Date().toISOString(),
        },
      },
    ))
    .catch((error) => {
      console.warn("[notifications.mongo] Failed to mark mirrored notification as read", {
        notificationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

export async function getDashboardNotificationFromMongo(notificationId: string) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;
  const record = await (await getMongoDb()).collection<MirroredNotificationDocument>("notifications")
    .findOne({ supabaseNotificationId: notificationId }, { projection: { rawSupabaseRecord: 1 } });
  return record?.rawSupabaseRecord ?? null;
}

export async function markNotificationReadInMongo(notificationId: string, readAt: string) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;
  const result = await (await getMongoDb()).collection("notifications").updateOne(
    { supabaseNotificationId: notificationId },
    {
      $set: {
        isRead: true,
        readAt,
        "rawSupabaseRecord.is_read": true,
        "rawSupabaseRecord.read_at": readAt,
        mirroredAt: new Date().toISOString(),
      },
    },
  );
  if (result.matchedCount !== 1) throw new Error("Notification not found");
}

export function markNotificationsReadInMongoSafely(filter: NotificationReadFilter, readAt: string) {
  if (!env.NOTIFICATIONS_MONGO_MIRROR_ENABLED || !isMongoConfigured()) return;

  const visibilityFilter = buildVisibilityFilter(filter);

  void getMongoDb()
    .then((db) => db.collection("notifications").updateMany(
      { ...visibilityFilter, isRead: false },
      {
        $set: {
          isRead: true,
          readAt,
          "rawSupabaseRecord.is_read": true,
          "rawSupabaseRecord.read_at": readAt,
          mirroredAt: new Date().toISOString(),
        },
      },
    ))
    .catch((error) => {
      console.warn("[notifications.mongo] Failed to mark mirrored notifications as read", {
        recipientUserId: filter.recipientUserId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

export async function markNotificationsReadInMongo(filter: NotificationReadFilter, readAt: string) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;
  const visibilityFilter = buildVisibilityFilter(filter);
  await (await getMongoDb()).collection("notifications").updateMany(
    { ...visibilityFilter, isRead: false },
    {
      $set: {
        isRead: true,
        readAt,
        "rawSupabaseRecord.is_read": true,
        "rawSupabaseRecord.read_at": readAt,
        mirroredAt: new Date().toISOString(),
      },
    },
  );
}

export async function listDashboardNotificationsFromMongo(filter: NotificationReadFilter, limit: number) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;

  const db = await getMongoDb();
  const records = await db.collection<MirroredNotificationDocument>("notifications")
    .find(buildVisibilityFilter(filter), { projection: { rawSupabaseRecord: 1 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return records.flatMap((record) => record.rawSupabaseRecord ? [record.rawSupabaseRecord] : []);
}

export async function countUnreadDashboardNotificationsFromMongo(filter: NotificationReadFilter) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureNotificationIndexes();
  await indexesReady;

  const db = await getMongoDb();
  return db.collection("notifications").countDocuments({ ...buildVisibilityFilter(filter), isRead: false });
}
