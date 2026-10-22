import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const { data, error } = await adminSupabase.from("notification_preferences").select("*");
  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);

  const expectedRecords = new Map((data ?? []).map((record) => [record.user_id, record]));
  const mongoRecords = await (await getMongoDb()).collection<{
    userId: string;
    preferences?: Record<string, unknown>;
    rawSupabaseRecord?: Record<string, unknown>;
  }>("notification_preferences")
    .find({}, { projection: { _id: 0, userId: 1, preferences: 1, rawSupabaseRecord: 1 } })
    .toArray();
  const mongoUserIds = new Set(mongoRecords.map((record) => record.userId));
  const missingUserIds = [...expectedRecords.keys()].filter((userId) => !mongoUserIds.has(userId));
  const preferenceFields = [
    "email_enabled",
    "maturity_reminders",
    "payment_reminders",
    "monthly_reports",
    "birthday_notifications",
    "reminder_days_before",
  ];
  const mismatchedUserIds = mongoRecords.flatMap((record) => {
    const expected = expectedRecords.get(record.userId);
    const actual = record.preferences ?? record.rawSupabaseRecord;
    if (!expected || !actual) return expected ? [record.userId] : [];

    const isMatch = preferenceFields.every((field) =>
      JSON.stringify(expected[field]) === JSON.stringify(actual[field]),
    );
    return isMatch ? [] : [record.userId];
  });

  console.log("[notification-preferences.mongo.audit]", {
    supabaseCount: expectedRecords.size,
    mongoCount: mongoUserIds.size,
    missingUserIds,
    mismatchedUserIds,
  });

  if (missingUserIds.length || mismatchedUserIds.length || expectedRecords.size !== mongoUserIds.size) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[notification-preferences.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
