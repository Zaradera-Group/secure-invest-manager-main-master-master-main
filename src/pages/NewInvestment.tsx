import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { calculateMaturityAmount, calculateMonthlyReturn, calculateTotalReturn, InvestmentType } from '@/types/investment';
import { formatCurrency } from '@/lib/format';
import { INVESTOR_CATEGORY_OPTIONS, type InvestorCategory, getInvestorCategoryLabel } from '@/lib/investorCategories';
import { useToast } from '@/hooks/use-toast';
import { useCreateInvestor, useInvestor, useUpdateInvestor } from '@/hooks/useInvestors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type GenderType = Database['public']['Enums']['gender_type'];
type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed';
const MAX_CURRENCY_VALUE = 9_999_999_999_999.99;
const MAX_PERCENTAGE_VALUE = 999.99;
const MAX_TENURE_MONTHS = 1200;
const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'] as const;
const NEXT_OF_KIN_RELATIONSHIP_OPTIONS = [
  'Father',
  'Mother',
  'Sister',
  'Brother',
  'Uncle',
  'Aunt',
  'Auntie',
  'Husband',
  'Wife',
  'Spouse',
  'Cousin',
  'Son',
  'Daughter',
  'Child',
  'Nephew',
  'Niece',
  'Grandfather',
  'Grandmother',
  'Guardian',
  'Friend',
  'Other',
] as const;
const IDENTITY_VERIFICATION_ENABLED = import.meta.env.VITE_ENABLE_IDENTITY_VERIFICATION === 'true';

type PublicIntakeRequest = {
  id: string;
  submitted_by_name?: string | null;
  email?: string | null;
  phone?: string | null;
  investor_category?: string | null;
  category_reference_name?: string | null;
  category_reference_email?: string | null;
  category_notes?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  occupation?: string | null;
  source_of_funds?: string | null;
  address?: string | null;
  next_of_kin_name?: string | null;
  next_of_kin_phone?: string | null;
  next_of_kin_relationship?: string | null;
  currency_code?: string | null;
  investment_amount?: number | null;
  start_date?: string | null;
  tenure?: number | null;
  percentage?: number | null;
  investment_type?: string | null;
  client_account_number?: string | null;
  client_bank?: string | null;
  brought_by?: string | null;
};

export default function NewInvestment() {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const createInvestor = useCreateInvestor();
  const updateInvestor = useUpdateInvestor();
  const { data: existingInvestor, isLoading: isInvestorLoading } = useInvestor(id);
  const { role } = useAuth();
  const [isUploadingPassport, setIsUploadingPassport] = useState(false);
  const [isVerifyingNin, setIsVerifyingNin] = useState(false);
  const [isVerifyingBvn, setIsVerifyingBvn] = useState(false);
  const appliedPublicIntakeIdRef = useRef<string | null>(null);
  const hasManagerEditedFormRef = useRef(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    investorCategory: 'nw' as InvestorCategory,
    categoryReferenceName: '',
    categoryReferenceEmail: '',
    categoryNotes: '',
    dateOfBirth: '',
    gender: '' as GenderType | '',
    nin: '',
    bvn: '',
    occupation: '',
    sourceOfFunds: '',
    address: '',
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinRelationship: '',
    passportPhotoUrl: '',
    currencyCode: 'NGN' as (typeof SUPPORTED_CURRENCIES)[number],
    ninVerificationStatus: 'unverified' as VerificationStatus,
    bvnVerificationStatus: 'unverified' as VerificationStatus,
    verificationProvider: '',
    investmentAmount: '',
    startDate: '',
    tenure: '',
    percentage: '',
    investmentType: '' as InvestmentType | '',
    clientAccountNumber: '',
    clientBank: '',
    broughtBy: '',
  });

  const applyPublicIntakePrefill = (request: PublicIntakeRequest) => {
    if (appliedPublicIntakeIdRef.current === request.id) return;

    const isCurrencyCode = (value?: string | null): value is (typeof SUPPORTED_CURRENCIES)[number] =>
      Boolean(value && SUPPORTED_CURRENCIES.includes(value as (typeof SUPPORTED_CURRENCIES)[number]));
    const isGender = (value?: string | null): value is GenderType =>
      value === 'Male' || value === 'Female' || value === 'Other';
    const isInvestmentType = (value?: string | null): value is InvestmentType =>
      value === 'Upfront' || value === 'Monthly' || value === 'Quarterly' || value === 'At Maturity';

    const prefill = {
      name: request.submitted_by_name ?? '',
      email: request.email ?? '',
      phone: request.phone ?? '',
      investorCategory: (request.investor_category as InvestorCategory) || 'nw',
      categoryReferenceName: request.category_reference_name ?? '',
      categoryReferenceEmail: request.category_reference_email ?? '',
      categoryNotes: request.category_notes ?? '',
      dateOfBirth: request.date_of_birth ?? '',
      gender: isGender(request.gender) ? request.gender : '',
      occupation: request.occupation ?? '',
      sourceOfFunds: request.source_of_funds ?? '',
      address: request.address ?? '',
      nextOfKinName: request.next_of_kin_name ?? '',
      nextOfKinPhone: request.next_of_kin_phone ?? '',
      nextOfKinRelationship: request.next_of_kin_relationship ?? '',
      currencyCode: isCurrencyCode(request.currency_code) ? request.currency_code : 'NGN',
      investmentAmount: request.investment_amount == null ? '' : String(request.investment_amount),
      startDate: request.start_date ?? '',
      tenure: request.tenure == null ? '' : String(request.tenure),
      percentage: request.percentage == null ? '' : String(request.percentage),
      investmentType: isInvestmentType(request.investment_type) ? request.investment_type : '',
      clientAccountNumber: request.client_account_number ?? '',
      clientBank: request.client_bank ?? '',
      broughtBy: request.brought_by ?? 'Self',
    };

    setForm((current) => {
      const next = { ...current };
      for (const [field, value] of Object.entries(prefill)) {
        const key = field as keyof typeof next;
        if (!hasManagerEditedFormRef.current || !String(next[key] ?? '').trim()) {
          next[key] = value as never;
        }
      }
      return next;
    });

    appliedPublicIntakeIdRef.current = request.id;
    toast({
      title: 'Form autofilled',
      description: 'Review the details before saving the investment.',
    });
  };

  useEffect(() => {
    if (isEditMode) return;

    const stateRequest = (location.state as { publicIntakeRequest?: PublicIntakeRequest } | null)?.publicIntakeRequest;
    if (stateRequest) {
      applyPublicIntakePrefill(stateRequest);
      return;
    }

    const intakeRequestId = searchParams.get('intakeRequestId');
    if (!intakeRequestId || appliedPublicIntakeIdRef.current === intakeRequestId) return;

    let isCancelled = false;

    async function loadPublicIntakeRequest() {
      try {
        const { data, error } = await supabase
          .from('public_intake_requests' as never)
          .select('*')
          .eq('id', intakeRequestId)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          toast({
            title: 'Intake not found',
            description: 'The public intake request could not be found.',
            variant: 'destructive',
          });
          return;
        }

        if (!isCancelled) {
          applyPublicIntakePrefill(data as PublicIntakeRequest);
        }
      } catch (error) {
        if (isCancelled) return;
        toast({
          title: 'Autofill failed',
          description: error instanceof Error ? error.message : 'Could not load the public intake request.',
          variant: 'destructive',
        });
      }
    }

    void loadPublicIntakeRequest();

    return () => {
      isCancelled = true;
    };
  }, [isEditMode, location.state, searchParams, toast]);

  useEffect(() => {
    if (!existingInvestor) return;

    setForm({
      name: existingInvestor.name,
      email: existingInvestor.email,
      phone: existingInvestor.phone,
      investorCategory: (existingInvestor.investor_category as InvestorCategory) || 'nw',
      categoryReferenceName: existingInvestor.category_reference_name ?? '',
      categoryReferenceEmail: existingInvestor.category_reference_email ?? '',
      categoryNotes: existingInvestor.category_notes ?? '',
      dateOfBirth: existingInvestor.date_of_birth ?? '',
      gender: existingInvestor.gender ?? '',
      nin: existingInvestor.nin ?? '',
      bvn: existingInvestor.bvn ?? '',
      occupation: existingInvestor.occupation ?? '',
      sourceOfFunds: existingInvestor.source_of_funds ?? '',
      address: existingInvestor.address ?? '',
      nextOfKinName: existingInvestor.next_of_kin_name ?? '',
      nextOfKinPhone: existingInvestor.next_of_kin_phone ?? '',
      nextOfKinRelationship: existingInvestor.next_of_kin_relationship ?? '',
      passportPhotoUrl: existingInvestor.passport_photo_url ?? '',
      currencyCode: (existingInvestor.currency_code as (typeof SUPPORTED_CURRENCIES)[number]) || 'NGN',
      ninVerificationStatus: (existingInvestor.nin_verification_status as VerificationStatus) || 'unverified',
      bvnVerificationStatus: (existingInvestor.bvn_verification_status as VerificationStatus) || 'unverified',
      verificationProvider: existingInvestor.verification_provider ?? '',
      investmentAmount: String(existingInvestor.investment_amount),
      startDate: existingInvestor.start_date,
      tenure: String(existingInvestor.tenure),
      percentage: String(existingInvestor.percentage),
      investmentType: existingInvestor.investment_type,
      clientAccountNumber: existingInvestor.client_account_number,
      clientBank: existingInvestor.client_bank,
      broughtBy: existingInvestor.brought_by ?? '',
    });
  }, [existingInvestor]);

  const amount = Number.parseFloat(form.investmentAmount) || 0;
  const rate = Number.parseFloat(form.percentage) || 0;
  const tenure = Number.parseInt(form.tenure) || 0;
  const expectedMaturity = form.investmentType
    ? calculateMaturityAmount(amount, rate, tenure, form.investmentType)
    : 0;
  const monthlyReturn = calculateMonthlyReturn(amount, rate);
  const totalReturn = calculateTotalReturn(amount, rate, tenure);

  const maturityDate = form.startDate && tenure
    ? (() => {
        const d = new Date(form.startDate);
        d.setMonth(d.getMonth() + tenure);
        return d.toISOString().split('T')[0];
      })()
    : '';

  const handleChange = (field: string, value: string) => {
    hasManagerEditedFormRef.current = true;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const verifyIdentity = async (documentType: 'nin' | 'bvn') => {
    const value = documentType === 'nin' ? form.nin : form.bvn;

    if (!value.trim()) {
      toast({
        title: `${documentType.toUpperCase()} required`,
        description: `Enter a ${documentType.toUpperCase()} before running verification.`,
        variant: 'destructive',
      });
      return;
    }

    if (documentType === 'nin') {
      setIsVerifyingNin(true);
    } else {
      setIsVerifyingBvn(true);
    }

    try {
      const { data, error } = await supabase.functions.invoke('verify-investor-identity', {
        body: {
          documentType,
          value,
          firstName: form.name.split(' ')[0] ?? '',
          lastName: form.name.split(' ').slice(1).join(' '),
          dob: form.dateOfBirth,
        },
      });

      if (error) throw error;

      const status = (data?.verified ? 'verified' : 'failed') as VerificationStatus;
      setForm((prev) => ({
        ...prev,
        ninVerificationStatus: documentType === 'nin' ? status : prev.ninVerificationStatus,
        bvnVerificationStatus: documentType === 'bvn' ? status : prev.bvnVerificationStatus,
        verificationProvider: data?.provider ?? prev.verificationProvider,
      }));

      toast({
        title: data?.verified ? `${documentType.toUpperCase()} verified` : `${documentType.toUpperCase()} not verified`,
        description: data?.message ?? 'Verification completed.',
        variant: data?.verified ? 'default' : 'destructive',
      });
    } catch (error) {
      toast({
        title: 'Verification failed',
        description: error instanceof Error ? error.message : 'Could not complete verification.',
        variant: 'destructive',
      });
    } finally {
      if (documentType === 'nin') {
        setIsVerifyingNin(false);
      } else {
        setIsVerifyingBvn(false);
      }
    }
  };

  const handlePassportUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingPassport(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${Date.now()}-${form.email || form.name || 'investor'}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('investor-passports')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('investor-passports').getPublicUrl(filePath);
      setForm((prev) => ({ ...prev, passportPhotoUrl: data.publicUrl }));
      toast({
        title: 'Passport uploaded',
        description: 'The investor passport photograph has been uploaded successfully.',
      });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Could not upload passport photograph.',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingPassport(false);
      event.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (amount <= 0) {
      toast({ title: 'Invalid Amount', description: 'Investment amount must be greater than zero.', variant: 'destructive' });
      return;
    }

    if (amount > MAX_CURRENCY_VALUE) {
      toast({
        title: 'Amount Too Large',
        description: 'Investment amount must be less than or equal to 9,999,999,999,999.99.',
        variant: 'destructive',
      });
      return;
    }

    if (rate < 0 || rate > MAX_PERCENTAGE_VALUE) {
      toast({
        title: 'Invalid Interest Rate',
        description: 'Interest rate must be between 0 and 999.99.',
        variant: 'destructive',
      });
      return;
    }

    if (tenure <= 0 || tenure > MAX_TENURE_MONTHS) {
      toast({
        title: 'Invalid Tenure',
        description: 'Tenure must be between 1 and 1200 months.',
        variant: 'destructive',
      });
      return;
    }

    if (
      form.nextOfKinRelationship
      && !NEXT_OF_KIN_RELATIONSHIP_OPTIONS.includes(
        form.nextOfKinRelationship as (typeof NEXT_OF_KIN_RELATIONSHIP_OPTIONS)[number],
      )
    ) {
      toast({
        title: 'Invalid Relationship',
        description: 'Select a valid next of kin relationship from the list.',
        variant: 'destructive',
      });
      return;
    }

    if (expectedMaturity > MAX_CURRENCY_VALUE) {
      toast({
        title: 'Maturity Amount Too Large',
        description: 'The expected maturity amount exceeds the database limit. Reduce the amount, rate, or tenure.',
        variant: 'destructive',
      });
      return;
    }

    let savedInvestorId: string | null = null;

    try {
      const investorPayload = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        investor_category: form.investorCategory,
        category_reference_name: form.categoryReferenceName || null,
        category_reference_email: form.categoryReferenceEmail || null,
        category_notes: form.categoryNotes || null,
        date_of_birth: form.dateOfBirth || null,
        gender: (form.gender as GenderType) || null,
        nin: form.nin || null,
        bvn: form.bvn || null,
        occupation: form.occupation || null,
        source_of_funds: form.sourceOfFunds || null,
        address: form.address || null,
        next_of_kin_name: form.nextOfKinName || null,
        next_of_kin_phone: form.nextOfKinPhone || null,
        next_of_kin_relationship: form.nextOfKinRelationship || null,
        passport_photo_url: form.passportPhotoUrl || null,
        currency_code: form.currencyCode,
        nin_verification_status: form.ninVerificationStatus,
        bvn_verification_status: form.bvnVerificationStatus,
        verification_provider: form.verificationProvider || null,
        last_verified_at:
          form.ninVerificationStatus === 'verified' || form.bvnVerificationStatus === 'verified'
            ? new Date().toISOString()
            : null,
        investment_amount: amount,
        start_date: form.startDate,
        maturity_date: maturityDate,
        tenure,
        percentage: rate,
        investment_type: form.investmentType as InvestmentType,
        expected_maturity_amount: Number(expectedMaturity.toFixed(2)),
        client_account_number: form.clientAccountNumber,
        client_bank: form.clientBank,
        brought_by: form.broughtBy || 'Self',
      };

      const savedInvestor = isEditMode && existingInvestor
        ? await updateInvestor.mutateAsync({ id: existingInvestor.id, ...investorPayload })
        : await createInvestor.mutateAsync(investorPayload);
      savedInvestorId = savedInvestor.id;

      toast({
        title: isEditMode ? 'Investor Updated' : 'Investment Created',
        description: isEditMode
          ? `${form.name}'s details have been updated successfully.`
          : role === 'investment_manager' || role === 'accountant'
            ? `${form.name}'s ${getInvestorCategoryLabel(form.investorCategory).toLowerCase()} has been recorded. Open the investor record to generate the certificate and start the approval workflow.`
            : `${form.name}'s investment has been recorded successfully.`,
      });

      navigate(isEditMode || role === 'investment_manager' || role === 'accountant' ? `/investors/${savedInvestor.id}` : '/investors');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      toast({
        title: savedInvestorId ? 'Investor saved' : 'Error',
        description: errorMessage,
        variant: 'destructive',
      });

      if (savedInvestorId) {
        navigate(`/investors/${savedInvestorId}`);
      }
    }
  };

  if (isEditMode && isInvestorLoading) {
    return <div className="space-y-6"><p className="text-sm text-muted-foreground">Loading investor details...</p></div>;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild><Link to="/investors"><ArrowLeft className="w-5 h-5" /></Link></Button>
        <div>
          <h1 className="text-2xl font-heading font-bold">{isEditMode ? 'Edit Investor' : 'New Investment'}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isEditMode ? 'Update investor details and investment information.' : 'Add a new investor and investment record.'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Investor Category</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={form.investorCategory} onValueChange={(v) => handleChange('investorCategory', v)}>
                <SelectTrigger><SelectValue placeholder="Select investor category" /></SelectTrigger>
                <SelectContent>
                  {INVESTOR_CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.shortLabel} - {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-secondary/30 p-4 text-sm text-muted-foreground">
              {form.investorCategory === 'nw' && 'New investor onboarding form. Use this for first-time investors joining the platform.'}
              {form.investorCategory === 'tu' && 'Top-up form for an existing investor adding more funds. Add the previous investor reference below.'}
              {form.investorCategory === 'rw' && 'Renewal form for an investor rolling over an existing investment. Add the previous investor reference below.'}
            </div>
            {form.investorCategory !== 'nw' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="categoryReferenceName">Existing Investor Name</Label>
                  <Input
                    id="categoryReferenceName"
                    value={form.categoryReferenceName}
                    onChange={(e) => handleChange('categoryReferenceName', e.target.value)}
                    placeholder="Name on existing/top-up/renewal record"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categoryReferenceEmail">Existing Investor Email</Label>
                  <Input
                    id="categoryReferenceEmail"
                    type="email"
                    value={form.categoryReferenceEmail}
                    onChange={(e) => handleChange('categoryReferenceEmail', e.target.value)}
                    placeholder="existing@investor.com"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="categoryNotes">Category Notes</Label>
                  <Input
                    id="categoryNotes"
                    value={form.categoryNotes}
                    onChange={(e) => handleChange('categoryNotes', e.target.value)}
                    placeholder={form.investorCategory === 'tu' ? 'Describe the top-up instruction' : 'Describe the renewal instruction'}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Personal Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input id="name" required value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="e.g. Adebayo Ogunlesi" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address *</Label>
              <Input id="email" type="email" required value={form.email} onChange={(e) => handleChange('email', e.target.value)} placeholder="investor@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <Input id="phone" required value={form.phone} onChange={(e) => handleChange('phone', e.target.value)} placeholder="+234 801 234 5678" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dob">Date of Birth</Label>
              <Input id="dob" type="date" value={form.dateOfBirth} onChange={(e) => handleChange('dateOfBirth', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={(v) => handleChange('gender', v)}>
                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="passport">Passport Photograph</Label>
              <Input id="passport" type="file" accept="image/*" onChange={handlePassportUpload} disabled={isUploadingPassport} />
              <p className="text-xs text-muted-foreground">{isUploadingPassport ? 'Uploading passport...' : form.passportPhotoUrl ? 'Passport uploaded successfully.' : 'Upload a recent passport photograph.'}</p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Residential Address</Label>
              <Input id="address" value={form.address} onChange={(e) => handleChange('address', e.target.value)} placeholder="Investor residential address" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Compliance & Verification</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nin">NIN</Label>
              <div className="flex gap-2">
                <Input id="nin" value={form.nin} onChange={(e) => handleChange('nin', e.target.value)} placeholder="National Identification Number" autoComplete="off" inputMode="numeric" />
                {IDENTITY_VERIFICATION_ENABLED && (
                  <Button type="button" variant="outline" onClick={() => verifyIdentity('nin')} disabled={isVerifyingNin}>
                    {isVerifyingNin ? 'Verifying...' : 'Verify'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Status: {form.ninVerificationStatus}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bvn">BVN</Label>
              <div className="flex gap-2">
                <Input id="bvn" value={form.bvn} onChange={(e) => handleChange('bvn', e.target.value)} placeholder="Bank Verification Number" autoComplete="off" inputMode="numeric" />
                {IDENTITY_VERIFICATION_ENABLED && (
                  <Button type="button" variant="outline" onClick={() => verifyIdentity('bvn')} disabled={isVerifyingBvn}>
                    {isVerifyingBvn ? 'Verifying...' : 'Verify'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Status: {form.bvnVerificationStatus}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="occupation">Occupation</Label>
              <Input id="occupation" value={form.occupation} onChange={(e) => handleChange('occupation', e.target.value)} placeholder="Occupation" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sourceOfFunds">Source of Funds</Label>
              <Input id="sourceOfFunds" value={form.sourceOfFunds} onChange={(e) => handleChange('sourceOfFunds', e.target.value)} placeholder="Source of funds" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="provider">Verification Provider</Label>
              <Input id="provider" value={form.verificationProvider} onChange={(e) => handleChange('verificationProvider', e.target.value)} placeholder="Filled automatically after verification" readOnly />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Investment Details</CardTitle></CardHeader>
          <div className="px-6 pb-2">
            <div className="space-y-2">
              <Label>Currency *</Label>
              <Select value={form.currencyCode} onValueChange={(v) => handleChange('currencyCode', v)}>
                <SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((currency) => (
                    <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">All investment figures, returns, and certificates will use {form.currencyCode}.</p>
            </div>
          </div>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Investment Amount (₦) *</Label>
              <Input id="amount" type="number" required min="0" max={MAX_CURRENCY_VALUE} value={form.investmentAmount} onChange={(e) => handleChange('investmentAmount', e.target.value)} placeholder="5000000" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate">Interest Rate (%) *</Label>
              <Input id="rate" type="number" required min="0" max={MAX_PERCENTAGE_VALUE} step="0.1" value={form.percentage} onChange={(e) => handleChange('percentage', e.target.value)} placeholder="18" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenure">Tenure (months) *</Label>
              <Input id="tenure" type="number" required min="1" max={MAX_TENURE_MONTHS} value={form.tenure} onChange={(e) => handleChange('tenure', e.target.value)} placeholder="12" />
            </div>
            <div className="space-y-2">
              <Label>Investment Type *</Label>
              <Select value={form.investmentType} onValueChange={(v) => handleChange('investmentType', v)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Upfront">Upfront</SelectItem>
                  <SelectItem value="Monthly">Monthly</SelectItem>
                  <SelectItem value="Quarterly">Quarterly</SelectItem>
                  <SelectItem value="At Maturity">At Maturity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="start">Start Date *</Label>
              <Input id="start" type="date" required value={form.startDate} onChange={(e) => handleChange('startDate', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Maturity Date</Label>
              <Input value={maturityDate} readOnly className="bg-secondary/50" />
            </div>
            {expectedMaturity > 0 && (
              <div className="md:col-span-2 p-4 rounded-lg bg-accent/5 border border-accent/20">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly Return</p>
                    <p className="text-2xl font-heading font-bold text-accent">{formatCurrency(Number(monthlyReturn.toFixed(2)), form.currencyCode)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Return Over Tenure</p>
                    <p className="text-2xl font-heading font-bold text-accent">{formatCurrency(Number(totalReturn.toFixed(2)), form.currencyCode)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Expected Maturity Amount</p>
                    <p className="text-2xl font-heading font-bold text-accent">{formatCurrency(Number(expectedMaturity.toFixed(2)), form.currencyCode)}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Next of Kin</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nextOfKinName">Full Name</Label>
              <Input id="nextOfKinName" value={form.nextOfKinName} onChange={(e) => handleChange('nextOfKinName', e.target.value)} placeholder="Next of kin name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nextOfKinPhone">Phone Number</Label>
              <Input id="nextOfKinPhone" value={form.nextOfKinPhone} onChange={(e) => handleChange('nextOfKinPhone', e.target.value)} placeholder="+234..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nextOfKinRelationship">Relationship</Label>
              <Select value={form.nextOfKinRelationship} onValueChange={(value) => handleChange('nextOfKinRelationship', value)}>
                <SelectTrigger id="nextOfKinRelationship">
                  <SelectValue placeholder="Select relationship" />
                </SelectTrigger>
                <SelectContent>
                  {NEXT_OF_KIN_RELATIONSHIP_OPTIONS.map((relationship) => (
                    <SelectItem key={relationship} value={relationship}>
                      {relationship}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Banking & Referral</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bank">Client Bank *</Label>
              <Input id="bank" required value={form.clientBank} onChange={(e) => handleChange('clientBank', e.target.value)} placeholder="First Bank" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account">Account Number *</Label>
              <Input id="account" required value={form.clientAccountNumber} onChange={(e) => handleChange('clientAccountNumber', e.target.value)} placeholder="0012345678" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referrer">Brought By</Label>
              <Input id="referrer" value={form.broughtBy} onChange={(e) => handleChange('broughtBy', e.target.value)} placeholder="Referrer name or 'Self'" />
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" asChild><Link to="/investors">Cancel</Link></Button>
          <Button type="submit" disabled={createInvestor.isPending || updateInvestor.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {createInvestor.isPending || updateInvestor.isPending ? 'Saving...' : isEditMode ? 'Update Investor' : 'Save Investment'}
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
