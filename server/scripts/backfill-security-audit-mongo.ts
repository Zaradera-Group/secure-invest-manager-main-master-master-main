import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { mirrorSecurityAuditRecordsToMongo, type SecurityAuditRecord } from "../src/repositories/security-audit.mongo.js";
import { adminSupabase } from "../src/lib/supabase.js";

const pageSize = 250;

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  let from = 0;
  let mirrored = 0;
  while (true) {
    const { data, error } = await adminSupabase
      .from("security_audit_logs")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load security audit events: ${error.message}`);
    if (!data?.length) break;

    mirrored += await mirrorSecurityAuditRecordsToMongo(data as SecurityAuditRecord[]);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`[security-audit.mongo.backfill] Complete. Mirrored ${mirrored} security audit record(s).`);
}

main()
  .catch((error) => {
    console.error("[security-audit.mongo.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
