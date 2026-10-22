import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";
import { adminSupabase } from "../lib/supabase.js";

export type AuditLogRecord = Record<string, unknown> & {
  id: string;
  table_name: string;
  action: string;
  user_id?: string | null;
  record_id?: string | null;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  created_at?: string;
};

type MirroredAuditLog = {
  supabaseId: string;
  tableName: string;
  action: string;
  userId: string | null;
  recordId: string | null;
  createdAt: string | null;
  rawSupabaseRecord: AuditLogRecord;
};

type ReconciliationState = {
  key: string;
  lastCreatedAt?: string;
  updatedAt: string;
};

const collectionName = "audit_logs";
const reconciliationKey = "audit_logs";
let indexesReady: Promise<void> | null = null;

async function ensureIndexes() {
  const database = await getMongoDb();
  const collection = database.collection<MirroredAuditLog>(collectionName);
  await Promise.all([
    collection.createIndex({ supabaseId: 1 }, { unique: true }),
    collection.createIndex({ tableName: 1, createdAt: -1 }),
    collection.createIndex({ recordId: 1, createdAt: -1 }),
    collection.createIndex({ userId: 1, createdAt: -1 }),
    database.collection<ReconciliationState>("migration_sync_state").createIndex({ key: 1 }, { unique: true }),
  ]);
}

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureIndexes();
  await indexesReady;
  return (await getMongoDb()).collection<MirroredAuditLog>(collectionName);
}

function toInvestorActivity(record: MirroredAuditLog) {
  const newData = record.rawSupabaseRecord.new_data;
  const oldData = record.rawSupabaseRecord.old_data;
  const investorName =
    (typeof newData?.name === "string" && newData.name)
    || (typeof oldData?.name === "string" && oldData.name)
    || "Unknown investor";

  return {
    id: record.supabaseId,
    action: record.action || "UNKNOWN",
    created_at: record.createdAt || "",
    user_id: record.userId,
    record_id: record.recordId,
    investorName,
  };
}

export async function mirrorAuditLogsToMongo(records: AuditLogRecord[]) {
  if (!records.length) return 0;

  const collection = await getCollection();
  const mirroredAt = new Date().toISOString();
  await collection.bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { supabaseId: record.id },
        update: {
          $set: {
            supabaseId: record.id,
            tableName: record.table_name,
            action: record.action,
            userId: record.user_id ?? null,
            recordId: record.record_id ?? null,
            createdAt: record.created_at ?? null,
            rawSupabaseRecord: record,
            mirroredAt,
          },
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return records.length;
}

export async function listRecentInvestorActivityFromMongo(limit: number) {
  const records = await (await getCollection())
    .find({ tableName: "investors" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return records.map(toInvestorActivity);
}

export async function purgeExpiredAuditLogsFromMongo(retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await (await getCollection()).deleteMany({ createdAt: { $lt: cutoff } });
  return result.deletedCount;
}

export async function reconcileAuditLogsToMongo(pageSize = 250) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  const database = await getMongoDb();
  const stateCollection = database.collection<ReconciliationState>("migration_sync_state");
  const state = await stateCollection.findOne({ key: reconciliationKey });
  let from = 0;
  let mirrored = 0;
  let latestCreatedAt = state?.lastCreatedAt;

  while (true) {
    let query = adminSupabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (latestCreatedAt) query = query.gte("created_at", latestCreatedAt);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to reconcile audit logs: ${error.message}`);
    if (!data?.length) break;

    const records = data as AuditLogRecord[];
    mirrored += await mirrorAuditLogsToMongo(records);
    latestCreatedAt = records.at(-1)?.created_at ?? latestCreatedAt;
    if (records.length < pageSize) break;
    from += pageSize;
  }

  if (latestCreatedAt) {
    await stateCollection.updateOne(
      { key: reconciliationKey },
      { $set: { key: reconciliationKey, lastCreatedAt: latestCreatedAt, updatedAt: new Date().toISOString() } },
      { upsert: true },
    );
  }

  return mirrored;
}
