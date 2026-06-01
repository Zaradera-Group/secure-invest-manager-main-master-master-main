import { adminSupabase } from "./supabase.js";

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
  const { error } = await adminSupabase.from("security_audit_logs").insert({
    action: input.action,
    actor_user_id: input.actorUserId ?? null,
    actor_email: input.actorEmail ?? null,
    actor_role: input.actorRole ?? null,
    certificate_id: input.certificateId ?? null,
    target_email: input.targetEmail ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error(`Failed to insert audit log: ${error.message}`);
  }
};
