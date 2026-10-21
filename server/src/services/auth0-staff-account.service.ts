import { adminSupabase } from "../lib/supabase.js";
import {
  getStaffAccountByAuth0Subject,
  getStaffAccountByEmail,
  listStaffAccounts,
  upsertStaffAccount,
  updateStaffAccountReconciliation,
} from "../repositories/staff-accounts.mongo.js";
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

export class Auth0StaffAccountMappingError extends Error {}

export class Auth0StaffAccountService {
  async reconcileMappings() {
    const accounts = await listStaffAccounts();
    let active = 0;
    let disabled = 0;
    let changed = 0;

    for (const account of accounts) {
      const isValid = await this.isCurrentStaffAccount(account.email, account.role, account.legacyUserId);
      if (isValid) {
        active += 1;
      } else {
        disabled += 1;
      }

      if (account.isActive !== isValid) {
        await updateStaffAccountReconciliation({
          auth0Subject: account.auth0Subject,
          isActive: isValid,
        });
        changed += 1;
      }
    }

    return { checked: accounts.length, active, disabled, changed };
  }

  async resolveMappedActiveUser(actor: AuthenticatedUser): Promise<AuthenticatedUser> {
    if (actor.provider !== "auth0") {
      return actor;
    }

    const account = await getStaffAccountByAuth0Subject(actor.id);
    if (!account || !account.isActive) {
      throw new Auth0StaffAccountMappingError("Auth0 account is not linked to an active Zaradera staff record");
    }

    if (account.email !== actor.email || account.role !== actor.role) {
      throw new Auth0StaffAccountMappingError("Auth0 identity does not match its Zaradera staff mapping");
    }

    return {
      ...actor,
      id: account.legacyUserId,
    };
  }

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

    const legacyUserId = await this.findLegacyUserId(actor.email, actor.role);

    const existingByEmail = await getStaffAccountByEmail(actor.email);
    if (existingByEmail && existingByEmail.auth0Subject !== actor.id) {
      throw new Error("This Zaradera staff email is already linked to a different Auth0 account");
    }

    const account = await upsertStaffAccount({
      auth0Subject: actor.id,
      email: actor.email,
      role: actor.role,
      allowedAuthUserId: data.id,
      legacyUserId,
      fullName: data.full_name?.trim() || null,
      isActive: true,
    });
    if (!account) throw new Error("Failed to create Auth0 staff mapping");

    return {
      mapped: true,
      auth0Subject: account.auth0Subject,
      email: account.email,
      role: account.role,
      legacyUserId: account.legacyUserId,
      lastVerifiedAt: account.lastVerifiedAt,
    };
  }

  private async findLegacyUserId(email: string, role: AppRole) {
    let page = 1;

    while (true) {
      const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: 1_000 });
      if (error) {
        throw new Error(`Failed to resolve the existing Zaradera staff user: ${error.message}`);
      }

      const legacyUser = data.users.find((user) => user.email?.trim().toLowerCase() === email);
      if (legacyUser) {
        const { data: roleRecord, error: roleError } = await adminSupabase
          .from("user_roles")
          .select("role")
          .eq("user_id", legacyUser.id)
          .maybeSingle();

        if (roleError) {
          throw new Error(`Failed to verify the existing Zaradera staff role: ${roleError.message}`);
        }

        const legacyRole = normalizeRole(roleRecord?.role);
        if (legacyRole !== role) {
          throw new Error("The existing Zaradera staff user does not have the same approved role as Auth0");
        }

        return legacyUser.id;
      }

      if (data.users.length < 1_000) {
        break;
      }

      page += 1;
    }

    throw new Error("No existing Zaradera staff user was found for this Auth0 email");
  }

  private async isCurrentStaffAccount(email: string, role: AppRole, legacyUserId: string) {
    const [allowlistResult, roleResult] = await Promise.all([
      adminSupabase
        .from("allowed_auth_users")
        .select("role")
        .eq("email", email)
        .eq("is_active", true)
        .maybeSingle(),
      adminSupabase
        .from("user_roles")
        .select("role")
        .eq("user_id", legacyUserId)
        .maybeSingle(),
    ]);

    if (allowlistResult.error) {
      throw new Error(`Failed to reconcile the approved Auth0 staff account: ${allowlistResult.error.message}`);
    }
    if (roleResult.error) {
      throw new Error(`Failed to reconcile the legacy Zaradera staff role: ${roleResult.error.message}`);
    }

    return normalizeRole(allowlistResult.data?.role) === role && normalizeRole(roleResult.data?.role) === role;
  }
}
