# Infrastructure Migration Configuration Checklist

This checklist prepares the Zaradera Vest platform for a controlled migration from Supabase dependencies to MongoDB, AWS S3, Resend, Twilio, and Auth0. Completing an item does not authorize a live cutover. Keep Supabase enabled until the final validation and rollback review are complete.

## Operating rule

- Do not remove Supabase environment variables, database records, or storage until every production workflow passes final acceptance testing.
- Do not place passwords, API keys, private keys, Auth0 client secrets, or MongoDB connection strings in Git, Netlify frontend variables, or frontend source code.
- `VITE_*` environment variables are public browser configuration only.

## 1. MongoDB Atlas

- [ ] Atlas database user uses a least-privilege application role.
- [ ] Render outbound network access is allowed in Atlas Network Access.
- [ ] Render has `MONGODB_URI` and `MONGODB_DB_NAME`.
- [ ] Historical backfills have completed for public intake, notifications, investors, certificates, templates, and available workflow records.
- [ ] Mongo mirrors remain enabled:
  - `PUBLIC_INTAKE_MONGO_MIRROR_ENABLED=true`
  - `NOTIFICATIONS_MONGO_MIRROR_ENABLED=true`
  - `WORKFLOW_DATA_MONGO_MIRROR_ENABLED=true`
- [ ] Notification queue reconciliation is enabled with `NOTIFICATION_QUEUE_MONGO_RECONCILIATION_ENABLED=true`, and `npm run audit:notification-queue:mongo` reports `passed: true` from Render Shell.
- [ ] A documented MongoDB backup/export process exists before cutover.

## 2. AWS S3 storage

- [ ] Production S3 bucket exists in the intended AWS Region.
- [ ] Render IAM user has only the required bucket permissions.
- [ ] Render variables are configured: `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optional `S3_PREFIX`.
- [ ] A read-only Supabase storage inventory has been recorded by running `npm run audit:storage:supabase` from Render Shell. This establishes the certificate/passport object count and total size before copying historical files.
- [ ] A dry run of `npm run transfer:storage:s3` completed with the intended S3 bucket and prefix. The command copies only with `STORAGE_TRANSFER_EXECUTE=true`; it never deletes source objects or overwrites mismatched target objects.
- [ ] Historical certificate, template, signature, and passport objects have been copied and verified in S3 before setting `STORAGE_PROVIDER=s3`.
- [ ] Certificate PDFs, signatures, templates, and passport uploads use S3 signed URLs.
- [ ] `STORAGE_HEALTH_CHECK_ENABLED` is disabled after the configuration check, or protected by a long random `STORAGE_HEALTH_CHECK_TOKEN`.

## 3. Transactional email with Resend

- [ ] `zaraderavest.com` is verified in Resend with SPF and DKIM records published in Cloudflare.
- [ ] Render uses `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`.
- [ ] `EMAIL_REDIRECT_TO` is empty or removed in production so recipients receive their own workflow email.
- [ ] Auth0 uses a separate, least-privilege Resend API key or SMTP credential.
- [ ] Auth0 email template sender is a verified Zaradera address.

## 4. Twilio SMS

- [ ] Render has `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and the appropriate sending configuration.
- [ ] `SMS_DELIVERY_ENABLED` remains disabled until sender compliance and testing are complete.
- [ ] Birthday job settings are enabled only after the message sender is approved.

## 5. Auth0 identity configuration

- [ ] The Auth0 tenant is the intended development/test tenant, not an unrelated existing application tenant.
- [ ] A dedicated Zaradera Auth0 **Single Page Application** exists.
- [ ] The Zaradera database connection is enabled only for that application.
- [ ] Callback URL, logout URL, and web origin are configured for the test deployment's exact HTTPS origin.
- [ ] Auth0 roles match Zaradera application roles exactly.
- [ ] Auth0 Authorization Core RBAC is enabled for the test application.
- [ ] Email verification uses the branded Resend template.
- [ ] Authenticator-app OTP and recovery codes are enabled.
- [ ] The Post Login Action is scoped to the Zaradera Auth0 application Client ID, adds the namespaced role claim, and requires MFA for staff roles.
- [ ] A custom Auth0 domain is configured only after the test setup is stable.

## 6. Netlify test configuration

Configure these only in a Deploy Preview or dedicated test-site context, never as production defaults:

```text
VITE_AUTH0_TEST_ENABLED=true
VITE_AUTH0_TEST_DOMAIN=YOUR_AUTH0_TENANT_DOMAIN
VITE_AUTH0_TEST_CLIENT_ID=YOUR_AUTH0_SPA_CLIENT_ID
VITE_AUTH0_TEST_AUDIENCE=YOUR_AUTH0_API_IDENTIFIER
VITE_AUTH0_TEST_ROLES_CLAIM=https://zaraderavest.com/roles
VITE_CERTIFICATE_API_URL=YOUR_RENDER_BACKEND_URL
```

- [ ] The test path is available at `/auth0-test`.
- [ ] The normal `/login` route is still Supabase-only.

## 7. Render Auth0 API preparation

Do not enable Auth0 authentication on existing workflow routes until the isolated test path has been accepted.

- [ ] Create an Auth0 API identifier, for example `https://api.zaraderavest.com`.
- [ ] Record the Auth0 domain and API identifier as private Render values.
- [ ] Add `AUTH_MODE=dual`, `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, and `AUTH0_ROLES_CLAIM` only when Auth0 JWT validation middleware is ready.
- [ ] Add a MongoDB `staff_accounts` collection that maps Auth0 `sub` values to active Zaradera staff records and roles.
- [ ] Add Auth0 JWT signature, issuer, audience, and expiry validation in Render.
- [ ] Validate Auth0 tokens against the read-only authenticated `/auth/me` endpoint before enabling any certificate or investor write operation.

## 8. Final testing and cutover

Only begin this section after all configuration items above are complete.

- [ ] Test one Auth0 pilot staff user with email verification, MFA, assigned role, and `/auth0-test`.
- [ ] Test Render Auth0 token validation against a read-only endpoint.
- [ ] Test a dual-auth pilot without changing the standard staff login.
- [ ] Reconcile MongoDB and Supabase record counts and latest updates.
- [ ] Test intake, notifications, investor creation, approvals, certificate signing, PDF generation, storage, and outbound email.
- [ ] Document rollback: retain Supabase login, variables, and data until the agreed stabilization period ends.
- [ ] Only then retire remaining Supabase dependencies and cancel/downgrade the subscription.
