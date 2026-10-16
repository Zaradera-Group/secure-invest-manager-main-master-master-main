# Auth0 Staff MFA Test Path

The `/auth0-test` route is isolated from the live Supabase session and cannot access investor, certificate, or workflow APIs. It is only for testing an Auth0 account's email verification, MFA challenge, and staff-role claim.

## 1. Create the Auth0 test application

1. In the Auth0 development tenant, open **Applications > Applications > Create Application**.
2. Name it `Zaradera Vest Auth Test` and select **Single Page Web Applications**.
3. In **Settings**, enter the exact deployed test URL in all three fields:
   - Allowed Callback URLs: `https://YOUR-NETLIFY-SITE.netlify.app/auth0-test`
   - Allowed Logout URLs: `https://YOUR-NETLIFY-SITE.netlify.app/auth0-test`
   - Allowed Web Origins: `https://YOUR-NETLIFY-SITE.netlify.app`
4. Save. Do not add a client secret to Netlify or this repository.

For local testing, add `http://localhost:8080/auth0-test` to the first two fields and `http://localhost:8080` to Allowed Web Origins.

## 2. Assign Auth0 roles

Create and assign the role matching the staff member's Zaradera role exactly:

- `investment_manager`
- `accountant`
- `general_manager`
- `super_admin`
- `admin`
- `software_engineer`
- `staff`

Enable **Authorization Core** RBAC for the test application so the Action below can read `event.authorization.roles`.

## 3. Enforce MFA for staff only

1. Go to **Security > Multi-factor Auth** and enable an appropriate factor, preferably OTP with a mobile authenticator and recovery codes.
2. Set the tenant policy to **Never**. The Action will selectively require MFA only for staff roles.
3. Go to **Actions > Library > Build Custom**, choose **Login / Post Login**, and create `Zaradera Staff MFA and Roles`.
4. In the Action's **Secrets** panel, add `ZARADERA_AUTH0_CLIENT_ID` with the Client ID of `Zaradera Vest Auth Test`. This value is not a client secret; it scopes the Action to this application only.
5. Add this code, then deploy and add it to the **Login Flow**:

```js
exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== event.secrets.ZARADERA_AUTH0_CLIENT_ID) {
    return;
  }

  const roles = event.authorization?.roles || [];
  const staffRoles = new Set([
    'investment_manager',
    'accountant',
    'general_manager',
    'super_admin',
    'admin',
    'software_engineer',
    'staff',
  ]);
  const isStaff = roles.some((role) => staffRoles.has(String(role).toLowerCase()));

  api.idToken.setCustomClaim('https://zaraderavest.com/roles', roles);
  api.accessToken.setCustomClaim('https://zaraderavest.com/roles', roles);

  if (isStaff) {
    api.multifactor.enable('any', { allowRememberBrowser: false });
  }
};
```

This Action exits immediately for other applications in the Auth0 tenant. Do not use it in a production tenant until it has passed the test below.

## 4. Configure Netlify's test environment

Add the following Netlify environment variables for the test deployment. `VITE_` values are public browser configuration, not secrets.

```text
VITE_AUTH0_TEST_ENABLED=true
VITE_AUTH0_TEST_DOMAIN=YOUR_AUTH0_TENANT_DOMAIN
VITE_AUTH0_TEST_CLIENT_ID=YOUR_AUTH0_SPA_CLIENT_ID
VITE_AUTH0_TEST_AUDIENCE=
VITE_AUTH0_TEST_ROLES_CLAIM=https://zaraderavest.com/roles
```

Redeploy the frontend after setting them. No Render variables or backend changes are required for this isolated path.

## 5. Acceptance test

1. Create an Auth0 test user on the correct database connection and assign one staff role.
2. Verify the user's email.
3. Open `/auth0-test` and sign in.
4. Confirm Auth0 prompts for MFA.
5. Confirm the page reports `Email verified: Yes`, the expected role, and `Staff access claim: Recognized`.
6. Confirm the user cannot access live investor or certificate data through this route.

Only after that test passes should we add Auth0 JWT validation to the Render API and implement a controlled parallel sign-in rollout.
