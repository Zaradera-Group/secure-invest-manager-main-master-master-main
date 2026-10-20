import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

type NotificationPreferenceRecord = Record<string, unknown> & {
  id: string;
  user_id: string;
};

type MirroredNotificationPreference = {
  supabaseId: string;
  userId: string;
  rawSupabaseRecord?: NotificationPreferenceRecord;
};

let indexesReady: Promise<void> | null = null;

async function ensureIndexes() {
  if (!isMongoConfigured()) return;

  const collection = (await getMongoDb()).collection<MirroredNotificationPreference>("notification_preferences");
  await Promise.all([
    collection.createIndex({ supabaseId: 1 }, { unique: true }),
    collection.createIndex({ userId: 1 }, { unique: true }),
  ]);
}

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureIndexes();
  await indexesReady;
  return (await getMongoDb()).collection<MirroredNotificationPreference>("notification_preferences");
}

export async function mirrorNotificationPreferencesToMongo(records: NotificationPreferenceRecord[]) {
  if (!records.length || !env.NOTIFICATIONS_MONGO_MIRROR_ENABLED) return 0;

  const collection = await getCollection();
  const mirroredAt = new Date().toISOString();
  await collection.bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { userId: record.user_id },
        update: {
          $set: {
            supabaseId: record.id,
            userId: record.user_id,
            rawSupabaseRecord: record,
            mirroredAt,
          },
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return records.length;
}

export function mirrorNotificationPreferencesToMongoSafely(record: NotificationPreferenceRecord) {
  void mirrorNotificationPreferencesToMongo([record]).catch((error) => {
    console.warn("[notification-preferences.mongo] Failed to mirror notification preferences", {
      userId: record.user_id,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function getNotificationPreferencesFromMongo(userId: string) {
  const record = await (await getCollection()).findOne(
    { userId },
    { projection: { rawSupabaseRecord: 1 } },
  );
  return record?.rawSupabaseRecord ?? null;
}
