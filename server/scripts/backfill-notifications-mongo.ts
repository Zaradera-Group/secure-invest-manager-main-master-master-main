import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { mirrorNotificationsToMongo } from "../src/repositories/notifications.mongo.js";
import { adminSupabase } from "../src/lib/supabase.js";

const pageSize = Number.parseInt(process.env.BACKFILL_PAGE_SIZE ?? "100", 10);

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  let from = 0;
  let totalMirrored = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await adminSupabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read notifications: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    const inputs = data.flatMap((record) => {
      const notification = record as Record<string, unknown>;
      const notificationId = String(notification.id ?? "");

      if (!notificationId) {
        console.warn("[notifications.backfill] Skipped row without id");
        return [];
      }

      return [{
        notificationId,
        notification,
        createdAt: String(notification.created_at ?? new Date().toISOString()),
      }];
    });

    await mirrorNotificationsToMongo(inputs);
    totalMirrored += inputs.length;

    console.log(`[notifications.backfill] Mirrored ${totalMirrored} record(s) so far`);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  console.log(`[notifications.backfill] Complete. Total mirrored: ${totalMirrored}`);
}

main()
  .catch((error) => {
    console.error("[notifications.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
