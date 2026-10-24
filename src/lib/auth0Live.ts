const requiredAuth0LiveConfig = {
  domain: import.meta.env.VITE_AUTH0_LIVE_DOMAIN?.trim(),
  clientId: import.meta.env.VITE_AUTH0_LIVE_CLIENT_ID?.trim(),
  audience: import.meta.env.VITE_AUTH0_LIVE_AUDIENCE?.trim(),
};

export const isAuth0LiveEnabled = import.meta.env.VITE_AUTH0_LIVE_ENABLED === 'true';

export const isAuth0LiveConfigured = Boolean(
  isAuth0LiveEnabled
  && requiredAuth0LiveConfig.domain
  && requiredAuth0LiveConfig.clientId
  && requiredAuth0LiveConfig.audience,
);

export const auth0LiveConfig = {
  ...requiredAuth0LiveConfig,
  audience: requiredAuth0LiveConfig.audience,
  // Return directly to the protected dashboard after Auth0 completes MFA.
  // ProtectedRoute keeps the dashboard in a loading state while /auth/me validates the session.
  redirectUri: `${globalThis.location.origin}/dashboard`,
};
