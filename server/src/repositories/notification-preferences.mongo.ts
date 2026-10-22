import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

type NotificationPreferenceRecord = Record<string, unknown> & {
  id: string;
  user_id: string;
};

export type MongoNotificationPreferences = {
  id: string;
  user_id: string;
  email_enabled: boolean;
  maturity_reminders: boolean;
  payment_reminders: boolean;
  monthly_reports: boolean;
  birthday_notifications: boolean;
  reminder_days_before: number[];
  created_at: string;
  updated_at: string;
};

type MirroredNotificationPreference = {
  supabaseId: string;
  userId: string;
  preferences?: MongoNotificationPreferences;
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
            preferences: record as MongoNotificationPreferences,
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
    { projection: { preferences: 1, rawSupabaseRecord: 1 } },
  );
  return record?.preferences ?? record?.rawSupabaseRecord ?? null;
}

export async function upsertNotificationPreferencesInMongo(
  userId: string,
  updates: Partial<Omit<MongoNotificationPreferences, "id" | "user_id" | "created_at" | "updated_at">>,
  existing: MongoNotificationPreferences | null,
) {
  const collection = await getCollection();
  const now = new Date().toISOString();
  const preferences: MongoNotificationPreferences = {
    id: existing?.id ?? crypto.randomUUID(),
    user_id: userId,
    email_enabled: updates.email_enabled ?? existing?.email_enabled ?? true,
    maturity_reminders: updates.maturity_reminders ?? existing?.maturity_reminders ?? true,
    payment_reminders: updates.payment_reminders ?? existing?.payment_reminders ?? true,
    monthly_reports: updates.monthly_reports ?? existing?.monthly_reports ?? true,
    birthday_notifications: updates.birthday_notifications ?? existing?.birthday_notifications ?? true,
    reminder_days_before: updates.reminder_days_before ?? existing?.reminder_days_before ?? [7, 3, 1],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await collection.updateOne(
    { userId },
    {
      $set: {
        userId,
        supabaseId: preferences.id,
        preferences,
        mirroredAt: now,
        source: "mongo",
      },
      $setOnInsert: { insertedAt: now },
    },
    { upsert: true },
  );

  return preferences;
}
