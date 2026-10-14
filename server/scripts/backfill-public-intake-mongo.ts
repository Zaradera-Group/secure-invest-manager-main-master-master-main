import { adminSupabase } from "../src/lib/supabase.js";
import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { mirrorPublicIntakeRequestToMongo } from "../src/repositories/public-intake.mongo.js";

const pageSize = Number.parseInt(process.env.BACKFILL_PAGE_SIZE ?? "100", 10);

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  let from = 0;
  let totalMirrored = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await adminSupabase
      .from("public_intake_requests")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read public intake requests: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const record of data) {
      const requestRecord = record as Record<string, unknown>;
      const requestId = String(requestRecord.id ?? "");

      if (!requestId) {
        console.warn("[public-intake.backfill] Skipped row without id");
        continue;
      }

      await mirrorPublicIntakeRequestToMongo({
        requestId,
        intakeRecord: requestRecord,
        requestRecord,
        submittedAt: String(requestRecord.submitted_at ?? requestRecord.created_at ?? new Date().toISOString()),
      });
      totalMirrored += 1;
    }

    console.log(`[public-intake.backfill] Mirrored ${totalMirrored} record(s) so far`);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  console.log(`[public-intake.backfill] Complete. Total mirrored: ${totalMirrored}`);
}

main()
  .catch((error) => {
    console.error("[public-intake.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
