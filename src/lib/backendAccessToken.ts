import { supabase } from '@/integrations/supabase/client';

type AccessTokenProvider = () => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

/**
 * Registers the active browser identity provider. The current Supabase session is
 * retained as a fallback until the live Auth0 cutover is enabled.
 */
export function setBackendAccessTokenProvider(provider: AccessTokenProvider | null) {
  accessTokenProvider = provider;
}

export async function getBackendAccessToken(message = 'Your session has expired. Please sign in again.') {
  if (accessTokenProvider) {
    const token = await accessTokenProvider();
    if (token) {
      return token;
    }

    throw new Error(message);
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  const token = data.session?.access_token;
  if (!token) {
    throw new Error(message);
  }

  return token;
}

export async function getBackendAuthorizationHeaders(message?: string) {
  return { Authorization: `Bearer ${await getBackendAccessToken(message)}` };
}
