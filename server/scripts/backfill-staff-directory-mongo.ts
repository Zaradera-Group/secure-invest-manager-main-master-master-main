import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";
import { mirrorStaffDirectoryToMongo, type StaffDirectoryEntry } from "../src/repositories/staff-directory.mongo.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  const [profilesResult, rolesResult] = await Promise.all([
    adminSupabase.from("profiles").select("id, full_name"),
    adminSupabase.from("user_roles").select("user_id, role, is_available_for_approvals"),
  ]);

  if (profilesResult.error) throw new Error(`Failed to load profiles: ${profilesResult.error.message}`);
  if (rolesResult.error) throw new Error(`Failed to load user roles: ${rolesResult.error.message}`);

  const entries = new Map<string, StaffDirectoryEntry>();
  for (const profile of profilesResult.data ?? []) {
    entries.set(profile.id, {
      userId: profile.id,
      fullName: profile.full_name?.trim() || null,
      roles: [],
      approvalAvailability: {},
    });
  }

  for (const role of rolesResult.data ?? []) {
    const entry = entries.get(role.user_id) ?? {
      userId: role.user_id,
      fullName: null,
      roles: [],
      approvalAvailability: {},
    };
    entry.roles.push(role.role);
    entry.approvalAvailability[role.role] = role.is_available_for_approvals ?? true;
    entries.set(role.user_id, entry);
  }

  const mirrored = await mirrorStaffDirectoryToMongo([...entries.values()]);
  console.log(`[staff-directory.mongo.backfill] Complete. Mirrored ${mirrored} staff directory record(s).`);
}

main()
  .catch((error) => {
    console.error("[staff-directory.mongo.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
