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

### Storage Baseline

Before any S3 cutover, run this read-only command from Render Shell:

```bash
npm run audit:storage:supabase
```

Record the reported object counts and bytes for the certificate and passport buckets. Do not set `STORAGE_PROVIDER=s3` until those historical objects have been copied to S3 and the counts have been verified.

With the S3 variables configured in Render, first run the S3 transfer in dry-run mode:

```bash
npm run transfer:storage:s3
```

Then perform the copy only after reviewing the inventory:

```bash
STORAGE_TRANSFER_EXECUTE=true npm run transfer:storage:s3
```

The transfer preserves each object path beneath `S3_PREFIX`, skips existing same-size objects, refuses to overwrite a conflicting object, verifies size after upload, and never deletes a Supabase source object. Run `npm run audit:storage:supabase` again and compare it with the transfer summaries before switching `STORAGE_PROVIDER`.

For the first S3 deployment, set `STORAGE_PROVIDER=s3` and `STORAGE_S3_READ_FALLBACK_TO_SUPABASE=true`. New writes use S3. A historical object missing in S3 can temporarily be read from Supabase Storage, avoiding a broken certificate download while the transfer is being verified. After the transfer audit passes, set `STORAGE_S3_READ_FALLBACK_TO_SUPABASE=false` and redeploy. Do not delete Supabase objects before that final check.

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
npm run audit:notification-queue:mongo
npm run audit:notification-delivery-readiness:mongo
npm run audit:notification-delivery-outbox:mongo
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

Before treating the queue mirror as ready for later worker work, run from Render Shell:

```bash
npm run audit:notification-queue:mongo
```

It must report `passed: true`. Do not enable a MongoDB delivery worker based only on a successful mirror audit; the delivery implementation, retries, preference evaluation, and delivery audit write path must be migrated and tested together.

The delivery-readiness audit must also report `passed: true`. It validates the active queue's supported notification types and required identifiers without sending a message or logging recipients.

The MongoDB-native `notification_delivery_outbox` is intentionally separate and starts empty. It is protected by a unique delivery idempotency key, atomic claims, stale-lock recovery, and retry state, but it has no production producer or delivery worker yet. Keep `NOTIFICATION_RENDER_WORKER_ENABLED=false` until a narrowly-scoped producer and its end-to-end delivery tests have been approved.

### Birthday Outbox Shadow Producer

After the queue and delivery-readiness audits pass, the first production-safe producer can be enabled in Render:

```text
BIRTHDAY_OUTBOX_SHADOW_ENABLED=true
```

The existing birthday job continues to send through the established path. This setting only writes an idempotent `shadow` record into MongoDB for each birthday SMS intent. Shadow records are never eligible for delivery by the MongoDB worker. Confirm the birthday-job log reports `outbox_shadow_failed=0`, then inspect with `npm run audit:notification-delivery-outbox:mongo`.

### Birthday Delivery Cutover

Only after the shadow producer has been accepted and Twilio delivery is enabled, switch this single workflow in Render:

```text
BIRTHDAY_OUTBOX_SHADOW_ENABLED=false
BIRTHDAY_DELIVERY_AUTHORITY=render
NOTIFICATION_RENDER_WORKER_ENABLED=true
NOTIFICATION_RENDER_WORKER_CRON=*/5 * * * *
```

Redeploy Render. The birthday scheduler then only creates `live` MongoDB outbox records; the Render worker claims and sends only `birthday_greeting` records in `live` mode. It does not process old `shadow` records or any reminder/certificate notification. The legacy direct birthday sender is skipped in this mode, preventing duplicate SMS delivery. Roll back by setting `BIRTHDAY_DELIVERY_AUTHORITY=legacy` and `NOTIFICATION_RENDER_WORKER_ENABLED=false`, then redeploy.

The queue is reconciled to MongoDB independently every five minutes. When both jobs have run, the shadow log includes `matchesMongo: true`. Resolve any mismatch before a future delivery-worker cutover; delayed reconciliation may cause a temporary mismatch while the queues are changing.

### Certificate Notification Outbox Shadow

Keep certificate-stage delivery on its current sender while validating outbox records:

```text
CERTIFICATE_NOTIFICATION_OUTBOX_SHADOW_ENABLED=true
```

After deployment, advance one test certificate through each approval stage. Dashboard, email, and SMS behavior remains unchanged; MongoDB receives only `shadow` records for the intended channels. Do not enable Render delivery for `certificate_stage_notification` until its recipients and rendered content have been audited.

### Certificate Notification Delivery Cutover

After the certificate-stage shadow records have been accepted, switch only this outbound workflow in Render:

```text
CERTIFICATE_NOTIFICATION_OUTBOX_SHADOW_ENABLED=false
CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY=render
NOTIFICATION_RENDER_WORKER_ENABLED=true
```

The certificate workflow continues to create dashboard notifications in its current path. Email and SMS are instead placed in `live` MongoDB outbox records and delivered by Render. The worker handles only `pending_manager`, `pending_general_manager`, and `pending_ceo` certificate-stage messages. Roll back by setting `CERTIFICATE_NOTIFICATION_DELIVERY_AUTHORITY=legacy` and redeploying.

### Public-Intake Receipt Email Shadow

Enable the observation-only producer after the certificate delivery cutover is stable:

```text
PUBLIC_INTAKE_EMAIL_OUTBOX_SHADOW_ENABLED=true
```

Redeploy Render, submit one controlled public-intake form, and inspect `notification_delivery_outbox` for `public_intake_receipt` records in `shadow` mode. There should be one investor receipt and one record for each internal recipient. The direct email path remains authoritative and the Render worker cannot claim these shadow records. Do not enable a live public-intake email authority until the Mongo-backed receipt renderer and its controlled delivery test are complete.

After the shadow has been accepted, make the reversible delivery switch:

```text
PUBLIC_INTAKE_EMAIL_OUTBOX_SHADOW_ENABLED=false
PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY=render
NOTIFICATION_RENDER_WORKER_ENABLED=true
```

Redeploy Render and submit one controlled intake. The API writes the mirrored request before adding `live` receipt jobs. Render sends only those live jobs and reads the form from MongoDB at send time; the outbox therefore stores delivery metadata rather than the full form. If MongoDB preparation fails, the API logs the reason and sends the receipt through the legacy sender for that request. Roll back by setting `PUBLIC_INTAKE_EMAIL_DELIVERY_AUTHORITY=legacy` and redeploying.

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
