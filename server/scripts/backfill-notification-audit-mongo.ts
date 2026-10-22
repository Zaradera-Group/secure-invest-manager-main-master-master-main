import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { reconcileNotificationAuditToMongo } from "../src/repositories/notification-audit.mongo.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this backfill.");
  }

  const totals = await reconcileNotificationAuditToMongo();
  console.log("[notification-audit.mongo.backfill] Complete", totals);
}

main()
  .catch((error) => {
    console.error("[notification-audit.mongo.backfill] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
