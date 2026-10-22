const requiredAuth0TestConfig = {
  domain: import.meta.env.VITE_AUTH0_TEST_DOMAIN?.trim(),
  clientId: import.meta.env.VITE_AUTH0_TEST_CLIENT_ID?.trim(),
};

export const isAuth0TestEnabled = import.meta.env.VITE_AUTH0_TEST_ENABLED === 'true';

export const isAuth0TestConfigured = Boolean(
  isAuth0TestEnabled
  && requiredAuth0TestConfig.domain
  && requiredAuth0TestConfig.clientId,
);

export const auth0TestConfig = {
  ...requiredAuth0TestConfig,
  audience: import.meta.env.VITE_AUTH0_TEST_AUDIENCE?.trim() || undefined,
  redirectUri: `${globalThis.location.origin}/auth0-test`,
  rolesClaim: import.meta.env.VITE_AUTH0_TEST_ROLES_CLAIM?.trim()
    || 'https://zaraderavest.com/roles',
};

export const staffAuth0Roles = new Set([
  'investment_manager',
  'accountant',
  'general_manager',
  'super_admin',
  'admin',
  'software_engineer',
  'staff',
]);
