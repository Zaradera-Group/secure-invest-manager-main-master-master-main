import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const { data, error } = await adminSupabase.from("notification_preferences").select("id, user_id");
  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);

  const expectedUserIds = new Set((data ?? []).map((record) => record.user_id));
  const mongoRecords = await (await getMongoDb()).collection<{ userId: string }>("notification_preferences")
    .find({}, { projection: { _id: 0, userId: 1 } })
    .toArray();
  const mongoUserIds = new Set(mongoRecords.map((record) => record.userId));
  const missingUserIds = [...expectedUserIds].filter((userId) => !mongoUserIds.has(userId));

  console.log("[notification-preferences.mongo.audit]", {
    supabaseCount: expectedUserIds.size,
    mongoCount: mongoUserIds.size,
    missingUserIds,
  });

  if (missingUserIds.length || expectedUserIds.size !== mongoUserIds.size) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[notification-preferences.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
