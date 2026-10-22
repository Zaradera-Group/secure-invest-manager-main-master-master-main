import { closeMongoClient, getMongoDb, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";

async function main() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");

  const { data, error } = await adminSupabase.from("user_roles").select("user_id, role");
  if (error) throw new Error(`Failed to load staff roles: ${error.message}`);

  const expectedUserIds = new Set((data ?? []).map((assignment) => assignment.user_id));
  const expectedAssignments = new Set((data ?? []).map((assignment) => `${assignment.user_id}:${assignment.role}`));
  const contacts = await (await getMongoDb()).collection<{ userId: string; email: string | null; roles: string[] }>("staff_contacts")
    .find({}, { projection: { _id: 0, userId: 1, email: 1, roles: 1 } })
    .toArray();
  const contactUserIds = new Set(contacts.map((contact) => contact.userId));
  const contactAssignments = new Set(contacts.flatMap((contact) => contact.roles.map((role) => `${contact.userId}:${role}`)));
  const missingUserIds = [...expectedUserIds].filter((userId) => !contactUserIds.has(userId));
  const missingRoleAssignments = [...expectedAssignments].filter((assignment) => !contactAssignments.has(assignment));
  const missingEmailUserIds = contacts.filter((contact) => expectedUserIds.has(contact.userId) && !contact.email).map((contact) => contact.userId);

  console.log("[staff-contacts.mongo.audit]", {
    expectedUsers: expectedUserIds.size,
    mongoUsers: contactUserIds.size,
    missingUserIds,
    missingRoleAssignments,
    missingEmailUserIds,
  });
  if (missingUserIds.length || missingRoleAssignments.length || missingEmailUserIds.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[staff-contacts.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
