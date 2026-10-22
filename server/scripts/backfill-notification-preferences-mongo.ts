import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";
import { mirrorNotificationPreferencesToMongo } from "../src/repositories/notification-preferences.mongo.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  const { data, error } = await adminSupabase.from("notification_preferences").select("*");
  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);

  const mirrored = await mirrorNotificationPreferencesToMongo((data ?? []) as Array<Record<string, unknown> & { id: string; user_id: string }>);
  console.log(`[notification-preferences.mongo.backfill] Complete. Mirrored ${mirrored} notification preference record(s).`);
}

main()
  .catch((error) => {
    console.error("[notification-preferences.mongo.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
