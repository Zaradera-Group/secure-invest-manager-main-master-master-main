# Migration End-to-End Runbook

Use this runbook after the current migration commits have been deployed to Render and Netlify. It verifies the deployed infrastructure without enabling the final Auth0 login cutover or moving high-risk certificate writes to MongoDB.

## 1. Deploy and Configure

1. Merge the outstanding migration commits and confirm the Render deployment completed successfully.
2. In Render, set these non-secret values:

```text
AUTH_MODE=dual
AUTH0_WORKFLOW_ACCESS_ENABLED=false
PUBLIC_INTAKE_OTP_STORAGE_MODE=mongo
MIGRATION_HEALTH_CHECK_ENABLED=true
MIGRATION_HEALTH_CHECK_TOKEN=<long random secret>
```

3. Confirm MongoDB settings, Auth0 issuer/audience/claims, Twilio settings, and the selected storage provider are already present in Render.
4. Deploy Netlify after any frontend commit. Do not enable the production Auth0 login yet.

## 2. Migration Preflight

Call the deployed backend endpoint:

```text
GET /health/migration
x-health-check-token: <MIGRATION_HEALTH_CHECK_TOKEN>
```

Expected result:

```json
{
  "status": "ready",
  "mongo": { "configured": true, "healthy": true },
  "authentication": {
    "mode": "dual",
    "auth0Configured": true,
    "workflowAccessEnabled": false
  },
  "persistence": {
    "publicIntakeOtp": "mongo"
  }
}
```

Do not continue if the response is `degraded`, MongoDB is unhealthy, or Auth0 is not configured in dual mode.

## 3. MongoDB Reconciliation Checks

Run these from Render Shell after the latest backend deployment. Do not run the commands from a local machine that cannot resolve the Atlas SRV hostname.

```bash
npm run backfill:workflow-data:mongo
npm run audit:workflow-data:mongo
npm run backfill:staff-directory:mongo
npm run audit:staff-directory:mongo
npm run backfill:notification-preferences:mongo
npm run audit:notification-preferences:mongo
npm run audit:notifications:mongo
npm run audit:notification-audit:mongo
```

For announcements, only after its workflow-data audit passes, set:

```text
ANNOUNCEMENTS_MONGO_READ_MODE=mongo
ANNOUNCEMENTS_DATA_SOURCE=mongo
```

Redeploy Render after changing these values, then create and delete one test announcement. Verify it appears only in MongoDB.

## 4. Auth0 Readiness Test

1. Open `/auth0-test` on the Netlify deployment.
2. Sign in with the pilot Auth0 user.
3. Complete the Auth0 MFA challenge.
4. Confirm email verification, role claim, and staff-access claim are recognized.
5. Select **Link Auth0 account to staff record**.
6. Select **Validate Render identity**.
7. Confirm Render accepts the identity and reports the correct role.

Keep `AUTH0_WORKFLOW_ACCESS_ENABLED=false`. The Auth0 pilot must not access the live workflow during this readiness test.

## 5. Public Intake Test

1. Open the public investor intake page in a private browser session.
2. Request a phone verification code and confirm Twilio delivers it.
3. Submit the correct code once; confirm a second use is rejected.
4. Submit the intake form.
5. Confirm the staff inbox displays the submission.
6. Confirm the matching MongoDB public-intake document and notification document exist.

## 6. Notification Worker Shadow Check

The legacy Supabase Edge worker remains the delivery authority while the Render replacement is built. Enable the read-only observer in Render after the deployed queue is healthy:

```text
NOTIFICATION_WORKER_SHADOW_ENABLED=true
NOTIFICATION_WORKER_SHADOW_CRON=*/5 * * * *
```

Redeploy Render, then check the service logs for `[notification-worker.shadow]`. The log contains queue status counts, due pending jobs, and stale processing jobs. It must report only observation; it never claims a job or sends an email/SMS. Keep the existing Edge worker scheduled during this stage.

## 7. Existing Staff Workflow Test

For one approved staff account, use the current Supabase login and verify:

1. Investor list visibility matches the role and creator scope.
2. Investor create/edit and passport upload work.
3. Certificate creation, approval, signing, and sending respect role boundaries.
4. Dashboard notifications, unread count, and mark-read actions work.
5. Notification preferences save and reminder settings remain visible.

## 8. Completion Criteria

The current migration phase is ready when:

- Migration preflight reports `ready`.
- Mongo audits pass for the selected read domains.
- Auth0 pilot verification, MFA, role claim, staff mapping, and Render identity all pass.
- Public intake OTPs are stored and consumed through MongoDB.
- Existing staff workflow tests pass using the current Supabase login.

## 9. Deferred Cutovers

Do not enable these until a separate approved change window:

- `AUTH0_WORKFLOW_ACCESS_ENABLED=true`
- `AUTH_MODE=auth0`
- MongoDB-primary writes for investors, certificates, notifications, or notification preferences

Notification preferences remain Supabase-primary because the current reminder queue and delivery workers are Supabase Edge Functions/RPCs. Migrating them requires moving those workers and their queue together, then testing delivery, retries, and audit records as one release.
