import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

const SAMPLE_SIZE = 25;

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const [{ count: supabaseCount, error: countError }, { data: recentRecords, error: recentError }] = await Promise.all([
    adminSupabase.from("notifications").select("*", { count: "exact", head: true }),
    adminSupabase.from("notifications").select("id").order("created_at", { ascending: false }).limit(SAMPLE_SIZE),
  ]);

  if (countError) throw new Error(`Failed to count Supabase notifications: ${countError.message}`);
  if (recentError) throw new Error(`Failed to load recent Supabase notifications: ${recentError.message}`);

  const collection = (await getMongoDb()).collection<{ supabaseNotificationId?: string }>("notifications");
  const [mongoCount, recentMongoRecords] = await Promise.all([
    collection.countDocuments(),
    collection
      .find({}, { projection: { supabaseNotificationId: 1 } })
      .sort({ createdAt: -1 })
      .limit(SAMPLE_SIZE)
      .toArray(),
  ]);
  const recentMongoIds = new Set(recentMongoRecords.map((record) => record.supabaseNotificationId).filter(Boolean));
  const missingRecentIds = (recentRecords ?? []).map((record) => record.id).filter((id) => !recentMongoIds.has(id));
  const countsMatch = (supabaseCount ?? 0) === mongoCount;

  console.log("[notifications.mongo.audit]", {
    supabaseCount: supabaseCount ?? 0,
    mongoCount,
    countsMatch,
    recentSampleSize: recentRecords?.length ?? 0,
    missingRecentIds,
  });

  if (!countsMatch || missingRecentIds.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[notifications.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
