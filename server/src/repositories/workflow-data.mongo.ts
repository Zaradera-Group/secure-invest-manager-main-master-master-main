import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";
import type { Collection, Document } from "mongodb";
import { env } from "../config/env.js";

export const workflowMirrorTables = [
  "announcements",
  "investors",
  "certificates",
  "certificate_approval_events",
  "investor_certificates",
  "certificate_templates",
] as const;

export type WorkflowMirrorTable = (typeof workflowMirrorTables)[number];

type WorkflowMirrorInput = {
  table: WorkflowMirrorTable;
  records: Record<string, unknown>[];
};

type WorkflowDeleteInput = {
  table: WorkflowMirrorTable;
  supabaseIds: string[];
};

type MirroredWorkflowDocument = {
  supabaseId: string;
  rawSupabaseRecord?: Record<string, unknown>;
};

const indexesReady = new Map<WorkflowMirrorTable, Promise<void>>();

async function ensureIndexes(table: WorkflowMirrorTable) {
  const db = await getMongoDb();
  const collection = db.collection(table);

  const commonIndexes = [collection.createIndex({ supabaseId: 1 }, { unique: true }), collection.createIndex({ createdAt: -1 })];
  const tableIndexes = getTableIndexes(table, collection);
  await Promise.all([...commonIndexes, ...tableIndexes]);
}

function getTableIndexes(table: WorkflowMirrorTable, collection: Collection<Document>) {
  switch (table) {
    case "announcements":
      return [collection.createIndex({ status: 1, createdAt: -1 })];
    case "investors":
      return [collection.createIndex({ email: 1 }), collection.createIndex({ createdBy: 1, createdAt: -1 })];
    case "certificates":
    case "investor_certificates":
      return [collection.createIndex({ investorId: 1, createdAt: -1 }), collection.createIndex({ status: 1, createdAt: -1 })];
    case "certificate_approval_events":
      return [collection.createIndex({ certificateId: 1, createdAt: -1 })];
    case "certificate_templates":
      return [collection.createIndex({ storagePath: 1 })];
  }
}

export async function mirrorWorkflowRecordsToMongo({ table, records }: WorkflowMirrorInput) {
  if (records.length === 0) {
    return 0;
  }

  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before mirroring workflow data.");
  }

  if (!indexesReady.has(table)) {
    indexesReady.set(table, ensureIndexes(table));
  }
  await indexesReady.get(table);

  const db = await getMongoDb();
  const collection = db.collection(table);
  const validRecords = records.filter((record) => typeof record.id === "string" && record.id.length > 0);

  if (validRecords.length === 0) {
    return 0;
  }

  const mirroredAt = new Date().toISOString();
  await collection.bulkWrite(
    validRecords.map((record) => ({
      updateOne: {
        filter: { supabaseId: record.id },
        update: {
          $set: buildWorkflowDocument(table, record, mirroredAt),
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return validRecords.length;
}

export function mirrorWorkflowRecordsToMongoSafely(input: WorkflowMirrorInput) {
  if (!env.WORKFLOW_DATA_MONGO_MIRROR_ENABLED) {
    return;
  }

  void mirrorWorkflowRecordsToMongo(input).catch((error) => {
    console.warn("[workflow-data.mongo] Failed to mirror workflow records", {
      table: input.table,
      recordIds: input.records.map((record) => record.id).filter((id): id is string => typeof id === "string"),
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

export function deleteWorkflowRecordsFromMongoSafely({ table, supabaseIds }: WorkflowDeleteInput) {
  if (!env.WORKFLOW_DATA_MONGO_MIRROR_ENABLED || !isMongoConfigured()) {
    return;
  }

  const ids = [...new Set(supabaseIds.filter(Boolean))];
  if (!ids.length) return;

  void getMongoDb()
    .then((db) => db.collection(table).deleteMany({ supabaseId: { $in: ids } }))
    .catch((error) => {
      console.warn("[workflow-data.mongo] Failed to remove mirrored workflow records", {
        table,
        recordIds: ids,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

export function deleteWorkflowRecordsByFieldFromMongoSafely(
  table: WorkflowMirrorTable,
  field: "investorId" | "certificateId",
  values: string[],
) {
  if (!env.WORKFLOW_DATA_MONGO_MIRROR_ENABLED || !isMongoConfigured()) {
    return;
  }

  const identifiers = [...new Set(values.filter(Boolean))];
  if (!identifiers.length) return;

  void getMongoDb()
    .then((db) => db.collection(table).deleteMany({ [field]: { $in: identifiers } }))
    .catch((error) => {
      console.warn("[workflow-data.mongo] Failed to remove related mirrored workflow records", {
        table,
        field,
        values: identifiers,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

export async function listWorkflowRecordsFromMongo(table: WorkflowMirrorTable) {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured");
  }

  if (!indexesReady.has(table)) {
    indexesReady.set(table, ensureIndexes(table));
  }
  await indexesReady.get(table);

  const db = await getMongoDb();
  const records = await db.collection<MirroredWorkflowDocument>(table)
    .find({}, { projection: { rawSupabaseRecord: 1, supabaseId: 1 } })
    .sort({ createdAt: -1 })
    .toArray();

  return records.flatMap((record) => record.rawSupabaseRecord ? [record.rawSupabaseRecord] : []);
}

export async function getWorkflowRecordFromMongo(table: WorkflowMirrorTable, supabaseId: string) {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured");
  }

  if (!indexesReady.has(table)) {
    indexesReady.set(table, ensureIndexes(table));
  }
  await indexesReady.get(table);

  const db = await getMongoDb();
  const record = await db.collection<MirroredWorkflowDocument>(table)
    .findOne({ supabaseId }, { projection: { rawSupabaseRecord: 1 } });

  return record?.rawSupabaseRecord ?? null;
}

function buildWorkflowDocument(table: WorkflowMirrorTable, record: Record<string, unknown>, mirroredAt: string) {
  return {
    supabaseId: record.id,
    sourceTable: table,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
    mirroredAt,
    email: table === "investors" ? record.email ?? null : undefined,
    createdBy: table === "investors" ? record.created_by ?? null : undefined,
    investorId: table === "certificates" || table === "investor_certificates" ? record.investor_id ?? null : undefined,
    certificateId: table === "certificate_approval_events" ? record.certificate_id ?? null : undefined,
    status: table === "announcements" || table === "certificates" || table === "investor_certificates"
      ? record.status ?? null
      : undefined,
    storagePath: table === "certificate_templates" ? record.storage_path ?? null : undefined,
    rawSupabaseRecord: record,
  };
}
