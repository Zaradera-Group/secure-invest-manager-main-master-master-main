import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";
import { workflowMirrorTables, type WorkflowMirrorTable } from "../src/repositories/workflow-data.mongo.js";

const SAMPLE_SIZE = 25;
const requestedTable = process.env.AUDIT_WORKFLOW_TABLE?.trim();

function getTablesToAudit(): WorkflowMirrorTable[] {
  if (!requestedTable) return [...workflowMirrorTables];
  if (!workflowMirrorTables.includes(requestedTable as WorkflowMirrorTable)) {
    throw new Error(`Unknown workflow table: ${requestedTable}`);
  }
  return [requestedTable as WorkflowMirrorTable];
}

async function auditTable(table: WorkflowMirrorTable) {
  const [{ count: supabaseCount, error: countError }, { data: recentRecords, error: recentError }] = await Promise.all([
    adminSupabase.from(table).select("*", { count: "exact", head: true }),
    adminSupabase.from(table).select("id").order("created_at", { ascending: false }).limit(SAMPLE_SIZE),
  ]);

  if (countError) throw new Error(`Failed to count ${table}: ${countError.message}`);
  if (recentError) throw new Error(`Failed to load recent ${table} records: ${recentError.message}`);

  const collection = (await getMongoDb()).collection<{ supabaseId?: string }>(table);
  const [mongoCount, recentMongoRecords] = await Promise.all([
    collection.countDocuments(),
    collection.find({}, { projection: { supabaseId: 1 } }).sort({ createdAt: -1 }).limit(SAMPLE_SIZE).toArray(),
  ]);
  const recentMongoIds = new Set(recentMongoRecords.map((record) => record.supabaseId).filter(Boolean));
  const missingRecentIds = (recentRecords ?? []).map((record) => record.id).filter((id) => !recentMongoIds.has(id));
  const countsMatch = (supabaseCount ?? 0) === mongoCount;

  console.log("[workflow-data.mongo.audit]", {
    table,
    supabaseCount: supabaseCount ?? 0,
    mongoCount,
    countsMatch,
    recentSampleSize: recentRecords?.length ?? 0,
    missingRecentIds,
  });

  return countsMatch && missingRecentIds.length === 0;
}

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const results = await Promise.all(getTablesToAudit().map(auditTable));
  if (results.some((matched) => !matched)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[workflow-data.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
