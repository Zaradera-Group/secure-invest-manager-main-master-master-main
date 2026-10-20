import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { adminSupabase } from "../lib/supabase.js";
import { listStaffDirectoryFromMongo } from "../repositories/staff-directory.mongo.js";

const formatRoleLabel = (role: string | null | undefined) => {
  switch (role) {
    case "investment_manager": return "Investment Manager";
    case "accountant": return "Accountant";
    case "general_manager": return "General Manager";
    case "admin": return "IT Manager";
    case "super_admin": return "CEO";
    case "software_engineer": return "Software Engineer";
    default: return "Staff";
  }
};

export class AdminService {
  async getCreatorDirectory() {
    if (env.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo" && isMongoConfigured()) {
      try {
        const staffDirectory = await listStaffDirectoryFromMongo();
        return staffDirectory.flatMap((staffMember) => staffMember.roles.map((role) => {
          const roleLabel = formatRoleLabel(role);
          return {
            userId: staffMember.userId,
            displayName: staffMember.fullName?.trim() || roleLabel,
            roleLabel,
          };
        }));
      } catch (error) {
        console.warn("[staff-directory.mongo] Staff directory read failed; falling back to Supabase", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const [profilesResult, rolesResult] = await Promise.all([
      adminSupabase.from("profiles").select("id, full_name"),
      adminSupabase.from("user_roles").select("user_id, role"),
    ]);

    if (profilesResult.error) throw new Error(`Failed to fetch staff profiles: ${profilesResult.error.message}`);
    if (rolesResult.error) throw new Error(`Failed to fetch staff roles: ${rolesResult.error.message}`);

    const profilesById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name?.trim() || null]));

    return (rolesResult.data ?? []).map((roleRow) => {
      const roleLabel = formatRoleLabel(roleRow.role);
      return {
        userId: roleRow.user_id,
        displayName: profilesById.get(roleRow.user_id) || roleLabel,
        roleLabel,
      };
    });
  }

  async getRoleCounts() {
    if (env.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo" && isMongoConfigured()) {
      try {
        const staffDirectory = await listStaffDirectoryFromMongo();
        return staffDirectory.reduce<Record<string, number>>((counts, staffMember) => {
          for (const role of staffMember.roles) {
            counts[role] = (counts[role] ?? 0) + 1;
          }
          return counts;
        }, {});
      } catch (error) {
        console.warn("[staff-directory.mongo] Staff role count read failed; falling back to Supabase", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { data, error } = await adminSupabase.from("user_roles").select("role");
    if (error) throw new Error(`Failed to fetch staff role counts: ${error.message}`);

    return (data ?? []).reduce<Record<string, number>>((counts, item) => {
      counts[item.role] = (counts[item.role] ?? 0) + 1;
      return counts;
    }, {});
  }

  async getRecentInvestorActivity(limit: number) {
    const { data, error } = await adminSupabase
      .from("audit_logs")
      .select("id, action, created_at, user_id, record_id, new_data, old_data")
      .eq("table_name", "investors")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to fetch investor activity: ${error.message}`);

    return (data ?? []).map((item) => {
      const newData = item.new_data as Record<string, unknown> | null;
      const oldData = item.old_data as Record<string, unknown> | null;
      const investorName =
        (typeof newData?.name === "string" && newData.name)
        || (typeof oldData?.name === "string" && oldData.name)
        || "Unknown investor";

      return {
        id: String(item.id ?? ""),
        action: String(item.action ?? "UNKNOWN"),
        created_at: String(item.created_at ?? ""),
        user_id: typeof item.user_id === "string" ? item.user_id : null,
        record_id: typeof item.record_id === "string" ? item.record_id : null,
        investorName,
      };
    });
  }
}
