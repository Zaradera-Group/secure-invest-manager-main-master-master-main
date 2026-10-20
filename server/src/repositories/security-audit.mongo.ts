import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

export type SecurityAuditRecord = Record<string, unknown> & {
  id: string;
  action: string;
  actor_user_id?: string | null;
  certificate_id?: string | null;
  created_at?: string;
};

let indexesReady: Promise<void> | null = null;

async function ensureIndexes() {
  if (!isMongoConfigured()) return;

  const collection = (await getMongoDb()).collection("security_audit_logs");
  await Promise.all([
    collection.createIndex({ supabaseId: 1 }, { unique: true }),
    collection.createIndex({ certificateId: 1, createdAt: -1 }),
    collection.createIndex({ actorUserId: 1, createdAt: -1 }),
    collection.createIndex({ action: 1, createdAt: -1 }),
  ]);
}

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureIndexes();
  await indexesReady;
  return (await getMongoDb()).collection("security_audit_logs");
}

export async function mirrorSecurityAuditRecordsToMongo(records: SecurityAuditRecord[]) {
  if (!records.length || !env.SECURITY_AUDIT_MONGO_MIRROR_ENABLED) return 0;

  const collection = await getCollection();
  const mirroredAt = new Date().toISOString();
  await collection.bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { supabaseId: record.id },
        update: {
          $set: {
            supabaseId: record.id,
            action: record.action,
            actorUserId: record.actor_user_id ?? null,
            certificateId: record.certificate_id ?? null,
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

export function mirrorSecurityAuditRecordToMongoSafely(record: SecurityAuditRecord) {
  void mirrorSecurityAuditRecordsToMongo([record]).catch((error) => {
    console.warn("[security-audit.mongo] Failed to mirror security audit event", {
      auditId: record.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}
