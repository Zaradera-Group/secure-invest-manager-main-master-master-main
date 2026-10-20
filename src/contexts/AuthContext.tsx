import { createContext, useContext, useEffect, useState, type ReactNode, useMemo, useCallback, useRef } from 'react';
import { type Session, type User, type AuthError, type AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole =
  | 'super_admin'
  | 'admin'
  | 'staff'
  | 'investment_manager'
  | 'accountant'
  | 'general_manager'
  | 'software_engineer';

type RequestedRole = 'ceo' | 'general_manager' | 'investment_manager' | 'accountant' | 'it_manager';
type AllowedAuthUser = {
  email: string;
  role: AppRole | null;
  full_name?: string | null;
  is_active?: boolean | null;
};

type AuthProviderProps = Readonly<{
  children: ReactNode;
}>;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  loading: boolean;
  signupEnabled: boolean;
  emailVerified: boolean;
  accessIssue: string | null;
  mfaRequired: boolean;
  mfaVerified: boolean;
  refreshMfaStatus: (force?: boolean) => Promise<void>;
  ensureFreshSession: () => Promise<Session | null>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    requestedRole: RequestedRole,
  ) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
const MFA_STATUS_REFRESH_INTERVAL_MS = 30 * 1000;
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
const LAST_ROLE_STORAGE_KEY = 'auth:last-role';
const LAST_ACTIVITY_STORAGE_KEY = 'auth:last-activity-at';
const REMOTE_SIGN_OUT_STORAGE_KEY = 'auth:force-signout';
const VISIBILITY_SIGN_OUT_BYPASS_STORAGE_KEY = 'auth:visibility-signout-bypass-until';
const SHOULD_LOG_AUTH = import.meta.env.DEV;
const AUTH_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';

function isVisibilitySignOutBypassed() {
  const rawValue = globalThis.sessionStorage?.getItem(VISIBILITY_SIGN_OUT_BYPASS_STORAGE_KEY);
  if (!rawValue) {
    return false;
  }

  const expiresAt = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    globalThis.sessionStorage?.removeItem(VISIBILITY_SIGN_OUT_BYPASS_STORAGE_KEY);
    return false;
  }

  return true;
}

function normalizeAppRole(role: string | null | undefined): AppRole | null {
  const normalizedRole = role?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? null;

  switch (normalizedRole) {
    case 'ceo':
    case 'chief_executive_officer':
    case 'superadmin':
    case 'super_admin':
      return 'super_admin';
    case 'admin':
    case 'it':
    case 'it_admin':
    case 'itmanager':
    case 'it_manager':
    case 'information_technology_manager':
      return 'admin';
    case 'staff':
      return 'staff';
    case 'investmentmanager':
    case 'investment_manager':
    case 'investment_mgr':
      return 'investment_manager';
    case 'accountant':
    case 'company_accountant':
      return 'accountant';
    case 'gm':
    case 'generalmanager':
    case 'general_manager':
    case 'general_mgr':
      return 'general_manager';
    case 'softwareengineer':
    case 'software_engineer':
      return 'software_engineer';
    default:
      return null;
  }
}

function formatRoleLabel(role: AppRole): string {
  switch (role) {
    case 'super_admin':
      return 'CEO';
    case 'general_manager':
      return 'General Manager';
    case 'investment_manager':
      return 'Investment Manager';
    case 'accountant':
      return 'Accountant';
    case 'admin':
      return 'IT Manager';
    case 'staff':
      return 'Staff';
    case 'software_engineer':
      return 'Software Engineer';
  }
}

function mapRequestedRoleToAppRole(requestedRole: RequestedRole): AppRole {
  switch (requestedRole) {
    case 'ceo':
      return 'super_admin';
    case 'general_manager':
      return 'general_manager';
    case 'investment_manager':
      return 'investment_manager';
    case 'accountant':
      return 'accountant';
    case 'it_manager':
      return 'admin';
  }
}

async function postAuthAccess<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${AUTH_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as (T & { message?: string }) | null;

  if (!response.ok || !payload) {
    throw new Error(payload?.message ?? 'Access verification is temporarily unavailable.');
  }

  return payload;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(() => {
    const storedRole = globalThis.localStorage?.getItem(LAST_ROLE_STORAGE_KEY);
    return normalizeAppRole(storedRole);
  });
  const [loading, setLoading] = useState(true);
  const signupEnabled = true;
  const [emailVerified, setEmailVerified] = useState(false);
  const [accessIssue, setAccessIssue] = useState<string | null>(null);
  const [mfaVerified, setMfaVerified] = useState(false);
  const inactivityTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const visibilitySignOutInProgressRef = useRef(false);
  const lastMfaRefreshAtRef = useRef(0);
  const refreshSessionPromiseRef = useRef<Promise<Session | null> | null>(null);
  const lastValidatedAccessTokenRef = useRef<string | null>(null);
  const approvedEmailRef = useRef<string | null>(null);

  const logAuth = useCallback((message: string, details?: Record<string, unknown>) => {
    if (!SHOULD_LOG_AUTH) {
      return;
    }

    if (details) {
      console.info(`[Auth] ${message}`, details);
      return;
    }

    console.info(`[Auth] ${message}`);
  }, []);

  const requiresMfaForRole = (nextRole: AppRole | null) =>
    nextRole === 'investment_manager' || nextRole === 'accountant' || nextRole === 'general_manager' || nextRole === 'super_admin';

  const refreshMfaStatus = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastMfaRefreshAtRef.current < MFA_STATUS_REFRESH_INTERVAL_MS) {
      return;
    }

    try {
      lastMfaRefreshAtRef.current = now;
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) {
        if (error.message?.toLowerCase().includes('rate limit')) {
          logAuth('MFA level check rate-limited; keeping previous MFA state');
          return;
        }
        console.error('[Auth] MFA level check failed:', error);
        setMfaVerified(false);
        return;
      }

      setMfaVerified(data.currentLevel === 'aal2' || data.nextLevel === 'aal2');
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('rate limit')) {
        logAuth('MFA lookup rate-limited; keeping previous MFA state');
        return;
      }
      console.error('[Auth] MFA lookup failed:', error);
      setMfaVerified(false);
    }
  }, [logAuth]);

  const ensureFreshSession = useCallback(async () => {
    if (refreshSessionPromiseRef.current) {
      return refreshSessionPromiseRef.current;
    }

    const refreshTask = (async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }

      const currentSession = sessionData.session;

      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
      }

      return currentSession;
    })();

    refreshSessionPromiseRef.current = refreshTask;

    try {
      return await refreshTask;
    } finally {
      refreshSessionPromiseRef.current = null;
    }
  }, []);

  const isAllowedAuthEmail = useCallback(async (email?: string | null): Promise<boolean | null> => {
    if (!email) {
      return false;
    }

    try {
      const result = await postAuthAccess<{ allowed: boolean }>('/auth/access/approved-email', {
        email: email.trim().toLowerCase(),
      });
      return result.allowed;
    } catch (error) {
      console.error('[Auth] allowlist lookup failed:', error);
      return null;
    }
  }, []);

  const getAllowedAuthUser = useCallback(async (email?: string | null): Promise<AllowedAuthUser | null> => {
    if (!email) {
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const result = await postAuthAccess<{ user: AllowedAuthUser | null }>('/auth/access/approved-user', {
      email: normalizedEmail,
    });

    if (!result.user) {
      return null;
    }

    return {
      email: result.user.email?.trim().toLowerCase() ?? normalizedEmail,
      role: normalizeAppRole(result.user.role),
      full_name: result.user.full_name ?? null,
      is_active: result.user.is_active ?? true,
    };
  }, []);

  const clearAuthState = useCallback(() => {
    setSession(null);
    setUser(null);
    setRole(null);
    setEmailVerified(false);
    setMfaVerified(false);
    approvedEmailRef.current = null;
    globalThis.localStorage?.removeItem(LAST_ROLE_STORAGE_KEY);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      clearAuthState();
      visibilitySignOutInProgressRef.current = false;
    } catch (error) {
      console.error('Error signing out:', error);
      visibilitySignOutInProgressRef.current = false;
    }
  }, [clearAuthState]);

  const fetchRole = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch(`${AUTH_API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => null) as { role?: string; message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? 'Could not load your access role.');

      const normalizedRole = normalizeAppRole(data?.role);

      if (normalizedRole) {
        setRole(normalizedRole);
        globalThis.localStorage?.setItem(LAST_ROLE_STORAGE_KEY, normalizedRole);
        logAuth('Role restored', { role: normalizedRole });
      } else {
        console.warn('[AuthContext] No role found for user. Access will remain limited until a role exists in the database.');
        setRole(null);
        setMfaVerified(false);
        globalThis.localStorage?.removeItem(LAST_ROLE_STORAGE_KEY);
      }
    } catch (error) {
      console.error('[Auth] Role fetch failed:', error);
      const authLikeError = error as { status?: number; message?: string; code?: string };

      if (
        authLikeError?.status === 401
        || authLikeError?.message?.includes('Invalid JWT')
        || authLikeError?.code === 'PGRST401'
      ) {
        logAuth('Received 401 while fetching role; waiting for auth state recovery');
      }
      setRole(null);
      setMfaVerified(false);
      globalThis.localStorage?.removeItem(LAST_ROLE_STORAGE_KEY);
    }
  }, [logAuth]);

  const validateAllowedSession = useCallback(async (nextSession: Session | null) => {
    if (!nextSession?.user) {
      clearAuthState();
      return;
    }

    setSession(nextSession);
    setUser(nextSession.user);
    setEmailVerified(Boolean(nextSession.user.email_confirmed_at));

    if (nextSession.access_token && lastValidatedAccessTokenRef.current === nextSession.access_token) {
      return;
    }

    const isEmailVerified = Boolean(nextSession.user.email_confirmed_at);
    if (!isEmailVerified) {
      console.warn('[AuthContext] User email is not verified. Signing out to enforce verification.');
      setEmailVerified(false);
      setAccessIssue('Please verify your email address before accessing the dashboard.');
      return;
    }
    setAccessIssue(null);
    setEmailVerified(true);

    const normalizedEmail = nextSession.user.email?.trim().toLowerCase() ?? null;
    if (normalizedEmail && approvedEmailRef.current === normalizedEmail) {
      setAccessIssue(null);
      setSession(nextSession);
      setUser(nextSession.user);
      lastValidatedAccessTokenRef.current = nextSession.access_token ?? null;
      await fetchRole(nextSession.access_token).catch((err) => console.error('Failed to fetch role:', err));
      return;
    }

    const isAllowed = await isAllowedAuthEmail(normalizedEmail);
    if (isAllowed === false) {
      console.warn('[AuthContext] Session user is not on approved allowlist. Keeping session active and flagging access issue.');
      setAccessIssue('Your account is not approved to access this system.');
      return;
    }

    if (isAllowed === null) {
      console.warn('[AuthContext] Allowlist check is temporarily unavailable. Keeping current session and retrying later.');
      lastValidatedAccessTokenRef.current = nextSession.access_token ?? null;
      return;
    }

    setAccessIssue(null);
    approvedEmailRef.current = normalizedEmail;
    lastValidatedAccessTokenRef.current = nextSession.access_token ?? null;
    await fetchRole(nextSession.access_token).catch((err) => console.error('Failed to fetch role:', err));
  }, [clearAuthState, fetchRole, isAllowedAuthEmail]);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      globalThis.clearTimeout(inactivityTimeoutRef.current);
    }

    if (!session) {
      inactivityTimeoutRef.current = null;
      return;
    }

    inactivityTimeoutRef.current = globalThis.setTimeout(() => {
      console.warn('[AuthContext] Session expired due to inactivity. Signing out user.');
      globalThis.localStorage?.setItem(REMOTE_SIGN_OUT_STORAGE_KEY, new Date().toISOString());
      void signOut();
    }, INACTIVITY_TIMEOUT_MS);
  }, [session, signOut]);

  useEffect(() => {
    const authLoadFallback = globalThis.setTimeout(() => {
      console.warn('[AuthContext] Auth initialization timed out; continuing with fallback state.');
      setLoading(false);
    }, 2500);

    const initializeAuth = async () => {
      try {
        logAuth('Initializing auth state');
        // Get current session from storage
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error('[Auth] getSession error:', sessionError);
        }

        if (currentSession) {
          logAuth('Recovered stored session', {
            userId: currentSession.user.id,
            hasAccessToken: Boolean(currentSession.access_token),
          });
          setSession(currentSession);
          setUser(currentSession.user);
          setEmailVerified(Boolean(currentSession.user.email_confirmed_at));
          void validateAllowedSession(currentSession).catch((err) => console.error('Failed to validate current session:', err));
        } else {
          logAuth('No stored session found during initialization');
          clearAuthState();
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        setSession(null);
        setUser(null);
        setRole(null);
        setMfaVerified(false);
      } finally {
        globalThis.clearTimeout(authLoadFallback);
        setLoading(false);
      }
    };

    initializeAuth();

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (isSignedOutEvent(event)) {
          logAuth('Auth state changed', { event, sessionExists: false });
          lastValidatedAccessTokenRef.current = null;
          clearAuthState();
        } else if (event === 'TOKEN_REFRESHED') {
          logAuth('Auth token refreshed', {
            sessionExists: Boolean(session),
            userId: session?.user?.id ?? null,
          });
          if (session) {
            setSession(session);
            setUser(session.user);
            setEmailVerified(Boolean(session.user.email_confirmed_at));
            lastValidatedAccessTokenRef.current = session.access_token ?? null;
          }
        } else if (session?.user) {
          logAuth('Auth state changed', {
            event,
            sessionExists: true,
            userId: session.user.id,
          });
          setSession(session);
          setUser(session.user);
          setEmailVerified(Boolean(session.user.email_confirmed_at));
          void validateAllowedSession(session).catch((err) => console.error('Failed to validate updated session:', err));
        }
        
        setLoading(false);
      }
    );

    return () => {
      globalThis.clearTimeout(authLoadFallback);
      subscription.unsubscribe();
    };
  }, [clearAuthState, fetchRole, isAllowedAuthEmail, logAuth, validateAllowedSession]);

  useEffect(() => {
    resetInactivityTimer();

    if (!session) {
      return () => {
        if (inactivityTimeoutRef.current) {
          globalThis.clearTimeout(inactivityTimeoutRef.current);
        }
      };
    }

    const handleActivity = () => {
      globalThis.localStorage?.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
      resetInactivityTimer();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      globalThis.addEventListener(eventName, handleActivity, { passive: true });
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isVisibilitySignOutBypassed()) {
        return;
      }

      if (document.visibilityState === 'hidden' && session && !visibilitySignOutInProgressRef.current) {
        visibilitySignOutInProgressRef.current = true;
        globalThis.localStorage?.setItem(REMOTE_SIGN_OUT_STORAGE_KEY, new Date().toISOString());
        void signOut();
        return;
      }

      if (document.visibilityState === 'visible') {
        resetInactivityTimer();
      }
    };

    const handlePageHide = () => {
      if (isVisibilitySignOutBypassed()) {
        return;
      }

      if (!session || visibilitySignOutInProgressRef.current) {
        return;
      }

      visibilitySignOutInProgressRef.current = true;
      globalThis.localStorage?.setItem(REMOTE_SIGN_OUT_STORAGE_KEY, new Date().toISOString());
      void signOut();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    globalThis.addEventListener('pagehide', handlePageHide);

    return () => {
      if (inactivityTimeoutRef.current) {
        globalThis.clearTimeout(inactivityTimeoutRef.current);
      }

      for (const eventName of ACTIVITY_EVENTS) {
        globalThis.removeEventListener(eventName, handleActivity);
      }

      document.removeEventListener('visibilitychange', handleVisibilityChange);
      globalThis.removeEventListener('pagehide', handlePageHide);
    };
  }, [resetInactivityTimer, session]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_STORAGE_KEY && session) {
        resetInactivityTimer();
      }

      if (event.key === REMOTE_SIGN_OUT_STORAGE_KEY && event.newValue && session) {
        void signOut();
      }
    };

    globalThis.addEventListener('storage', handleStorage);

    return () => {
      globalThis.removeEventListener('storage', handleStorage);
    };
  }, [resetInactivityTimer, session, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setAccessIssue(null);
      const normalizedEmail = email.trim().toLowerCase();
      const isAllowed = await isAllowedAuthEmail(normalizedEmail);

      if (isAllowed === null) {
        return {
          error: {
            name: 'AuthApiError',
            message: 'We could not verify your access right now. Please try again shortly.',
            status: 503,
          } as AuthError,
        };
      }

      if (isAllowed === false) {
        return {
          error: {
            name: 'AuthApiError',
            message: 'Your account is not approved to access this system.',
            status: 403,
          } as AuthError,
        };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (!error && data.user && !data.user.email_confirmed_at) {
        clearAuthState();
        return {
          error: {
            name: 'AuthApiError',
            message: 'Please verify your email address before accessing the dashboard.',
            status: 403,
          } as AuthError,
        };
      }

      if (!error && data.session && data.user) {
        setSession(data.session);
        setUser(data.user);
        setEmailVerified(Boolean(data.user.email_confirmed_at));
        void validateAllowedSession(data.session).catch((validationError) => {
          console.error('Failed to validate signed-in session:', validationError);
        });
      }

      return { error };
    } catch (err) {
      return { error: err as AuthError };
    }
  }, [isAllowedAuthEmail, validateAllowedSession]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    requestedRole: RequestedRole,
  ) => {
    try {
      setAccessIssue(null);
      const normalizedEmail = email.trim().toLowerCase();
      let allowedUser: AllowedAuthUser | null = null;

      try {
        allowedUser = await getAllowedAuthUser(normalizedEmail);
      } catch (allowlistError) {
        console.error('[Auth] allowlist signup lookup failed:', allowlistError);
        return {
          error: {
            name: 'AuthApiError',
            message: 'We could not verify your access right now. Please try again shortly.',
            status: 503,
          } as AuthError,
        };
      }

      if (!allowedUser) {
        return {
          error: {
            name: 'AuthApiError',
            message: 'This email address is not approved for internal access.',
            status: 403,
          } as AuthError,
        };
      }

      const expectedRole = mapRequestedRoleToAppRole(requestedRole);

      if (!allowedUser.role) {
        return {
          error: {
            name: 'AuthApiError',
            message: 'This approved email does not have a usable role assigned yet. Update the approved-users table and try again.',
            status: 500,
          } as AuthError,
        };
      }

      if (allowedUser.role !== expectedRole) {
        return {
          error: {
            name: 'AuthApiError',
            message: `This email is approved for ${formatRoleLabel(allowedUser.role)}, not ${formatRoleLabel(expectedRole)}.`,
            status: 403,
          } as AuthError,
        };
      }

      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${globalThis.location.origin}/login`,
          data: {
            full_name: fullName || allowedUser.full_name || undefined,
            requested_role: requestedRole,
          },
        },
      });

      return { error };
    } catch (err) {
      return { error: err as AuthError };
    }
  }, [getAllowedAuthUser]);

  const mfaRequired = requiresMfaForRole(role);

  const value = useMemo(
    () => ({ session, user, role, loading, signupEnabled, emailVerified, accessIssue, mfaRequired, mfaVerified, refreshMfaStatus, ensureFreshSession, signIn, signUp, signOut }),
    [session, user, role, loading, signupEnabled, emailVerified, accessIssue, mfaRequired, mfaVerified, refreshMfaStatus, ensureFreshSession, signIn, signUp, signOut]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function isSignedOutEvent(event: AuthChangeEvent) {
  return event === 'SIGNED_OUT';
}
