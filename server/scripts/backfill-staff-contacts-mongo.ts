import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { adminSupabase } from "../src/lib/supabase.js";
import { mirrorStaffContactsToMongo, type StaffContact } from "../src/repositories/staff-contacts.mongo.js";
import type { User } from "@supabase/supabase-js";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

async function listAllAuthUsers() {
  const users: User[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw new Error(`Failed to load staff authentication records: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1_000) return users;
    page += 1;
  }
}

async function main() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");

  const [rolesResult, users] = await Promise.all([
    adminSupabase.from("user_roles").select("user_id, role"),
    listAllAuthUsers(),
  ]);
  if (rolesResult.error) throw new Error(`Failed to load staff roles: ${rolesResult.error.message}`);

  const rolesByUserId = new Map<string, string[]>();
  for (const assignment of rolesResult.data ?? []) {
    const roles = rolesByUserId.get(assignment.user_id) ?? [];
    roles.push(assignment.role);
    rolesByUserId.set(assignment.user_id, roles);
  }

  const contacts: StaffContact[] = users
    .filter((user) => rolesByUserId.has(user.id))
    .map((user) => ({
      userId: user.id,
      email: text(user.email)?.toLowerCase() ?? null,
      phone: text(user.phone) ?? text(user.user_metadata?.phone),
      roles: rolesByUserId.get(user.id) ?? [],
      isActive: !user.banned_until || new Date(user.banned_until).getTime() <= Date.now(),
    }));

  const mirrored = await mirrorStaffContactsToMongo(contacts);
  console.log(`[staff-contacts.mongo.backfill] Complete. Mirrored ${mirrored} private staff contact record(s).`);
}

main()
  .catch((error) => {
    console.error("[staff-contacts.mongo.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
