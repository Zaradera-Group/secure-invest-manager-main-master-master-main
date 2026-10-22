import { adminSupabase } from "./supabase.js";
import { env } from "../config/env.js";
import {
  mirrorSecurityAuditRecordsToMongo,
  mirrorSecurityAuditRecordToMongoSafely,
  insertSecurityAuditRecordInMongo,
  type SecurityAuditRecord,
} from "../repositories/security-audit.mongo.js";

type AuditAction =
  | "certificate_created"
  | "certificate_signed_by_manager"
  | "certificate_signed_by_general_manager"
  | "certificate_approved_by_ceo"
  | "certificate_sent_to_investor"
  | "certificate_download_link_generated"
  | "certificate_refreshed_after_investor_update"
  | "investor_deleted_permanently";

export const insertAuditLog = async (input: {
  action: AuditAction;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  certificateId?: string | null;
  targetEmail?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  if (env.SECURITY_AUDIT_MONGO_WRITE_MODE === "mongo") {
    if (!env.MONGODB_URI || !env.MONGODB_DB_NAME) {
      throw new Error("MongoDB is required while SECURITY_AUDIT_MONGO_WRITE_MODE=mongo");
    }

    const record = await insertSecurityAuditRecordInMongo({
      action: input.action,
      actor_user_id: input.actorUserId ?? null,
      actor_email: input.actorEmail ?? null,
      actor_role: input.actorRole ?? null,
      certificate_id: input.certificateId ?? null,
      target_email: input.targetEmail ?? null,
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    });

    const { error } = await adminSupabase.from("security_audit_logs").upsert(record, { onConflict: "id" });
    if (error) {
      console.warn("[security-audit.mongo] Mongo write succeeded but Supabase compatibility mirror failed", {
        auditId: record.id,
        reason: error.message,
      });
    }
    return;
  }

  const { data, error } = await adminSupabase
    .from("security_audit_logs")
    .insert({
      action: input.action,
      actor_user_id: input.actorUserId ?? null,
      actor_email: input.actorEmail ?? null,
      actor_role: input.actorRole ?? null,
      certificate_id: input.certificateId ?? null,
      target_email: input.targetEmail ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert audit log: ${error?.message ?? "no record was returned"}`);
  }

  const record = data as SecurityAuditRecord;
  if (env.SECURITY_AUDIT_MONGO_WRITE_MODE === "dual") {
    await mirrorSecurityAuditRecordsToMongo([record]);
  } else {
    mirrorSecurityAuditRecordToMongoSafely(record);
  }
};
