import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getDefaultDashboardPath } from '@/lib/authRoutes';

type MathChallenge = {
  left: number;
  right: number;
  operator: '+' | '-' | '×';
  answer: number;
};

function createMathChallenge(): MathChallenge {
  const operators: MathChallenge['operator'][] = ['+', '-', '×'];
  const operator = operators[Math.floor(Math.random() * operators.length)];

  if (operator === '×') {
    const left = Math.floor(Math.random() * 9) + 2;
    const right = Math.floor(Math.random() * 9) + 2;
    return { left, right, operator, answer: left * right };
  }

  if (operator === '-') {
    const left = Math.floor(Math.random() * 40) + 20;
    const right = Math.floor(Math.random() * 20) + 1;
    return {
      left,
      right: Math.min(right, left),
      operator,
      answer: left - Math.min(right, left),
    };
  }

  const left = Math.floor(Math.random() * 40) + 1;
  const right = Math.floor(Math.random() * 40) + 1;
  return { left, right, operator, answer: left + right };
}

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>(() => getLoginModeFromLocation());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [requestedRole, setRequestedRole] = useState<'ceo' | 'general_manager' | 'investment_manager' | 'it_manager'>('investment_manager');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<string | null>(null);
  const [mathChallenge, setMathChallenge] = useState<MathChallenge>(() => createMathChallenge());
  const [mathAnswer, setMathAnswer] = useState('');
  const { signIn, signUp, role, accessIssue, signupEnabled } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const authApiUrl = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const humanVerificationEnabled = Boolean(turnstileSiteKey);
  const mathChallengeEnabled = import.meta.env.VITE_MATH_CHALLENGE_ENABLED === 'true';
  const approvedAccessMessage = useMemo(
    () => 'Access is restricted to approved internal email addresses only.',
    [],
  );
  const isHumanVerificationPending = humanVerificationEnabled && !captchaToken;
  const isMathVerificationPending =
    mathChallengeEnabled && Number(mathAnswer.trim()) !== mathChallenge.answer;
  const isSubmitDisabled = loading || isHumanVerificationPending || isMathVerificationPending;

  const resetHumanVerification = () => {
    setCaptchaToken(null);
    setTurnstileStatus(null);
  };

  const handleModeChange = (nextMode: 'signin' | 'signup') => {
    const nextUrl = new URL(globalThis.location.href);
    nextUrl.pathname = '/login';
    nextUrl.searchParams.set('mode', nextMode);
    globalThis.location.assign(nextUrl.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mathChallengeEnabled && Number(mathAnswer.trim()) !== mathChallenge.answer) {
      toast({
        title: 'Verification required',
        description: 'Please solve the math challenge correctly before continuing.',
        variant: 'destructive',
      });
      setMathAnswer('');
      setMathChallenge(createMathChallenge());
      setLoading(false);
      return;
    }

    if (humanVerificationEnabled && !captchaToken) {
      const description = turnstileStatus
        ?? `Please complete the human verification challenge before ${mode === 'signin' ? 'signing in' : 'signing up'}.`;
      toast({
        title: 'Verification required',
        description,
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    if (humanVerificationEnabled) {
      try {
        const captchaResponse = await fetch(`${authApiUrl}/auth/verify-human`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: captchaToken }),
        });

        if (!captchaResponse.ok) {
          const data = await captchaResponse.json().catch(() => null);
          const description = deriveTurnstileServerMessage(captchaResponse.status, data);
          setTurnstileStatus(description);
          toast({
            title: 'Verification failed',
            description,
            variant: 'destructive',
          });
          setLoading(false);
          setCaptchaToken(null);
          return;
        }
      } catch (error) {
        const description = 'Verification backend is unavailable. Start the backend server and try again.';
        setTurnstileStatus(description);
        toast({
          title: 'Verification failed',
          description,
          variant: 'destructive',
        });
        setLoading(false);
        setCaptchaToken(null);
        return;
      }
    }

    const { error } = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password, fullName, requestedRole);

    if (error) {
      toast({
        title: mode === 'signin' ? 'Login failed' : 'Signup failed',
        description: error.message,
        variant: 'destructive',
      });
    } else if (mode === 'signin') {
      toast({
        title: 'Login successful',
        description: 'Welcome back. Redirecting you into the system now.',
      });
      navigate(getDefaultDashboardPath(role), { replace: true });
    } else if (mode === 'signup') {
      toast({
        title: 'Verification required',
        description: 'Your signup was accepted. Please verify your email before logging in.',
      });
      const nextUrl = new URL(globalThis.location.href);
      nextUrl.pathname = '/login';
      nextUrl.searchParams.set('mode', 'signin');
      globalThis.location.assign(nextUrl.toString());
      return;
    }

    setMathAnswer('');
    setMathChallenge(createMathChallenge());
    resetHumanVerification();
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ exit: { duration: 0.3 } }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex items-center justify-center gap-3">
          <img
            src="/assets/Zaradera_Logo_Path.png"
            alt="Zaradera Credit Limited logo"
            className="h-14 w-14 object-contain"
          />
          <div>
            <h1 className="font-heading font-bold text-lg text-primary">Zaradera</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">Credit Limited</p>
          </div>
        </div>

        <Card className="glass-card">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-2 flex rounded-full bg-secondary p-1">
              <button
                type="button"
                onClick={() => handleModeChange('signin')}
                className={`rounded-full px-4 py-1.5 text-sm transition ${mode === 'signin' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                Sign In
              </button>
              {signupEnabled && (
                <button
                  type="button"
                  onClick={() => handleModeChange('signup')}
                  className={`rounded-full px-4 py-1.5 text-sm transition ${mode === 'signup' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                >
                  Sign Up
                </button>
              )}
            </div>
            <CardTitle className="font-heading text-xl">{mode === 'signin' ? 'Welcome Back' : 'Create Approved Account'}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === 'signin' ? 'Sign in to your account' : 'Only approved internal email addresses can create accounts'}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="requestedRole">Approved Role</Label>
                    <select
                      id="requestedRole"
                      value={requestedRole}
                      onChange={(e) => setRequestedRole(e.target.value as typeof requestedRole)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="investment_manager">Investment Manager</option>
                      <option value="general_manager">General Manager</option>
                      <option value="ceo">CEO</option>
                      <option value="it_manager">IT Manager</option>
                    </select>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {mathChallengeEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="mathChallenge">Quick Security Check</Label>
                  <div className="rounded-lg border border-input bg-secondary/20 p-3 text-sm">
                    Solve: {mathChallenge.left} {mathChallenge.operator} {mathChallenge.right}
                  </div>
                  <Input
                    id="mathChallenge"
                    inputMode="numeric"
                    value={mathAnswer}
                    onChange={(e) => setMathAnswer(e.target.value)}
                    placeholder="Enter your answer"
                    required={mathChallengeEnabled}
                  />
                  {isMathVerificationPending && (
                    <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
                      Solve the math problem correctly before {mode === 'signin' ? 'signing in' : 'creating your account'}.
                    </div>
                  )}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitDisabled}
              >
                {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
              </Button>
              <div className="space-y-2">
                <Label>Human Verification</Label>
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  onToken={setCaptchaToken}
                  onStatusChange={setTurnstileStatus}
                />
                {turnstileStatus && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    {turnstileStatus}
                  </div>
                )}
                {isHumanVerificationPending && (
                  <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
                    Complete the human verification before {mode === 'signin' ? 'signing in' : 'creating your account'}.
                  </div>
                )}
              </div>
              <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-700 dark:text-blue-400">
                <p className="font-medium mb-1">Restricted Access</p>
                <p className="text-xs">
                  {mode === 'signin'
                    ? approvedAccessMessage
                    : 'Signup is invite-only. Your email must already be approved and your role must match the internal allowlist.'}
                </p>
              </div>
              {accessIssue && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <p className="font-medium mb-1">Access Check</p>
                  <p className="text-xs">{accessIssue}</p>
                </div>
              )}
            </form>
            <div className="mt-3 text-center">
              <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Back to home</Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function deriveTurnstileServerMessage(
  status: number,
  data: { message?: string; errors?: string[] } | null,
) {
  if (status === 503) {
    if (data?.message?.toLowerCase().includes('temporarily unavailable')) {
      return 'Cloudflare verification timed out or is temporarily unreachable. Please try again shortly.';
    }

    return data?.message ?? 'Verification backend is unavailable.';
  }

  if (status === 403) {
    if (data?.errors?.includes('110200')) {
      return 'Cloudflare rejected this hostname. Add your current domain or localhost in Turnstile hostname settings.';
    }

    return data?.message ?? 'Human verification failed. Please complete the challenge again.';
  }

  if (status === 400) {
    return data?.message ?? 'Human verification token is missing or expired. Please complete the challenge again.';
  }

  return data?.message ?? 'Human verification failed. Please try again.';
}

function getLoginModeFromLocation(): 'signin' | 'signup' {
  const searchParams = new URLSearchParams(globalThis.location.search);
  return searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
}
