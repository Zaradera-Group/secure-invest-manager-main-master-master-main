import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

const deliveryStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;
export type NotificationDeliveryStatus = (typeof deliveryStatuses)[number];
export type NotificationDeliveryChannel = "email" | "sms";
export type NotificationDeliveryMode = "shadow" | "live";

export type NotificationDeliveryOutboxInput = {
  notificationType: string;
  channel: NotificationDeliveryChannel;
  deliveryMode: NotificationDeliveryMode;
  recipient: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  scheduledAt?: string;
  maxAttempts?: number;
};

export type NotificationDeliveryOutboxRecord = NotificationDeliveryOutboxInput & {
  id: string;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: string;
  lockedAt: string | null;
  processedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const collectionName = "notification_delivery_outbox";
let indexesReady: Promise<void> | null = null;

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= (async () => {
    const collection = (await getMongoDb()).collection<NotificationDeliveryOutboxRecord>(collectionName);
    await Promise.all([
      collection.createIndex({ dedupeKey: 1 }, { unique: true }),
      collection.createIndex({ status: 1, scheduledAt: 1 }),
      collection.createIndex({ deliveryMode: 1, status: 1, scheduledAt: 1 }),
      collection.createIndex({ status: 1, lockedAt: 1 }),
    ]);
  })();
  await indexesReady;
  return (await getMongoDb()).collection<NotificationDeliveryOutboxRecord>(collectionName);
}

export async function enqueueNotificationDelivery(input: NotificationDeliveryOutboxInput) {
  if (!input.dedupeKey.trim()) throw new Error("Notification delivery dedupe key is required");
  if (!input.recipient.trim()) throw new Error("Notification delivery recipient is required");

  const collection = await getCollection();
  const now = new Date().toISOString();
  const record: NotificationDeliveryOutboxRecord = {
    ...input,
    id: randomUUID(),
    recipient: input.recipient.trim(),
    dedupeKey: input.dedupeKey.trim(),
    status: "pending",
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 3,
    scheduledAt: input.scheduledAt ?? now,
    lockedAt: null,
    processedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.updateOne(
    { dedupeKey: record.dedupeKey },
    { $setOnInsert: record },
    { upsert: true },
  );

  return { id: record.id, inserted: result.upsertedCount === 1 };
}

export async function claimNextNotificationDelivery(notificationTypes: readonly string[], now = new Date()) {
  const collection = await getCollection();
  const timestamp = now.toISOString();
  const filter: Filter<NotificationDeliveryOutboxRecord> = {
    deliveryMode: "live",
    status: "pending",
    scheduledAt: { $lte: timestamp },
  };
  if (notificationTypes.length > 0) filter.notificationType = { $in: [...notificationTypes] };
  const result = await collection.findOneAndUpdate(
    filter,
    { $set: { status: "processing", lockedAt: timestamp, updatedAt: timestamp } },
    { sort: { scheduledAt: 1, createdAt: 1 }, returnDocument: "after" },
  );
  return result;
}

export async function completeNotificationDelivery(id: string, processedAt = new Date().toISOString()) {
  const collection = await getCollection();
  const result = await collection.updateOne(
    { id, status: "processing" },
    { $set: { status: "completed", processedAt, lockedAt: null, lastError: null, updatedAt: processedAt } },
  );
  return result.modifiedCount === 1;
}

export async function failNotificationDelivery(id: string, message: string, failedAt = new Date()) {
  const collection = await getCollection();
  const record = await collection.findOne({ id, status: "processing" });
  if (!record) return false;

  const attemptCount = record.attemptCount + 1;
  const shouldRetry = attemptCount < record.maxAttempts;
  const failedAtIso = failedAt.toISOString();
  const scheduledAt = shouldRetry
    ? new Date(failedAt.getTime() + attemptCount * 5 * 60 * 1000).toISOString()
    : failedAtIso;
  const result = await collection.updateOne(
    { id, status: "processing", attemptCount: record.attemptCount },
    {
      $set: {
        status: shouldRetry ? "pending" : "failed",
        attemptCount,
        scheduledAt,
        lockedAt: null,
        processedAt: shouldRetry ? null : failedAtIso,
        lastError: message.slice(0, 2000),
        updatedAt: failedAtIso,
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function requeueStaleNotificationDeliveries(now = new Date(), staleAfterMinutes = 15) {
  const collection = await getCollection();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - staleAfterMinutes * 60 * 1000).toISOString();
  const result = await collection.updateMany(
    { status: "processing", lockedAt: { $ne: null, $lte: staleBefore } },
    { $set: { status: "pending", lockedAt: null, scheduledAt: nowIso, updatedAt: nowIso } },
  );
  return result.modifiedCount;
}

export async function getNotificationDeliveryOutboxCounts() {
  const collection = await getCollection();
  const entries = await Promise.all(deliveryStatuses.map(async (status) => [
    status,
    await collection.countDocuments({ status }),
  ] as const));
  return Object.fromEntries(entries) as Record<NotificationDeliveryStatus, number>;
}
