const requiredAuth0LiveConfig = {
  domain: import.meta.env.VITE_AUTH0_LIVE_DOMAIN?.trim(),
  clientId: import.meta.env.VITE_AUTH0_LIVE_CLIENT_ID?.trim(),
};

export const isAuth0LiveEnabled = import.meta.env.VITE_AUTH0_LIVE_ENABLED === 'true';

export const isAuth0LiveConfigured = Boolean(
  isAuth0LiveEnabled
  && requiredAuth0LiveConfig.domain
  && requiredAuth0LiveConfig.clientId,
);

export const auth0LiveConfig = {
  ...requiredAuth0LiveConfig,
  audience: import.meta.env.VITE_AUTH0_LIVE_AUDIENCE?.trim() || undefined,
  redirectUri: `${globalThis.location.origin}/login`,
};
