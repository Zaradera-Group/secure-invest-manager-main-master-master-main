import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { User, Mail, Phone, MapPin, LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export default function Profile() {
  const { provider, user, role, signOut, mfaRequired, mfaVerified, refreshMfaStatus, ensureFreshSession } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');

  useEffect(() => {
    let cancelled = false;

    const syncMfaStatus = async () => {
      if (provider === 'auth0') {
        return;
      }

      try {
        const activeSession = await ensureFreshSession();
        if (!activeSession || cancelled) {
          return;
        }

        await supabase.auth.getUser();
        if (!cancelled) {
          await refreshMfaStatus(true);
        }
      } catch (error) {
        console.error('[Profile] Failed to sync MFA status:', error);
      }
    };

    void syncMfaStatus();

    return () => {
      cancelled = true;
    };
  }, [ensureFreshSession, provider, refreshMfaStatus]);

  const getInitials = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.charAt(0).toUpperCase() || 'U';
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
      toast({
        title: 'Signed out',
        description: 'You have been successfully signed out.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to sign out. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startMfaSetup = async () => {
    setMfaLoading(true);
    try {
      const { data, error } = await runMfaWithFreshSession(async () => supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `${role ?? 'user'} authenticator`,
      }), ensureFreshSession);

      if (error) {
        throw error;
      }

      setFactorId(data.id);
      setQrCodeSvg(data.totp.qr_code);
      toast({
        title: 'MFA enrollment started',
        description: 'Scan the QR code with your authenticator app and enter the 6-digit code below.',
      });
    } catch (error) {
      toast({
        title: 'MFA setup failed',
        description: error instanceof Error ? error.message : 'Could not start MFA setup.',
        variant: 'destructive',
      });
    } finally {
      setMfaLoading(false);
    }
  };

  const verifyMfaSetup = async () => {
    if (!factorId || !verifyCode.trim()) {
      return;
    }

    setMfaLoading(true);
    try {
      const { data: challengeData, error: challengeError } = await runMfaWithFreshSession(async () => supabase.auth.mfa.challenge({
        factorId,
      }), ensureFreshSession);

      if (challengeError) {
        throw challengeError;
      }

      const { error: verifyError } = await runMfaWithFreshSession(async () => supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verifyCode.trim(),
      }), ensureFreshSession);

      if (verifyError) {
        throw verifyError;
      }

      await refreshMfaStatus(true);
      setVerifyCode('');
      setFactorId(null);
      setQrCodeSvg(null);
      toast({
        title: 'MFA enabled',
        description: 'Your account now has multi-factor authentication enabled.',
      });
    } catch (error) {
      toast({
        title: 'MFA verification failed',
        description: error instanceof Error ? error.message : 'Invalid authentication code.',
        variant: 'destructive',
      });
    } finally {
      setMfaLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your account information</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      </div>

      {/* Profile Overview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar and Basic Info */}
          <div className="flex items-start gap-6">
            <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-semibold">
              {getInitials()}
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Full Name</p>
                <p className="text-lg font-semibold">{user?.user_metadata?.full_name || 'Not provided'}</p>
              </div>
              {role && (
                <div>
                  <p className="text-sm text-muted-foreground">Role</p>
                  <Badge className="mt-1">{role}</Badge>
                </div>
              )}
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Contact Information
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Email Address</label>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                  <p className="text-sm font-medium">{user?.email || 'Not provided'}</p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Phone Number</label>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                  <p className="text-sm font-medium text-muted-foreground">
                    {user?.user_metadata?.phone || 'Not provided'}
                  </p>
                </div>
              </div>
            </div>
          </div>

      {/* Account Info */}
      <div className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <User className="w-4 h-4" />
              Account Information
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Account Status</label>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                  <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                    Active
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Member Since</label>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                  <p className="text-sm font-medium">
                    {user?.created_at
                      ? new Date(user.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                      : 'Not available'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {mfaRequired && !mfaVerified && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Multi-factor authentication is required for your role before you can access protected dashboards and approval actions.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Multi-Factor Authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium">Authenticator App</p>
              <p className="text-sm text-muted-foreground">
                {provider === 'auth0'
                  ? 'MFA is managed by Auth0 during sign-in.'
                  : mfaVerified ? 'MFA is enabled for this account.' : 'Set up TOTP MFA using Google Authenticator, Authy, or Microsoft Authenticator.'}
              </p>
            </div>
            <Badge variant={mfaVerified ? 'default' : 'secondary'}>
              {mfaVerified ? 'Enabled' : 'Not configured'}
            </Badge>
          </div>

          {provider === 'supabase' && !mfaVerified && !qrCodeSvg && (
            <Button onClick={() => void startMfaSetup()} disabled={mfaLoading}>
              {mfaLoading ? 'Preparing...' : 'Set Up MFA'}
            </Button>
          )}

          {provider === 'supabase' && qrCodeSvg && (
            <div className="space-y-4">
              <div
                className="w-fit rounded-lg border bg-white p-4"
                dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
              />
              <div className="space-y-2 max-w-xs">
                <label className="text-sm text-muted-foreground">6-digit code</label>
                <Input
                  value={verifyCode}
                  onChange={(event) => setVerifyCode(event.target.value)}
                  placeholder="123456"
                  maxLength={6}
                />
              </div>
              <Button onClick={() => void verifyMfaSetup()} disabled={mfaLoading || verifyCode.trim().length < 6}>
                {mfaLoading ? 'Verifying...' : 'Verify and Enable MFA'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User ID (for reference) */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Additional Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">User ID</label>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border font-mono text-xs break-all">
              {user?.id || 'Not available'}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Last Sign In</label>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border text-sm">
              {user?.last_sign_in_at
                ? new Date(user.last_sign_in_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                : 'Not available'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sign Out */}
      <Card className="glass-card border-red-500/20 bg-red-500/5">
        <CardHeader>
          <CardTitle className="text-lg text-red-600 dark:text-red-400">Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sign out of your account. You will be redirected to the login page.
          </p>
          <Button
            onClick={handleSignOut}
            disabled={isLoading}
            variant="destructive"
            className="gap-2"
          >
            <LogOut className="w-4 h-4" />
            {isLoading ? 'Signing out...' : 'Sign Out'}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

async function runMfaWithFreshSession<T>(
  operation: () => Promise<T>,
  ensureFreshSession: () => Promise<unknown>,
) {
  let activeSession = await ensureFreshSession();
  if (!activeSession) {
    throw new Error('Your session has expired. Please sign in again before continuing with MFA.');
  }

  let result = await operation();

  if (hasAuthSessionMissingError(result)) {
    activeSession = await ensureFreshSession();
    if (!activeSession) {
      throw new Error('Your session has expired. Please sign in again before continuing with MFA.');
    }

    result = await operation();
  }

  return result;
}

function hasAuthSessionMissingError(result: unknown) {
  if (!result || typeof result !== 'object' || !('error' in result)) {
    return false;
  }

  const possibleError = (result as { error?: { message?: string } }).error;
  return Boolean(possibleError?.message?.toLowerCase().includes('auth session missing'));
}
