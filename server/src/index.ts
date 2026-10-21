import "./types/express.js";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { startAuditLogReconciliationJob } from "./jobs/audit-log-reconciliation.job.js";
import { startAuth0StaffAccountReconciliationJob } from "./jobs/auth0-staff-account-reconciliation.job.js";
import { startBirthdaySmsJob } from "./jobs/birthday-sms.job.js";
import { startNotificationAuditReconciliationJob } from "./jobs/notification-audit-reconciliation.job.js";
import { startNotificationWorkerShadowJob } from "./jobs/notification-worker-shadow.job.js";

app.listen(env.PORT, () => {
  console.log(`Certificate workflow API listening on port ${env.PORT}`);
  startBirthdaySmsJob();
  startAuditLogReconciliationJob();
  startAuth0StaffAccountReconciliationJob();
  startNotificationAuditReconciliationJob();
  startNotificationWorkerShadowJob();
});
