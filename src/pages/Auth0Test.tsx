import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth0TestConfig, isAuth0TestConfigured, staffAuth0Roles } from '@/lib/auth0Test';

export default function Auth0Test() {
  if (!isAuth0TestConfigured) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <section className="w-full max-w-xl border border-border bg-card p-7 shadow-sm">
          <h1 className="font-heading text-xl font-bold text-foreground">Auth0 test path is unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This route is intentionally disabled until the Auth0 test environment variables are configured.
            The live Zaradera login is unchanged.
          </p>
        </section>
      </main>
    );
  }

  return <Auth0TestSession />;
}

function Auth0TestSession() {
  const { error, getAccessTokenSilently, isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0();
  const [renderIdentity, setRenderIdentity] = useState<RenderIdentity | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isCheckingRender, setIsCheckingRender] = useState(false);
  const roles = getRoles(user?.[auth0TestConfig.rolesClaim]);
  const isStaff = roles.some((role) => staffAuth0Roles.has(role));
  const apiUrl = import.meta.env.VITE_CERTIFICATE_API_URL?.trim().replace(/\/+$/, '');

  const validateRenderIdentity = async () => {
    if (!apiUrl || !auth0TestConfig.audience) {
      setRenderError('Render API URL or Auth0 audience is not configured for this deployment.');
      return;
    }

    setIsCheckingRender(true);
    setRenderError(null);

    try {
      const token = await getAccessTokenSilently({
        authorizationParams: { audience: auth0TestConfig.audience },
      });
      const response = await fetch(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as RenderIdentity | { message?: string } | null;

      if (!response.ok || !payload || !('provider' in payload)) {
        throw new Error(payload && 'message' in payload ? payload.message ?? 'Render rejected the Auth0 token.' : 'Render rejected the Auth0 token.');
      }

      setRenderIdentity(payload);
    } catch (validationError) {
      setRenderIdentity(null);
      setRenderError(validationError instanceof Error ? validationError.message : 'Unable to validate the Auth0 token with Render.');
    } finally {
      setIsCheckingRender(false);
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-xl border border-border bg-card p-7 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center bg-primary text-primary-foreground">
            <ShieldCheck aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-accent">Zaradera Vest</p>
            <h1 className="font-heading text-xl font-bold text-foreground">Auth0 staff authentication test</h1>
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          This isolated route confirms Auth0 email verification, role claims, and MFA without granting access to
          live investor or certificate data.
        </p>

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Checking the Auth0 test session...</p>}

        {!isLoading && !isAuthenticated && (
          <Button
            className="mt-6"
            onClick={() => void loginWithRedirect({
              appState: { returnTo: '/auth0-test' },
              authorizationParams: {
                redirect_uri: auth0TestConfig.redirectUri,
                ...(auth0TestConfig.audience ? { audience: auth0TestConfig.audience } : {}),
              },
            })}
          >
            <LogIn aria-hidden="true" />
            Sign in with Auth0 test account
          </Button>
        )}

        {!isLoading && isAuthenticated && (
          <div className="mt-6 space-y-4">
            <div className="border border-border bg-secondary/40 p-4 text-sm">
              <p><strong>Signed in:</strong> {user?.email ?? 'Email unavailable'}</p>
              <p className="mt-2"><strong>Email verified:</strong> {user?.email_verified ? 'Yes' : 'No'}</p>
              <p className="mt-2"><strong>Auth0 roles:</strong> {roles.length ? roles.join(', ') : 'No role claim received'}</p>
              <p className="mt-2"><strong>Staff access claim:</strong> {isStaff ? 'Recognized' : 'Not recognized'}</p>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              A successful sign-in confirms authentication only. This test route cannot access live workflow data.
            </p>
            <Button variant="outline" disabled={isCheckingRender} onClick={() => void validateRenderIdentity()}>
              <ShieldCheck aria-hidden="true" />
              {isCheckingRender ? 'Validating with Render...' : 'Validate Render identity'}
            </Button>
            {renderIdentity && (
              <p className="border border-border bg-secondary/40 p-4 text-sm">
                Render accepted this {renderIdentity.provider} identity as <strong>{renderIdentity.role}</strong>.
              </p>
            )}
            {renderError && <p className="text-sm text-destructive">Render validation failed: {renderError}</p>}
            <Button variant="outline" onClick={() => void logout({ logoutParams: { returnTo: auth0TestConfig.redirectUri } })}>
              <LogOut aria-hidden="true" />
              Sign out of Auth0 test
            </Button>
          </div>
        )}

        {error && <p className="mt-5 text-sm text-destructive">Auth0 test failed: {error.message}</p>}
      </section>
    </main>
  );
}

type RenderIdentity = {
  id: string;
  email: string | null;
  role: string;
  provider: 'auth0' | 'supabase';
  permissions: string[];
};

function getRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((role): role is string => typeof role === 'string').map((role) => role.toLowerCase());
}
