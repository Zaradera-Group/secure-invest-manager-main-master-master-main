import { z } from "zod";
import { adminSupabase } from "../lib/supabase.js";
import type { AppRole } from "../types/certificates.js";

const accessLookupSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});

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

  if (role === "ceo" || role === "chief_executive_officer" || role === "superadmin") return "super_admin";
  if (role === "it" || role === "it_admin" || role === "itmanager" || role === "it_manager" || role === "information_technology_manager") return "admin";
  if (role === "investmentmanager" || role === "investment_mgr") return "investment_manager";
  if (role === "company_accountant") return "accountant";
  if (role === "gm" || role === "generalmanager" || role === "general_mgr") return "general_manager";
  if (role === "softwareengineer") return "software_engineer";

  return supportedRoles.has(role as AppRole) ? role as AppRole : null;
};

export class AccessService {
  async isApprovedEmail(input: unknown) {
    const { email } = accessLookupSchema.parse(input);
    const { data, error } = await adminSupabase
      .from("allowed_auth_users")
      .select("email")
      .eq("email", email)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return { allowed: Boolean(data) };
  }

  async getApprovedUser(input: unknown) {
    const { email } = accessLookupSchema.parse(input);
    const { data, error } = await adminSupabase
      .from("allowed_auth_users")
      .select("email, role, full_name, is_active")
      .eq("email", email)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { user: null };

    return {
      user: {
        email: data.email,
        role: normalizeRole(data.role),
        full_name: data.full_name,
        is_active: data.is_active,
      },
    };
  }
}
