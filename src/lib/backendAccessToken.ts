import { supabase } from '@/integrations/supabase/client';

// Backend clients obtain their bearer token here so the temporary Supabase session
// adapter can be replaced by Auth0 during the controlled login cutover.
export async function getBackendAccessToken(message = 'Your session has expired. Please sign in again.') {
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
