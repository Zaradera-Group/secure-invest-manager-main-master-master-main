import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Link as LinkIcon, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useToast } from '@/hooks/use-toast';

function getCertificateApiUrl() {
  const configuredUrl = import.meta.env.VITE_CERTIFICATE_API_URL?.trim().replace(/^['"]|['"]$/g, '');
  if (configuredUrl) {
    const normalized = configuredUrl.replace(/\/$/, '');

    if (!import.meta.env.DEV && normalized.startsWith('http://')) {
      throw new Error('Public intake API must use HTTPS in production. Set VITE_CERTIFICATE_API_URL to your Render https URL, not http.');
    }

    return normalized;
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:4000';
  }

  throw new Error('Public intake API URL is not configured. Set VITE_CERTIFICATE_API_URL in Netlify to your Render backend URL.');
}
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const INVESTMENT_TYPES = ['Upfront', 'Monthly', 'Quarterly', 'At Maturity'] as const;
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'] as const;
const NEXT_OF_KIN_RELATIONSHIPS = [
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'Uncle',
  'Auntie',
  'Spouse',
  'Child',
  'Cousin',
  'Friend',
  'Other',
] as const;
const PUBLIC_INTAKE_DRAFT_KEY = 'public-intake:draft';
const PUBLIC_INTAKE_SUBMISSION_KEY = 'public-intake:submission';
const PUBLIC_INTAKE_SUCCESS_DURATION_MS = 30_000;

const INITIAL_FORM = {
  name: '',
  email: '',
  phone: '',
  investmentAmount: '',
  startDate: '',
  tenure: '',
  investmentType: 'Monthly',
  clientAccountNumber: '',
  clientBank: '',
  dateOfBirth: '',
  gender: '',
  occupation: '',
  sourceOfFunds: '',
  address: '',
  nextOfKinName: '',
  nextOfKinPhone: '',
  nextOfKinRelationship: '',
  currencyCode: 'NGN',
  website: '',
};

type SubmissionSnapshot = {
  submittedAt: number;
};

export default function PublicInvestorIntake() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionTimedOut, setSubmissionTimedOut] = useState(false);
  const [submissionLink, setSubmissionLink] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<string | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [consentToken, setConsentToken] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<string | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);

  useEffect(() => {
    const submissionRaw = globalThis.sessionStorage?.getItem(PUBLIC_INTAKE_SUBMISSION_KEY);

    if (submissionRaw) {
      try {
        const parsed = JSON.parse(submissionRaw) as SubmissionSnapshot;
        const submittedAt = Number(parsed.submittedAt);
        if (Number.isFinite(submittedAt)) {
          setIsSubmitted(true);
          setSubmissionLink('/investor-intake');
          const elapsed = Date.now() - submittedAt;
          if (elapsed >= PUBLIC_INTAKE_SUCCESS_DURATION_MS) {
            setSubmissionTimedOut(true);
          } else {
            const timeoutId = window.setTimeout(() => {
              setSubmissionTimedOut(true);
            }, PUBLIC_INTAKE_SUCCESS_DURATION_MS - elapsed);

            return () => window.clearTimeout(timeoutId);
          }
          return;
        }
      } catch {
        globalThis.sessionStorage?.removeItem(PUBLIC_INTAKE_SUBMISSION_KEY);
      }
    }

    const draft = globalThis.sessionStorage?.getItem(PUBLIC_INTAKE_DRAFT_KEY);
    if (!draft) return;

    try {
      const parsed = JSON.parse(draft) as Partial<typeof INITIAL_FORM>;
      setForm((current) => ({ ...current, ...parsed }));
    } catch {
      globalThis.sessionStorage?.removeItem(PUBLIC_INTAKE_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (isSubmitted) {
      globalThis.sessionStorage?.removeItem(PUBLIC_INTAKE_DRAFT_KEY);
      return;
    }

    globalThis.sessionStorage?.setItem(PUBLIC_INTAKE_DRAFT_KEY, JSON.stringify(form));
  }, [form, isSubmitted]);

  useEffect(() => {
    if (!isSubmitted) {
      setSubmissionTimedOut(false);
      return;
    }

    setSubmissionTimedOut(false);
    const timeoutId = window.setTimeout(() => {
      setSubmissionTimedOut(true);
    }, 30_000);

    return () => window.clearTimeout(timeoutId);
  }, [isSubmitted]);

  const handleChange = (field: string, value: string) => {
    if ((field === 'phone' || field === 'email') && value !== form[field]) {
      setOtpCode('');
      setOtpStatus(null);
      setIsPhoneVerified(false);
      setConsentToken(null);
    }

    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSendOtp = async () => {
    if (!form.phone.trim()) {
      setOtpStatus('Enter the phone number first.');
      return;
    }

    setIsSendingOtp(true);
    setOtpStatus(null);

    try {
      const response = await fetch(`${getCertificateApiUrl()}/public/investor-intake/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: form.phone,
          email: form.email,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message ?? 'Unable to send the verification code.');
      }

      setOtpStatus('Verification code sent to the email address entered.');
      toast({
        title: 'Code sent',
        description: 'The investor will receive the one-time code by email.',
      });
    } catch (error) {
      setOtpStatus(error instanceof Error ? error.message : 'Could not send the verification code.');
      toast({
        title: 'OTP failed',
        description: error instanceof Error ? error.message : 'Could not send the verification code.',
      });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!form.phone.trim()) {
      setOtpStatus('Enter the phone number first.');
      return;
    }

    if (otpCode.length < 4) {
      setOtpStatus('Enter the full verification code.');
      return;
    }

    setIsVerifyingOtp(true);
    setOtpStatus(null);

    try {
      const response = await fetch(`${getCertificateApiUrl()}/public/investor-intake/otp/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: form.phone,
          code: otpCode,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message ?? 'Unable to verify the code.');
      }

      setConsentToken(data?.consentToken ?? null);
      setIsPhoneVerified(true);
      setOtpStatus('Phone number verified. Consent has been captured.');
      toast({
        title: 'Verified',
        description: 'The investor phone number has been verified successfully.',
      });
    } catch (error) {
      setIsPhoneVerified(false);
      setConsentToken(null);
      setOtpStatus(error instanceof Error ? error.message : 'Could not verify the code.');
      toast({
        title: 'Verification failed',
        description: error instanceof Error ? error.message : 'Could not verify the code.',
      });
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (!isPhoneVerified || !consentToken) {
        throw new Error('Please verify the phone number to capture consent before submitting.');
      }

      if (!turnstileToken) {
        throw new Error('Please complete the human verification challenge before submitting.');
      }

      const response = await fetch(`${getCertificateApiUrl()}/public/investor-intake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...form,
          investmentAmount: Number(form.investmentAmount),
          tenure: Number(form.tenure),
          gender: form.gender || null,
          dateOfBirth: form.dateOfBirth || null,
          occupation: form.occupation || null,
          sourceOfFunds: form.sourceOfFunds || null,
          address: form.address || null,
          nextOfKinName: form.nextOfKinName || null,
          nextOfKinPhone: form.nextOfKinPhone || null,
          nextOfKinRelationship: form.nextOfKinRelationship || null,
          website: form.website || null,
          verifiedOtpCode: otpCode,
          consentToken,
          turnstileToken,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message ?? 'Unable to submit investor intake.');
      }

      setIsSubmitted(true);
      setSubmissionTimedOut(false);
      setSubmissionLink('/investor-intake');
      globalThis.sessionStorage?.removeItem(PUBLIC_INTAKE_DRAFT_KEY);
      globalThis.sessionStorage?.setItem(
        PUBLIC_INTAKE_SUBMISSION_KEY,
        JSON.stringify({ submittedAt: Date.now() } satisfies SubmissionSnapshot),
      );
      toast({
        title: 'Submission received',
        description: 'The details were queued for manual review.',
      });
    } catch (error) {
      toast({
        title: 'Submission failed',
        description: error instanceof Error ? error.message : 'Could not submit the intake form.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    const title = submissionTimedOut ? 'Submission timed out' : 'Submission successful';
    const description = submissionTimedOut
      ? 'This success screen has timed out after 30 seconds. You can return to the form and submit again if needed.'
      : 'Your details were queued for manual review. No investor record was created automatically.';
    const handleReturnToForm = () => {
      globalThis.sessionStorage?.removeItem(PUBLIC_INTAKE_SUBMISSION_KEY);
      globalThis.sessionStorage?.removeItem(PUBLIC_INTAKE_DRAFT_KEY);
      setIsSubmitted(false);
      setSubmissionTimedOut(false);
      setSubmissionLink(null);
      setOtpCode('');
      setOtpStatus(null);
      setIsSendingOtp(false);
      setIsVerifyingOtp(false);
      setIsPhoneVerified(false);
      setConsentToken(null);
      setTurnstileToken(null);
      setTurnstileStatus(null);
      setForm(INITIAL_FORM);
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background flex items-center justify-center p-6">
        <Card className="w-full max-w-2xl glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="w-5 h-5 text-success" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{description}</p>
            {submissionLink && (
              <Button type="button" onClick={handleReturnToForm}>
                <LinkIcon className="w-4 h-4 mr-2" />
                {submissionTimedOut ? 'Start a new submission' : 'Back to public intake'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="mx-auto max-w-6xl px-4 py-10 lg:py-16">
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-heading font-bold">Submit Investor Details</h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
              Complete the form below and submit the investor details for manual review before any record is created.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="glass-card">
            <CardHeader><CardTitle>Investor Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full Name" required>
                <Input required value={form.name} onChange={(e) => handleChange('name', e.target.value)} />
              </Field>
              <Field label="Email Address" required>
                <Input type="email" required value={form.email} onChange={(e) => handleChange('email', e.target.value)} />
              </Field>
              <Field label="Phone Number" required>
                <Input required value={form.phone} onChange={(e) => handleChange('phone', e.target.value)} />
              </Field>
              <Field label="Date of Birth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => handleChange('dateOfBirth', e.target.value)} />
              </Field>
              <Field label="Gender">
                <Select value={form.gender} onValueChange={(value) => handleChange('gender', value)}>
                  <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Address">
                <Input value={form.address} onChange={(e) => handleChange('address', e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader><CardTitle>Investment Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Currency">
                <Select value={form.currencyCode} onValueChange={(value) => handleChange('currencyCode', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Investment Type" required>
                <Select value={form.investmentType} onValueChange={(value) => handleChange('investmentType', value)} required>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVESTMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Investment Amount" required>
                <Input required type="number" min="1" value={form.investmentAmount} onChange={(e) => handleChange('investmentAmount', e.target.value)} />
              </Field>
              <Field label="Tenure (months)" required>
                <Input required type="number" min="1" value={form.tenure} onChange={(e) => handleChange('tenure', e.target.value)} />
              </Field>
              <Field label="Start Date" required>
                <Input required type="date" value={form.startDate} onChange={(e) => handleChange('startDate', e.target.value)} />
              </Field>
              <Field label="Client Bank" required>
                <Input required value={form.clientBank} onChange={(e) => handleChange('clientBank', e.target.value)} />
              </Field>
              <Field label="Account Number" required>
                <Input required value={form.clientAccountNumber} onChange={(e) => handleChange('clientAccountNumber', e.target.value)} />
              </Field>
              <Field label="Occupation">
                <Input value={form.occupation} onChange={(e) => handleChange('occupation', e.target.value)} />
              </Field>
              <Field label="Source of Funds">
                <Input value={form.sourceOfFunds} onChange={(e) => handleChange('sourceOfFunds', e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader><CardTitle>Next of Kin</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full Name">
                <Input value={form.nextOfKinName} onChange={(e) => handleChange('nextOfKinName', e.target.value)} />
              </Field>
              <Field label="Phone Number">
                <Input value={form.nextOfKinPhone} onChange={(e) => handleChange('nextOfKinPhone', e.target.value)} />
              </Field>
              <Field label="Relationship">
                <Select value={form.nextOfKinRelationship} onValueChange={(value) => handleChange('nextOfKinRelationship', value)}>
                  <SelectTrigger><SelectValue placeholder="Select relationship" /></SelectTrigger>
                  <SelectContent>
                    {NEXT_OF_KIN_RELATIONSHIPS.map((relationship) => (
                      <SelectItem key={relationship} value={relationship}>
                        {relationship}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Declarations & Consent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm leading-6 text-muted-foreground">
              <p className="text-foreground/90">
                I/We hereby declare that the information provided is true and complete. I/We understand and accept the
                terms and agree to comply with the partnership.
              </p>
              <div className="rounded-lg border bg-secondary/20 p-4 space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">OTP Consent</p>
                  <p className="mt-1 text-sm text-foreground/80">
                    Request a one-time code to the email address entered above. Enter the code below to confirm consent.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleSendOtp} disabled={isSendingOtp || !form.phone.trim()}>
                    {isSendingOtp ? 'Sending OTP...' : 'Send OTP to Email'}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isVerifyingOtp || otpCode.length < 4 || !form.phone.trim()}
                  >
                    {isVerifyingOtp ? 'Verifying...' : 'Verify OTP'}
                  </Button>
                </div>
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={(value) => setOtpCode(value)}
                  disabled={isPhoneVerified}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                {otpStatus && <p className={`text-xs ${isPhoneVerified ? 'text-success' : 'text-muted-foreground'}`}>{otpStatus}</p>}
                <p className="text-xs text-muted-foreground">
                  By verifying the OTP, the investor confirms consent and acknowledges the declaration above. The code is delivered by email.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="sr-only" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              autoComplete="off"
              tabIndex={-1}
              value={form.website}
              onChange={(e) => handleChange('website', e.target.value)}
            />
          </div>

          <Card className="glass-card">
            <CardHeader><CardTitle>Human Verification</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <TurnstileWidget
                siteKey={TURNSTILE_SITE_KEY}
                onToken={setTurnstileToken}
                onStatusChange={setTurnstileStatus}
              />
              {turnstileStatus && <p className="text-xs text-muted-foreground">{turnstileStatus}</p>}
            </CardContent>
          </Card>

          {!isPhoneVerified && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Submission is locked until the OTP is received and verified.
            </div>
          )}

          <div className="flex items-center justify-end">
            <Button type="submit" disabled={isSubmitting || !turnstileToken || !isPhoneVerified || !consentToken}>
              <Send className="w-4 h-4 mr-2" />
              {isSubmitting ? 'Submitting...' : isPhoneVerified ? 'Submit Investor Intake' : 'Verify OTP to Continue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field(props: { label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`space-y-2 ${props.className ?? ''}`}>
      <Label>
        {props.label}
        {props.required ? ' *' : ''}
      </Label>
      {props.children}
    </div>
  );
}
