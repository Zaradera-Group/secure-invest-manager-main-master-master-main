import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";
import { notificationAuditSources, type NotificationAuditTable } from "../src/repositories/notification-audit.mongo.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const collection = (await getMongoDb()).collection<{
    sourceTable: NotificationAuditTable;
    supabaseId?: string;
    sortValue?: string | null;
  }>("notification_audit_records");
  const results = [] as Array<{ table: NotificationAuditTable; supabaseCount: number; mongoCount: number; missingRecentIds: string[] }>;

  for (const [table, orderColumn] of Object.entries(notificationAuditSources) as Array<[NotificationAuditTable, string]>) {
    const [{ count, error: countError }, { data: recent, error: recentError }, mongoCount] = await Promise.all([
      adminSupabase.from(table).select("*", { count: "exact", head: true }),
      adminSupabase.from(table).select("id").order(orderColumn, { ascending: false }).limit(25),
      collection.countDocuments({ sourceTable: table }),
    ]);
    if (countError) throw new Error(`Failed to count ${table}: ${countError.message}`);
    if (recentError) throw new Error(`Failed to load ${table}: ${recentError.message}`);

    const mongoIds = new Set((await collection
      .find({ sourceTable: table }, { projection: { supabaseId: 1 } })
      .sort({ sortValue: -1 })
      .limit(25)
      .toArray())
      .map((record) => record.supabaseId)
      .filter((id): id is string => Boolean(id)));
    results.push({
      table,
      supabaseCount: count ?? 0,
      mongoCount,
      missingRecentIds: (recent ?? []).map((record) => record.id).filter((id) => !mongoIds.has(id)),
    });
  }

  console.log("[notification-audit.mongo.audit]", results);
  if (results.some((result) => result.supabaseCount !== result.mongoCount || result.missingRecentIds.length > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[notification-audit.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
