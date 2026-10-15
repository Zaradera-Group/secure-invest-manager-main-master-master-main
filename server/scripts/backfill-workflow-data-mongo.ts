import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import {
  mirrorWorkflowRecordsToMongo,
  workflowMirrorTables,
  type WorkflowMirrorTable,
} from "../src/repositories/workflow-data.mongo.js";
import { adminSupabase } from "../src/lib/supabase.js";

const pageSize = Number.parseInt(process.env.BACKFILL_PAGE_SIZE ?? "250", 10);
const requestedTable = process.env.BACKFILL_WORKFLOW_TABLE?.trim();

function getTablesToBackfill() {
  if (!requestedTable) {
    return workflowMirrorTables;
  }

  if (!workflowMirrorTables.includes(requestedTable as WorkflowMirrorTable)) {
    throw new Error(`Unknown workflow table: ${requestedTable}`);
  }

  return [requestedTable as WorkflowMirrorTable];
}

async function backfillTable(table: WorkflowMirrorTable) {
  let from = 0;
  let totalMirrored = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await adminSupabase.from(table).select("*").order("created_at", { ascending: true }).range(from, to);

    if (error) {
      throw new Error(`Failed to read ${table}: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    totalMirrored += await mirrorWorkflowRecordsToMongo({
      table,
      records: data as Record<string, unknown>[],
    });

    console.log(`[workflow-data.backfill] ${table}: mirrored ${totalMirrored} record(s) so far`);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  console.log(`[workflow-data.backfill] ${table}: complete. Total mirrored: ${totalMirrored}`);
}

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  for (const table of getTablesToBackfill()) {
    await backfillTable(table);
  }
}

main()
  .catch((error) => {
    console.error("[workflow-data.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
