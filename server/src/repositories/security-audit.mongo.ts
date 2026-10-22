import { env } from "../config/env.js";
import { randomUUID } from "node:crypto";
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

type SecurityAuditInsertInput = {
  id?: string;
  action: string;
  actor_user_id?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  certificate_id?: string | null;
  target_email?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export async function insertSecurityAuditRecordInMongo(input: SecurityAuditInsertInput) {
  const record: SecurityAuditRecord = {
    id: input.id ?? randomUUID(),
    action: input.action,
    actor_user_id: input.actor_user_id,
    actor_email: input.actor_email,
    actor_role: input.actor_role,
    certificate_id: input.certificate_id,
    target_email: input.target_email,
    metadata: input.metadata,
    created_at: input.created_at,
  };
  const collection = await getCollection();
  const now = new Date().toISOString();
  await collection.updateOne(
    { supabaseId: record.id },
    {
      $set: {
        supabaseId: record.id,
        action: record.action,
        actorUserId: record.actor_user_id ?? null,
        actorEmail: record.actor_email ?? null,
        actorRole: record.actor_role ?? null,
        certificateId: record.certificate_id ?? null,
        targetEmail: record.target_email ?? null,
        metadata: record.metadata ?? {},
        createdAt: record.created_at ?? now,
        rawSupabaseRecord: record,
        source: "mongo",
        mirroredAt: now,
      },
      $setOnInsert: { insertedAt: now },
    },
    { upsert: true },
  );
  return record;
}

export function mirrorSecurityAuditRecordToMongoSafely(record: SecurityAuditRecord) {
  void mirrorSecurityAuditRecordsToMongo([record]).catch((error) => {
    console.warn("[security-audit.mongo] Failed to mirror security audit event", {
      auditId: record.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}
