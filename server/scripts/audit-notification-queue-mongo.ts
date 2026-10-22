import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

const sampleSize = 25;

type SupabaseNotificationJob = {
  id: string;
  created_at: string;
};

type MirroredNotificationQueueJob = {
  supabaseJobId?: string;
  rawSupabaseRecord?: { created_at?: string };
};

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const [{ count: supabaseCount, error: countError }, { data: recentSupabase, error: recentError }] = await Promise.all([
    adminSupabase.from("notification_jobs").select("id", { count: "exact", head: true }),
    adminSupabase.from("notification_jobs").select("id, created_at").order("created_at", { ascending: false }).limit(sampleSize),
  ]);

  if (countError) throw new Error(`Failed to count Supabase notification jobs: ${countError.message}`);
  if (recentError) throw new Error(`Failed to load recent Supabase notification jobs: ${recentError.message}`);

  const collection = (await getMongoDb()).collection<MirroredNotificationQueueJob>("notification_queue_jobs");
  const [mongoCount, recentMongo] = await Promise.all([
    collection.countDocuments(),
    collection.find({}, { projection: { supabaseJobId: 1 } })
      .sort({ "rawSupabaseRecord.created_at": -1 })
      .limit(sampleSize)
      .toArray(),
  ]);

  const mongoIds = new Set(recentMongo.map((record) => record.supabaseJobId).filter(Boolean));
  const missingRecentIds = ((recentSupabase ?? []) as SupabaseNotificationJob[])
    .map((record) => record.id)
    .filter((id) => !mongoIds.has(id));
  const countsMatch = (supabaseCount ?? 0) === mongoCount;
  const passed = countsMatch && missingRecentIds.length === 0;

  console.log("[notification-queue.mongo.audit]", {
    supabaseCount: supabaseCount ?? 0,
    mongoCount,
    countsMatch,
    recentSampleSize: recentSupabase?.length ?? 0,
    missingRecentIds,
    passed,
  });

  if (!passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[notification-queue.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
