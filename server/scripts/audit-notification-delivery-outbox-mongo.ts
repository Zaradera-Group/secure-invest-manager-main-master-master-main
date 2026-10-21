import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { getNotificationDeliveryOutboxCounts } from "../src/repositories/notification-delivery-outbox.mongo.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  console.log("[notification-delivery-outbox.mongo.audit]", {
    statusCounts: await getNotificationDeliveryOutboxCounts(),
    note: "No legacy jobs are copied into this outbox. It remains empty until a producer is deliberately migrated.",
  });
}

main()
  .catch((error) => {
    console.error("[notification-delivery-outbox.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
