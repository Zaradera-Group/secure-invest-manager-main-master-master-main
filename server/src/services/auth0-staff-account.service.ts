import { adminSupabase } from "../lib/supabase.js";
import { getStaffAccountByEmail, upsertStaffAccount } from "../repositories/staff-accounts.mongo.js";
import type { AppRole, AuthenticatedUser } from "../types/certificates.js";

const supportedRoles = new Set<AppRole>([
  "investment_manager",
  "accountant",
  "general_manager",
  "super_admin",
  "admin",
  "software_engineer",
  "staff",
]);

const normalizeRole = (value: unknown): AppRole | null => {
  const role = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return supportedRoles.has(role as AppRole) ? role as AppRole : null;
};

export class Auth0StaffAccountService {
  async provision(actor: AuthenticatedUser) {
    if (actor.provider !== "auth0") {
      throw new Error("Auth0 staff mapping requires an Auth0 access token");
    }
    if (!actor.email) {
      throw new Error("Auth0 access token has no email claim");
    }

    const { data, error } = await adminSupabase
      .from("allowed_auth_users")
      .select("id, email, role, full_name, is_active")
      .eq("email", actor.email)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(`Failed to verify approved staff account: ${error.message}`);
    if (!data) throw new Error("Auth0 email is not approved for Zaradera staff access");

    const approvedRole = normalizeRole(data.role);
    if (!approvedRole || approvedRole !== actor.role) {
      throw new Error("Auth0 role does not match the approved Zaradera staff role");
    }

    const existingByEmail = await getStaffAccountByEmail(actor.email);
    if (existingByEmail && existingByEmail.auth0Subject !== actor.id) {
      throw new Error("This Zaradera staff email is already linked to a different Auth0 account");
    }

    const account = await upsertStaffAccount({
      auth0Subject: actor.id,
      email: actor.email,
      role: actor.role,
      allowedAuthUserId: data.id,
      fullName: data.full_name?.trim() || null,
      isActive: true,
    });
    if (!account) throw new Error("Failed to create Auth0 staff mapping");

    return {
      mapped: true,
      auth0Subject: account.auth0Subject,
      email: account.email,
      role: account.role,
      lastVerifiedAt: account.lastVerifiedAt,
    };
  }
}
