import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';
import { fetchAccessibleInvestors } from '@/hooks/useInvestors';

type AppRole = Database['public']['Enums']['app_role'];
type DashboardScope = 'staff' | 'executive' | 'all';
const CERTIFICATE_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';
const CERTIFICATE_REFETCH_INTERVAL_MS = 3 * 60 * 1000;
const EXECUTIVE_ROLES = ['admin', 'super_admin'] as const;
const MANAGER_EQUIVALENT_ROLES = ['investment_manager', 'accountant'] as const;
const VISIBILITY_SIGN_OUT_BYPASS_STORAGE_KEY = 'auth:visibility-signout-bypass-until';

function isExecutiveRole(role: string | null | undefined): role is (typeof EXECUTIVE_ROLES)[number] {
  return !!role && EXECUTIVE_ROLES.includes(role as (typeof EXECUTIVE_ROLES)[number]);
}

function isManagerEquivalentRole(role: string | null | undefined): role is (typeof MANAGER_EQUIVALENT_ROLES)[number] {
  return !!role && MANAGER_EQUIVALENT_ROLES.includes(role as (typeof MANAGER_EQUIVALENT_ROLES)[number]);
}

export type WorkflowCertificateStatus =
  | 'pending_manager'
  | 'pending_general_manager'
  | 'pending_ceo'
  | 'approved'
  | 'sent';

export type WorkflowCertificate = {
  id: string;
  investor_id?: string | null;
  investor_name: string;
  investor_email: string;
  amount: number;
  interest_rate: number;
  status: WorkflowCertificateStatus;
  created_by?: string | null;
  manager_signature: string | null;
  general_manager_signature: string | null;
  ceo_signature: string | null;
  certificate_url: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  sent_at: string | null;
};

export type CertificateAction =
  | 'generate'
  | 'approve_investment_manager'
  | 'approve_general_manager'
  | 'approve_ceo'
  | 'send';

export type CertificateInboxItem = {
  certificate: WorkflowCertificate;
  investor: {
    id?: string;
    name: string;
    email: string;
    category?: string | null;
  };
  nextActionLabel: string;
  href: string;
};

type WorkflowInvestor = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  currency_code?: string | null;
  reference_number?: number | null;
  investment_amount: number;
  percentage: number;
  tenure?: number;
  maturity_date?: string;
  expected_maturity_amount?: number;
  investment_type?: 'Upfront' | 'Monthly' | 'Quarterly' | 'At Maturity';
};

export function useInvestorCertificate(investor?: Pick<WorkflowInvestor, 'id' | 'name' | 'email'>) {
  const { role } = useAuth();

  return useQuery({
    queryKey: ['investor-certificate', investor?.id, investor?.email, investor?.name, role],
    enabled: !!investor?.email && !!investor?.name && !!role,
    queryFn: async () => {
      if (!investor?.email || !investor.name) {
        throw new Error('Investor context is required to load certificate data.');
      }

      const accessToken = await getActiveAccessToken();
      if (!accessToken) {
        throw new Error('Failed to load session. Please sign in again.');
      }

      const query = new URLSearchParams({
        email: investor.email.toLowerCase(),
        name: investor.name,
      });

      if (investor.id) {
        query.set('investorId', investor.id);
      }

      const response = await fetch(`${CERTIFICATE_API_URL}/certificates/by-investor?${query.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const raw = await response.text();
      const data = parseJsonSafely(raw);

      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? 'Failed to load certificate data.');
      }

      return (data ?? null) as WorkflowCertificate | null;
    },
    refetchInterval: CERTIFICATE_REFETCH_INTERVAL_MS,
  });
}

export function useCertificateApprovalEvents(certificateId?: string) {
  return useQuery({
    queryKey: ['certificate-approval-events', certificateId],
    enabled: !!certificateId,
    queryFn: async () => {
      if (!certificateId) {
        throw new Error('Certificate id is required to load workflow notifications.');
      }

      const { data, error } = await supabase
        .from('notifications' as never)
        .select('*')
        .eq('certificate_id', certificateId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        user_role: string;
        message: string;
        created_at: string;
      }>;
    },
    refetchInterval: CERTIFICATE_REFETCH_INTERVAL_MS,
  });
}

export function useManageInvestorCertificate() {
  const queryClient = useQueryClient();
  const { user, role, mfaRequired, mfaVerified, ensureFreshSession, refreshMfaStatus } = useAuth();

  return useMutation({
    mutationFn: async (payload: {
      investor: WorkflowInvestor;
      certificateId?: string;
      action: CertificateAction;
      issueDate?: string;
      signatureDataUrl?: string;
      notes?: string;
    }) => {
      if (!user?.id || !role) {
        throw new Error('You must be signed in with a workflow role to manage certificates.');
      }

      await ensureCertificateMfaReady({
        mfaRequired,
        mfaVerified,
        ensureFreshSession,
        refreshMfaStatus,
      });

      const requestBody = getRequestBody(payload);
      const endpoint = getEndpointPath(payload.action, payload.certificateId);
      let accessToken = await getActiveAccessToken();

      console.log('[Certificates] invoking function', {
        endpoint,
        hasAccessToken: !!accessToken,
        userId: user.id,
      });

      let { response, data } = await callCertificateApiWithParsedResponse(endpoint, requestBody, accessToken);

      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Function call failed with ${response.status}`);
      }

      const certificateUrl = 
        (typeof (data as { certificate_url?: unknown } | null)?.certificate_url === 'string'
          ? (data as { certificate_url: string }).certificate_url
          : null)
        ?? (data?.data?.certificate_url as string | undefined | null)
        ?? null;
      const resolvedCertificateId =
        (typeof (data as { id?: unknown } | null)?.id === 'string'
          ? (data as { id: string }).id
          : null)
        ?? (typeof (data as { data?: { id?: unknown } } | null)?.data?.id === 'string'
          ? (data as { data: { id: string } }).data.id
          : null)
        ?? payload.certificateId
        ?? null;

      return {
        message: getSuccessMessage(payload.action),
        certificateUrl,
        certificateId: resolvedCertificateId,
      };
    },
    onSuccess: (result, variables) => {
      const certificateId = result.certificateId ?? variables.certificateId;

      queryClient.invalidateQueries({ queryKey: ['investor-certificate'] });
      queryClient.invalidateQueries({ queryKey: ['certificate-approval-events'] });
      queryClient.invalidateQueries({ queryKey: ['certificate-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      if (certificateId) {
        queryClient.invalidateQueries({ queryKey: ['certificate-preview-viewer', certificateId] });
        queryClient.invalidateQueries({ queryKey: ['certificate-download-viewer', certificateId] });
      }
    },
  });
}

export async function getCertificateSignedDownloadUrl(certificateId: string) {
  console.info('[certificates.view] Requesting signed download URL', { certificateId });
  const accessToken = await getActiveAccessToken();

  if (!accessToken) {
    console.error('[certificates.view] No access token available for signed download URL', { certificateId });
    throw new Error('Failed to load session. Please sign in again.');
  }

  const response = await fetch(`${CERTIFICATE_API_URL}/certificates/${certificateId}/download`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const raw = await response.text();
  const data = parseJsonSafely(raw) as { signedUrl?: string; message?: string; error?: string } | null;

  if (!response.ok || !data?.signedUrl) {
    console.error('[certificates.view] Signed download URL request failed', {
      certificateId,
      status: response.status,
      data,
    });
    throw new Error(data?.error ?? data?.message ?? 'Failed to open certificate');
  }

  console.info('[certificates.view] Signed download URL ready', { certificateId });

  return data.signedUrl;
}

export async function getCertificatePreviewUrl(certificateId: string) {
  console.info('[certificates.view] Requesting preview PDF file', { certificateId });
  const accessToken = await getActiveAccessToken();

  if (!accessToken) {
    console.error('[certificates.view] No access token available for preview PDF file', { certificateId });
    throw new Error('Failed to load session. Please sign in again.');
  }

  const response = await fetch(`${CERTIFICATE_API_URL}/certificates/${certificateId}/file`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    const data = parseJsonSafely(raw) as { message?: string; error?: string } | null;
    console.error('[certificates.view] Preview PDF file request failed', {
      certificateId,
      status: response.status,
      data,
    });
    throw new Error(data?.error ?? data?.message ?? 'Failed to open certificate');
  }

  const blob = await response.blob();
  const previewUrl = URL.createObjectURL(blob);
  console.info('[certificates.view] Preview PDF file ready', { certificateId });
  return previewUrl;
}

export async function openCertificatePreviewInNewTab(certificateId: string) {
  console.info('[certificates.view] Opening certificate in new tab', { certificateId });
  globalThis.sessionStorage?.setItem(
    VISIBILITY_SIGN_OUT_BYPASS_STORAGE_KEY,
    String(Date.now() + 15_000),
  );

  const newWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!newWindow) {
    throw new Error('Failed to open certificate. Please allow popups for this site and try again.');
  }

  newWindow.document.write('<title>Opening certificate...</title><p style="font-family: sans-serif; padding: 16px;">Opening certificate...</p>');

  try {
    const previewUrl = await getCertificatePreviewUrl(certificateId);
    console.info('[certificates.view] Opening preview URL in new tab', { certificateId });
    newWindow.location.replace(previewUrl);

    return previewUrl;
  } catch (error) {
    newWindow.close();
    throw error;
  }
}

export function useCertificateInbox(scope: DashboardScope = 'staff') {
  const { role, user } = useAuth();

  return useQuery({
    queryKey: ['certificate-inbox', role, user?.id, scope],
    enabled: !!role && ['investment_manager', 'accountant', 'general_manager', 'super_admin', 'admin'].includes(role),
    queryFn: async () => {
      if (!role) {
        return [] as CertificateInboxItem[];
      }

      const statusesByRole: Partial<Record<AppRole, WorkflowCertificateStatus[]>> = {
        investment_manager: ['pending_manager', 'approved'],
        accountant: ['pending_manager', 'approved'],
        general_manager: ['pending_general_manager', 'approved'],
        super_admin: ['pending_ceo'],
        admin: ['pending_manager', 'pending_general_manager', 'pending_ceo', 'approved'],
      };

      const statuses = statusesByRole[role];
      if (!statuses?.length) {
        return [] as CertificateInboxItem[];
      }

      let query = supabase
        .from('certificates' as never)
        .select('*')
        .in('status', statuses)
        .order('created_at', { ascending: false })
        .limit(6);

      if (isExecutiveRole(role) && user?.id) {
        if (scope === 'executive') {
          query = query.eq('created_by', user.id);
        } else if (scope === 'staff') {
          query = query.neq('created_by', user.id);
        }
      }

      const { data: certificates, error } = await query;

      if (error) throw error;

      let certificateRows = (certificates ?? []) as unknown as WorkflowCertificate[];
      if (isManagerEquivalentRole(role) && user?.id) {
        certificateRows = certificateRows.filter((certificate) =>
          certificate.status === 'pending_manager' || certificate.status === 'approved' || certificate.created_by === user.id,
        );
      }
      if (role === 'general_manager' && user?.id) {
        certificateRows = certificateRows.filter((certificate) =>
          certificate.status === 'pending_general_manager' || certificate.created_by === user.id,
        );
      }
      const investors = await fetchAccessibleInvestors();

      const investorMap = new Map<string, { id: string; name: string; email: string; investor_category: string | null }>();
      investors.forEach((investor) => {
        investorMap.set(investor.id, investor);
        investorMap.set(`${investor.email.toLowerCase()}::${investor.name}`, investor);
      });

      return certificateRows.map((certificate) => {
        const matchedInvestor =
          investorMap.get((certificate as WorkflowCertificate & { investor_id?: string | null }).investor_id ?? '')
          ?? investorMap.get(`${certificate.investor_email.toLowerCase()}::${certificate.investor_name}`);

        return {
        certificate,
        investor: {
          id: matchedInvestor?.id,
          name: certificate.investor_name,
          email: certificate.investor_email,
          category: matchedInvestor?.investor_category ?? null,
        },
        nextActionLabel: getNextActionLabel(role, certificate),
        href: matchedInvestor?.id ? `/investors/${matchedInvestor.id}` : '/certificates',
        };
      }) satisfies CertificateInboxItem[];
    },
    refetchInterval: CERTIFICATE_REFETCH_INTERVAL_MS,
  });
}

export function usePendingApprovals(scope: DashboardScope = 'staff') {
  const { user, role } = useAuth();

  return useQuery({
    queryKey: ['pending-approvals', user?.id, role, scope],
    enabled: !!user?.id && !!role,
    queryFn: async () => {
      if (!role) return 0;

      let statusFilter: WorkflowCertificateStatus[] = [];
      if (isManagerEquivalentRole(role)) {
        statusFilter = ['pending_manager', 'approved'];
      } else if (role === 'general_manager') {
        statusFilter = ['pending_general_manager', 'approved'];
      } else if (role === 'admin') {
        statusFilter = ['pending_manager', 'pending_general_manager', 'pending_ceo', 'approved'];
      } else if (isExecutiveRole(role)) {
        statusFilter = ['pending_ceo'];
      } else {
        return 0;
      }

      let query = supabase
        .from('certificates' as never)
        .select('id,status,created_by')
        .in('status', statusFilter);

      if (isExecutiveRole(role) && user?.id) {
        if (scope === 'executive') {
          query = query.eq('created_by', user.id);
        } else if (scope === 'staff') {
          query = query.neq('created_by', user.id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      const rows = ((data ?? []) as Array<{ id: string; status: WorkflowCertificateStatus; created_by?: string | null }>)
        .filter((certificate) => {
          if (isManagerEquivalentRole(role)) {
            return certificate.status === 'pending_manager' || certificate.status === 'approved' || certificate.created_by === user?.id;
          }

          if (role === 'general_manager') {
            return certificate.status === 'pending_general_manager' || certificate.created_by === user?.id;
          }

          return true;
        });

      return rows.length;
    },
    refetchInterval: CERTIFICATE_REFETCH_INTERVAL_MS,
  });
}

export function useUpdateAvailability() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (isAvailable: boolean) => {
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('user_roles' as never)
        .update({ is_available_for_approvals: isAvailable } as never)
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-roles'] });
    },
  });
}

function getEndpointPath(action: CertificateAction, certificateId?: string) {
  switch (action) {
    case 'generate':
      return '/certificates/create';
    case 'approve_investment_manager':
      if (!certificateId) throw new Error('No certificate record was found for this investor yet.');
      return `/certificates/${certificateId}/manager-approve`;
    case 'approve_general_manager':
      if (!certificateId) throw new Error('No certificate record was found for this investor yet.');
      return `/certificates/${certificateId}/general-manager-approve`;
    case 'approve_ceo':
      if (!certificateId) throw new Error('No certificate record was found for this investor yet.');
      return `/certificates/${certificateId}/ceo-approve`;
    case 'send':
      if (!certificateId) throw new Error('No certificate record was found for this investor yet.');
      return `/certificates/${certificateId}/send`;
  }
}

function getRequestBody(payload: {
  investor: WorkflowInvestor;
  certificateId?: string;
  action: CertificateAction;
  issueDate?: string;
  signatureDataUrl?: string;
}) {
  if (payload.action === 'generate') {
    const referenceNumber = Number(payload.investor.reference_number);
    return {
      investorId: payload.investor.id,
      investorName: payload.investor.name,
      investorEmail: payload.investor.email,
      investorPhone: payload.investor.phone,
      investorReferenceNumber: Number.isFinite(referenceNumber) && referenceNumber >= 0 ? referenceNumber : undefined,
      amount: Number(payload.investor.investment_amount),
      currencyCode: String(payload.investor.currency_code ?? 'NGN'),
      interestRate: Number(payload.investor.percentage),
      investmentType: payload.investor.investment_type,
      issueDate: payload.issueDate,
      investmentTenure: payload.investor.tenure ? `${payload.investor.tenure} months` : undefined,
      principalMaturityDate: payload.investor.maturity_date,
    };
  }

  if (!payload.certificateId) {
    throw new Error('No certificate record was found for this investor yet.');
  }

  if (payload.action === 'send') {
    return {};
  }

  return payload.signatureDataUrl
    ? {
        signature: payload.signatureDataUrl,
      }
    : {};
}

function getNextActionLabel(role: AppRole, certificate: WorkflowCertificate) {
  if (isManagerEquivalentRole(role) && certificate.status === 'pending_manager') {
    return 'Review and sign';
  }

  if (role === 'admin' && certificate.status === 'pending_manager') {
    return 'Sign as Investment Manager';
  }

  if (isManagerEquivalentRole(role) && certificate.status === 'approved') {
    return 'Send to investor';
  }

  if (role === 'admin' && certificate.status === 'approved') {
    return 'Send to investor';
  }

  if (role === 'general_manager' && certificate.status === 'pending_general_manager') {
    return 'Approve and sign';
  }

  if (role === 'general_manager' && certificate.status === 'approved') {
    return 'Send to investor';
  }

  if (role === 'admin' && certificate.status === 'pending_general_manager') {
    return 'Sign as General Manager';
  }

  if (isExecutiveRole(role) && certificate.status === 'pending_ceo') {
    return 'Final approval';
  }

  return 'Review certificate';
}

function getSuccessMessage(action: CertificateAction) {
  switch (action) {
    case 'generate':
      return 'Certificate created successfully.';
    case 'approve_investment_manager':
      return 'Investment Manager signature saved and certificate sent to the General Manager.';
    case 'approve_general_manager':
      return 'General Manager signature saved and certificate sent to the CEO.';
    case 'approve_ceo':
      return 'CEO approval recorded and the certificate has been returned to the Investment Manager.';
    case 'send':
      return 'Certificate sent to the investor successfully.';
    default:
      return 'Certificate workflow updated.';
  }
}

async function ensureCertificateMfaReady(input: {
  mfaRequired: boolean;
  mfaVerified: boolean;
  ensureFreshSession: () => Promise<unknown>;
  refreshMfaStatus: (force?: boolean) => Promise<void>;
}) {
  if (!input.mfaRequired || input.mfaVerified) {
    return;
  }

  await input.ensureFreshSession();
  await input.refreshMfaStatus(true);

  const { data: assuranceData, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) {
    throw assuranceError;
  }

  const hasVerifiedMfa =
    assuranceData.currentLevel === 'aal2' || assuranceData.nextLevel === 'aal2';

  if (!hasVerifiedMfa) {
    throw new Error('Multi-factor authentication is required before you can perform certificate actions.');
  }
}

async function getActiveAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw sessionError;
  }

  return sessionData.session?.access_token ?? null;
}

async function callCertificateApiWithParsedResponse(endpoint: string, requestBody: unknown, accessToken: string) {
  const response = await callCertificateApi(endpoint, requestBody, accessToken);
  const raw = await response.text();
  const data = parseJsonSafely(raw);

  return { response, data };
}

export function isDirectCeoCertificate(certificate: WorkflowCertificate | null | undefined, userId?: string) {
  return !!certificate && !!userId && certificate.status === 'pending_ceo' && certificate.created_by === userId;
}

async function callCertificateApi(endpoint: string, requestBody: unknown, accessToken: string) {
  return fetch(`${CERTIFICATE_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
}

function parseJsonSafely(raw: string) {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as {
      id?: string;
      error?: string;
      message?: string;
      certificate_url?: string | null;
      data?: { certificate_url?: string | null };
    };
  } catch {
    return null;
  }
}
