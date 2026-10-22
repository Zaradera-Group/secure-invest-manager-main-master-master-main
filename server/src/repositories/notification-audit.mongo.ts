import { randomUUID } from "node:crypto";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";
import { adminSupabase } from "../lib/supabase.js";

export const notificationAuditSources = {
  email_notifications: "sent_at",
  notification_jobs: "scheduled_for",
  job_runs: "started_at",
  email_notifications_archive: "archived_at",
  notification_jobs_archive: "archived_at",
  job_runs_archive: "archived_at",
} as const;

export type NotificationAuditTable = keyof typeof notificationAuditSources;

type NotificationAuditRecord = Record<string, unknown> & { id: string };
type MirroredNotificationAuditRecord = {
  sourceTable: NotificationAuditTable;
  supabaseId: string;
  sortValue: string | null;
  rawSupabaseRecord: NotificationAuditRecord;
  reconciliationRunId: string;
};

const collectionName = "notification_audit_records";
let indexesReady: Promise<void> | null = null;

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= (async () => {
    const collection = (await getMongoDb()).collection<MirroredNotificationAuditRecord>(collectionName);
    await Promise.all([
      collection.createIndex({ sourceTable: 1, supabaseId: 1 }, { unique: true }),
      collection.createIndex({ sourceTable: 1, sortValue: -1 }),
    ]);
  })();
  await indexesReady;
  return (await getMongoDb()).collection<MirroredNotificationAuditRecord>(collectionName);
}

async function mirrorSourceTable(table: NotificationAuditTable, reconciliationRunId: string, pageSize: number) {
  const collection = await getCollection();
  const sortColumn = notificationAuditSources[table];
  let from = 0;
  let mirrored = 0;

  while (true) {
    const { data, error } = await adminSupabase
      .from(table)
      .select("*")
      .order(sortColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to reconcile ${table}: ${error.message}`);
    if (!data?.length) break;

    const mirroredAt = new Date().toISOString();
    const records = data as NotificationAuditRecord[];
    await collection.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { sourceTable: table, supabaseId: record.id },
        update: {
          $set: {
            sourceTable: table,
            supabaseId: record.id,
            sortValue: typeof record[sortColumn] === "string" ? record[sortColumn] : null,
            rawSupabaseRecord: record,
            reconciliationRunId,
            mirroredAt,
          },
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })), { ordered: false });

    mirrored += records.length;
    if (records.length < pageSize) break;
    from += pageSize;
  }

  await collection.deleteMany({ sourceTable: table, reconciliationRunId: { $ne: reconciliationRunId } });
  return mirrored;
}

export async function reconcileNotificationAuditToMongo(pageSize = 250) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  const reconciliationRunId = randomUUID();
  const totals = {} as Record<NotificationAuditTable, number>;
  for (const table of Object.keys(notificationAuditSources) as NotificationAuditTable[]) {
    totals[table] = await mirrorSourceTable(table, reconciliationRunId, pageSize);
  }
  return totals;
}

export async function listNotificationAuditRecordsFromMongo(table: NotificationAuditTable, page: number, pageSize: number) {
  const records = await (await getCollection())
    .find({ sourceTable: table }, { projection: { rawSupabaseRecord: 1 } })
    .sort({ sortValue: -1 })
    .skip(page * pageSize)
    .limit(pageSize)
    .toArray();

  return records.flatMap((record) => record.rawSupabaseRecord ? [record.rawSupabaseRecord] : []);
}
