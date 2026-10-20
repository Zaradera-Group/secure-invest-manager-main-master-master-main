import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const [profilesResult, rolesResult] = await Promise.all([
    adminSupabase.from("profiles").select("id"),
    adminSupabase.from("user_roles").select("user_id, role"),
  ]);
  if (profilesResult.error) throw new Error(`Failed to load profiles: ${profilesResult.error.message}`);
  if (rolesResult.error) throw new Error(`Failed to load user roles: ${rolesResult.error.message}`);

  const expectedUserIds = new Set([
    ...(profilesResult.data ?? []).map((profile) => profile.id),
    ...(rolesResult.data ?? []).map((role) => role.user_id),
  ]);
  const expectedAssignments = new Set((rolesResult.data ?? []).map((role) => `${role.user_id}:${role.role}`));
  const mongoEntries = await (await getMongoDb()).collection<{ userId: string; roles?: string[] }>("staff_directory")
    .find({}, { projection: { _id: 0, userId: 1, roles: 1 } })
    .toArray();
  const mongoUserIds = new Set(mongoEntries.map((entry) => entry.userId));
  const mongoAssignments = new Set(mongoEntries.flatMap((entry) => (entry.roles ?? []).map((role) => `${entry.userId}:${role}`)));
  const missingUserIds = [...expectedUserIds].filter((userId) => !mongoUserIds.has(userId));
  const missingRoleAssignments = [...expectedAssignments].filter((assignment) => !mongoAssignments.has(assignment));

  console.log("[staff-directory.mongo.audit]", {
    supabaseUsers: expectedUserIds.size,
    mongoUsers: mongoUserIds.size,
    supabaseRoleAssignments: expectedAssignments.size,
    mongoRoleAssignments: mongoAssignments.size,
    missingUserIds,
    missingRoleAssignments,
  });

  if (missingUserIds.length || missingRoleAssignments.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[staff-directory.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
