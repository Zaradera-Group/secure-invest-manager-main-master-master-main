import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

const sampleSize = 25;

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const [{ count, error: countError }, { data: recent, error: recentError }] = await Promise.all([
    adminSupabase.from("security_audit_logs").select("*", { count: "exact", head: true }),
    adminSupabase.from("security_audit_logs").select("id").order("created_at", { ascending: false }).limit(sampleSize),
  ]);
  if (countError) throw new Error(`Failed to count security audit events: ${countError.message}`);
  if (recentError) throw new Error(`Failed to load recent security audit events: ${recentError.message}`);

  const collection = (await getMongoDb()).collection<{ supabaseId?: string }>("security_audit_logs");
  const [mongoCount, recentMongo] = await Promise.all([
    collection.countDocuments(),
    collection.find({}, { projection: { supabaseId: 1 } }).sort({ createdAt: -1 }).limit(sampleSize).toArray(),
  ]);
  const mongoIds = new Set(recentMongo.map((record) => record.supabaseId).filter(Boolean));
  const missingRecentIds = (recent ?? []).map((record) => record.id).filter((id) => !mongoIds.has(id));

  console.log("[security-audit.mongo.audit]", {
    supabaseCount: count ?? 0,
    mongoCount,
    countsMatch: (count ?? 0) === mongoCount,
    missingRecentIds,
  });

  if ((count ?? 0) !== mongoCount || missingRecentIds.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[security-audit.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
