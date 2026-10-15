import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";
import type { Collection, Document } from "mongodb";
import { env } from "../config/env.js";

export const workflowMirrorTables = [
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
    case "investors":
      return [collection.createIndex({ email: 1 })];
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

function buildWorkflowDocument(table: WorkflowMirrorTable, record: Record<string, unknown>, mirroredAt: string) {
  return {
    supabaseId: record.id,
    sourceTable: table,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
    mirroredAt,
    email: table === "investors" ? record.email ?? null : undefined,
    investorId: table === "certificates" || table === "investor_certificates" ? record.investor_id ?? null : undefined,
    certificateId: table === "certificate_approval_events" ? record.certificate_id ?? null : undefined,
    status: table === "certificates" || table === "investor_certificates" ? record.status ?? null : undefined,
    storagePath: table === "certificate_templates" ? record.storage_path ?? null : undefined,
    rawSupabaseRecord: record,
  };
}
