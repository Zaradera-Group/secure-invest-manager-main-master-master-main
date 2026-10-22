import { closeMongoClient, isMongoConfigured } from "../src/lib/mongodb.js";
import { notificationDeliveryReadinessService } from "../src/services/notification-delivery-readiness.service.js";

async function main() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME before running this audit.");
  }

  const report = await notificationDeliveryReadinessService.inspectActiveQueue();
  const passed = report.unsupported === 0 && report.invalid === 0;
  console.log("[notification-delivery.mongo.audit]", { ...report, passed });
  if (!passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[notification-delivery.mongo.audit] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
