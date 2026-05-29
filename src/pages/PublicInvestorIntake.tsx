import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Link as LinkIcon, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useToast } from '@/hooks/use-toast';

const CERTIFICATE_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';
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

export default function PublicInvestorIntake() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionLink, setSubmissionLink] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
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
  });

  const handleChange = (field: string, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (!turnstileToken) {
        throw new Error('Please complete the human verification challenge before submitting.');
      }

      const response = await fetch(`${CERTIFICATE_API_URL}/public/investor-intake`, {
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
          turnstileToken,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message ?? 'Unable to submit investor intake.');
      }

      setIsSubmitted(true);
      setSubmissionLink('/landing');
      toast({
        title: 'Submission received',
        description: 'The details were queued for manual review.',
      });
    } catch (error) {
      toast({
        title: 'Submission failed',
        description: error instanceof Error ? error.message : 'Could not submit the intake form.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background flex items-center justify-center p-6">
        <Card className="w-full max-w-2xl glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="w-5 h-5 text-success" />
              Submission successful
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your details were queued for manual review. No investor record was created automatically.
            </p>
            {submissionLink && (
              <Button asChild>
                <Link to={submissionLink}>
                  <LinkIcon className="w-4 h-4 mr-2" />
                  Return to home
                </Link>
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
            <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
              <p className="text-foreground/90">
                I/We hereby declare that the information provided is true and complete. I/We understand and accept the
                terms and agree to comply with the partnership.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="rounded-lg border bg-secondary/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Partners Signature</p>
                  <div className="border-b border-dashed border-foreground/30 pt-8" />
                </div>
                <div className="rounded-lg border bg-secondary/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Date</p>
                  <div className="border-b border-dashed border-foreground/30 pt-8" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                Partners Signature: _____________________________________________ Date: ______ /________/ _________
              </p>
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

          <div className="flex items-center justify-end">
            <Button type="submit" disabled={isSubmitting || !turnstileToken}>
              <Send className="w-4 h-4 mr-2" />
              {isSubmitting ? 'Submitting...' : 'Submit Investor Intake'}
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
