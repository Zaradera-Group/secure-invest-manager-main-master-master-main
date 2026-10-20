import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

const SAMPLE_SIZE = 25;

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const [{ count: supabaseCount, error }, { data: recentSupabaseRecords, error: recentError }] = await Promise.all([
    adminSupabase.from("public_intake_requests").select("*", { count: "exact", head: true }),
    adminSupabase
      .from("public_intake_requests")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(SAMPLE_SIZE),
  ]);

  if (error) throw new Error(`Failed to count Supabase public intake records: ${error.message}`);
  if (recentError) throw new Error(`Failed to load recent Supabase public intake records: ${recentError.message}`);

  const collection = (await getMongoDb()).collection<{ supabaseRequestId?: string }>("public_intake_requests");
  const [mongoCount, recentMongoRecords] = await Promise.all([
    collection.countDocuments(),
    collection
      .find({}, { projection: { supabaseRequestId: 1 } })
      .sort({ submittedAt: -1 })
      .limit(SAMPLE_SIZE)
      .toArray(),
  ]);

  const recentMongoIds = new Set(recentMongoRecords.map((record) => record.supabaseRequestId).filter(Boolean));
  const missingRecentIds = (recentSupabaseRecords ?? [])
    .map((record) => record.id)
    .filter((id) => !recentMongoIds.has(id));
  const countsMatch = (supabaseCount ?? 0) === mongoCount;

  console.log("[public-intake.mongo.audit]", {
    supabaseCount: supabaseCount ?? 0,
    mongoCount,
    countsMatch,
    recentSampleSize: recentSupabaseRecords?.length ?? 0,
    missingRecentIds,
  });

  if (!countsMatch || missingRecentIds.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[public-intake.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
