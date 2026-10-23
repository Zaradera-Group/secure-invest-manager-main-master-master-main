import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import type { AuthError } from '@supabase/supabase-js';
import {
  AuthContext,
  normalizeAppRole,
  type AppAuthSession,
  type AppAuthUser,
  type AppRole,
  type RequestedRole,
} from '@/contexts/AuthContext';
import { setBackendAccessTokenProvider } from '@/lib/backendAccessToken';
import { auth0LiveConfig } from '@/lib/auth0Live';

type Auth0LiveAuthProviderProps = Readonly<{ children: ReactNode }>;
const AUTH_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL?.trim().replace(/\/+$/, '');
const AUTH_PROVIDER_STORAGE_KEY = 'auth:provider';

function isMfaRequired(role: AppRole | null) {
  return role === 'investment_manager'
    || role === 'accountant'
    || role === 'general_manager'
    || role === 'super_admin';
}

function asAuthError(message: string, status = 400) {
  return { name: 'AuthApiError', message, status } as AuthError;
}

function toAppUser(user: ReturnType<typeof useAuth0>['user']): AppAuthUser | null {
  if (!user?.sub) {
    return null;
  }

  return {
    id: user.sub,
    email: user.email,
    user_metadata: {
      full_name: user.name ?? user.nickname ?? undefined,
      phone: user.phone_number,
    },
    created_at: user.updated_at,
    last_sign_in_at: user.updated_at,
  };
}

export function Auth0LiveAuthProvider({ children }: Auth0LiveAuthProviderProps) {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading: isAuth0Loading,
    loginWithRedirect,
    logout,
    user: auth0User,
  } = useAuth0();
  const [role, setRole] = useState<AppRole | null>(null);
  const [accessIssue, setAccessIssue] = useState<string | null>(null);
  const [loadingIdentity, setLoadingIdentity] = useState(false);
  const [session, setSession] = useState<AppAuthSession | null>(null);
  const user = useMemo(() => toAppUser(auth0User), [auth0User]);
  const emailVerified = Boolean(auth0User?.email_verified);

  const getToken = useCallback(async () => {
    return getAccessTokenSilently({
      authorizationParams: auth0LiveConfig.audience
        ? { audience: auth0LiveConfig.audience }
        : undefined,
    });
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated) {
      globalThis.localStorage?.removeItem(AUTH_PROVIDER_STORAGE_KEY);
      setBackendAccessTokenProvider(null);
      setSession(null);
      return;
    }

    globalThis.localStorage?.setItem(AUTH_PROVIDER_STORAGE_KEY, 'auth0');
    setBackendAccessTokenProvider(getToken);
    return () => setBackendAccessTokenProvider(null);
  }, [getToken, isAuthenticated]);

  useEffect(() => {
    let cancelled = false;

    const loadIdentity = async () => {
      if (!isAuthenticated || !user || !emailVerified) {
        if (!cancelled) {
          setSession(null);
          setRole(null);
          setAccessIssue(isAuthenticated && !emailVerified
            ? 'Please verify your email address before accessing the dashboard.'
            : null);
        }
        return;
      }

      if (!AUTH_API_URL) {
        if (!cancelled) {
          setSession(null);
          setRole(null);
          setAccessIssue('The authentication service URL is not configured.');
        }
        return;
      }

      setLoadingIdentity(true);
      try {
        const token = await getToken();
        const response = await fetch(`${AUTH_API_URL}/auth/me`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json().catch(() => null) as { role?: string; message?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.message ?? 'Your Auth0 account is not approved for this system.');
        }

        const nextRole = normalizeAppRole(payload?.role);
        if (!nextRole) {
          throw new Error('Your Auth0 account does not have a recognized staff role.');
        }

        if (!cancelled) {
          setSession({ access_token: token, user });
          setRole(nextRole);
          setAccessIssue(null);
        }
      } catch (error) {
        if (!cancelled) {
          setSession(null);
          setRole(null);
          setAccessIssue(error instanceof Error ? error.message : 'Unable to validate your Auth0 access.');
        }
      } finally {
        if (!cancelled) {
          setLoadingIdentity(false);
        }
      }
    };

    void loadIdentity();
    return () => {
      cancelled = true;
    };
  }, [emailVerified, getToken, isAuthenticated, user]);

  const ensureFreshSession = useCallback(async (): Promise<AppAuthSession | null> => {
    if (!isAuthenticated || !user) {
      setSession(null);
      return null;
    }

    const accessToken = await getToken();
    const nextSession = { access_token: accessToken, user };
    setSession(nextSession);
    return nextSession;
  }, [getToken, isAuthenticated, user]);

  const signIn = useCallback(async (_email: string, _password: string) => {
    await loginWithRedirect({
      appState: { returnTo: '/dashboard' },
      authorizationParams: {
        redirect_uri: auth0LiveConfig.redirectUri,
        ...(auth0LiveConfig.audience ? { audience: auth0LiveConfig.audience } : {}),
      },
    });
    return { error: null };
  }, [loginWithRedirect]);

  const signUp = useCallback(async (
    _email: string,
    _password: string,
    _fullName: string,
    _requestedRole: RequestedRole,
  ) => ({ error: asAuthError('Staff accounts are provisioned by an administrator in Auth0.', 403) }), []);

  const signOut = useCallback(async () => {
    await logout({ logoutParams: { returnTo: `${globalThis.location.origin}/login` } });
  }, [logout]);

  const mfaRequired = isMfaRequired(role);
  // Auth0 issues the token only after its Post Login Action has completed the staff MFA challenge.
  const mfaVerified = Boolean(isAuthenticated && emailVerified && role);

  const value = useMemo(() => ({
    provider: 'auth0' as const,
    session,
    user,
    role,
    loading: isAuth0Loading || loadingIdentity,
    signupEnabled: false,
    emailVerified,
    accessIssue,
    mfaRequired,
    mfaVerified,
    refreshMfaStatus: async () => undefined,
    ensureFreshSession,
    signIn,
    signUp,
    signOut,
  }), [accessIssue, emailVerified, ensureFreshSession, isAuth0Loading, loadingIdentity, mfaRequired, mfaVerified, role, session, signIn, signOut, signUp, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
