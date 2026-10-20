import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';
import type { QueryClient } from '@tanstack/react-query';

const INVESTOR_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';

type InvestorRow = Database['public']['Tables']['investors']['Row'];
type InvestorInsert = Database['public']['Tables']['investors']['Insert'];
type DashboardPortfolioSummaryRow = Database['public']['Views']['dashboard_portfolio_summary']['Row'];
type DashboardInvestmentTypeSummaryRow = Database['public']['Views']['dashboard_investment_type_summary']['Row'];
type MaturityAlertRow = Database['public']['Functions']['get_maturity_alerts']['Returns'][number];
type DashboardScope = 'staff' | 'executive' | 'all';
type DashboardInvestorRow = Pick<
  InvestorRow,
  'id' | 'name' | 'investment_amount' | 'maturity_date' | 'liquidation_status' | 'investment_type' | 'created_by' | 'currency_code'
>;
type DashboardPortfolioSummary = DashboardPortfolioSummaryRow & {
  foreign_currency_investments: number;
  foreign_currency_codes: string[];
};
type CreatorSummary = {
  id: string;
  full_name: string | null;
  role: string | null;
  roleLabel: string;
  displayName: string;
};
type InvestorWithCreator = InvestorRow & {
  creator: CreatorSummary | null;
};

const INVESTOR_QUERY_KEYS = [
  ['investors'],
  ['investor-list'],
  ['dashboard-portfolio-summary'],
  ['dashboard-investment-type-summary'],
  ['dashboard-upcoming-maturities'],
  ['maturity-alerts'],
  ['certificate-inbox'],
  ['pending-approvals'],
] as const;
const INVESTOR_DELETE_EXTRA_QUERY_KEYS = [
  ['dashboard-notifications'],
  ['dashboard-notifications-unread-count'],
  ['investor-certificate'],
  ['certificate-approval-events'],
] as const;
const INVESTOR_UPDATE_EXTRA_QUERY_KEYS = [
  ['investor-certificate'],
  ['certificate-approval-events'],
  ['certificate-inbox'],
  ['pending-approvals'],
  ['dashboard-notifications'],
  ['dashboard-notifications-unread-count'],
  ['notifications'],
  ['certificate-preview-viewer'],
  ['certificate-download-viewer'],
] as const;

function invalidateQueryKeys(queryClient: QueryClient, keys: ReadonlyArray<readonly string[]>) {
  keys.forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  });
}

function invalidateInvestorRelatedQueries(queryClient: QueryClient, includeDeleteExtras = false) {
  invalidateQueryKeys(queryClient, INVESTOR_QUERY_KEYS);

  if (includeDeleteExtras) {
    invalidateQueryKeys(queryClient, INVESTOR_DELETE_EXTRA_QUERY_KEYS);
  }
}

function invalidateInvestorUpdateSideEffects(queryClient: QueryClient) {
  invalidateQueryKeys(queryClient, INVESTOR_UPDATE_EXTRA_QUERY_KEYS);
}

async function getAuthenticatedBackendToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token ?? null;
  if (!token) {
    throw new Error('You must be signed in to perform this action.');
  }

  return token;
}

async function callInvestorBackend<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
) {
  const token = await getAuthenticatedBackendToken();
  const response = await fetch(`${INVESTOR_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  let data: { message?: string; certificate_url?: string; data?: T } | null = null;

  if (raw) {
    try {
      data = JSON.parse(raw) as { message?: string; certificate_url?: string; data?: T };
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new Error(data?.message ?? 'Request failed.');
  }

  return data?.data ?? (data as unknown as T);
}

export async function syncInvestorCertificate(investorId: string) {
  return callInvestorBackend<{ id?: string; certificate_url?: string | null }>(`/investors/${investorId}/sync-certificate`, 'POST');
}

export async function deleteInvestorPermanently(investorId: string) {
  return callInvestorBackend<{ message: string }>(`/investors/${investorId}`, 'DELETE');
}

export async function fetchAccessibleInvestors() {
  return callInvestorBackend<InvestorWithCreator[]>('/investors', 'GET');
}

function dashboardScopeQuery(scope: DashboardScope) {
  return new URLSearchParams({ scope }).toString();
}

export function useInvestors(page = 0, pageSize = 50) {
  const { role, user } = useAuth();

  return useQuery({
    queryKey: ['investors', page, pageSize, role, user?.id],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const visibleInvestors = await fetchAccessibleInvestors();
      return visibleInvestors.slice(from, to + 1);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useInvestorList(options: {
  page: number;
  pageSize: number;
  search?: string;
  statusFilter?: string;
  typeFilter?: string;
  categoryFilter?: string;
}) {
  const { role, user } = useAuth();
  const { page, pageSize, search = '', statusFilter = 'all', typeFilter = 'all', categoryFilter = 'all' } = options;

  return useQuery({
    queryKey: ['investor-list', page, pageSize, search, statusFilter, typeFilter, categoryFilter, role, user?.id],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let visibleInvestors = await fetchAccessibleInvestors();

      if (statusFilter !== 'all') {
        visibleInvestors = visibleInvestors.filter((investor) => investor.liquidation_status === statusFilter);
      }

      if (typeFilter !== 'all') {
        visibleInvestors = visibleInvestors.filter((investor) => investor.investment_type === typeFilter);
      }

      if (categoryFilter !== 'all') {
        visibleInvestors = visibleInvestors.filter((investor) => investor.investor_category === categoryFilter);
      }

      if (search.trim()) {
        const searchValue = search.trim().toLowerCase();
        visibleInvestors = visibleInvestors.filter((investor) =>
          [investor.name, investor.email, investor.client_bank, investor.brought_by]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(searchValue))
        );
      }

      return {
        data: visibleInvestors.slice(from, to + 1),
        count: visibleInvestors.length,
      };
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export async function exportInvestors(options: {
  search?: string;
  statusFilter?: string;
  typeFilter?: string;
  categoryFilter?: string;
}) {
  const { search = '', statusFilter = 'all', typeFilter = 'all', categoryFilter = 'all' } = options;
  let visibleInvestors = await fetchAccessibleInvestors();

  if (statusFilter !== 'all') {
    visibleInvestors = visibleInvestors.filter((investor) => investor.liquidation_status === statusFilter);
  }

  if (typeFilter !== 'all') {
    visibleInvestors = visibleInvestors.filter((investor) => investor.investment_type === typeFilter);
  }

  if (categoryFilter !== 'all') {
    visibleInvestors = visibleInvestors.filter((investor) => investor.investor_category === categoryFilter);
  }

  if (search.trim()) {
    const searchValue = search.trim().toLowerCase();
    visibleInvestors = visibleInvestors.filter((investor) =>
      [investor.name, investor.email, investor.client_bank, investor.brought_by]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchValue))
    );
  }

  return visibleInvestors;
}

export function useMaturityAlerts(page = 0, pageSize = 20) {
  const { role, user } = useAuth();

  return useQuery({
    queryKey: ['maturity-alerts', page, pageSize, role, user?.id],
    queryFn: () => callInvestorBackend<MaturityAlertRow[]>(
      `/investors/maturity-alerts?page=${page}&pageSize=${pageSize}`,
      'GET',
    ),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useDashboardPortfolioSummary(scope: DashboardScope = 'staff') {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ['dashboard-portfolio-summary', userId, role, scope],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) {
        throw new Error('User is required to load dashboard summary.');
      }

      return callInvestorBackend<DashboardPortfolioSummary>(
        `/investors/dashboard/portfolio-summary?${dashboardScopeQuery(scope)}`,
        'GET',
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useDashboardInvestmentTypeSummary() {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ['dashboard-investment-type-summary', userId, role, 'staff'],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) {
        throw new Error('User is required to load dashboard investment type summary.');
      }

      return callInvestorBackend<DashboardInvestmentTypeSummaryRow[]>(
        '/investors/dashboard/investment-types?scope=staff',
        'GET',
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useDashboardInvestmentTypeSummaryByScope(scope: DashboardScope = 'staff') {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ['dashboard-investment-type-summary', userId, role, scope],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) {
        throw new Error('User is required to load dashboard investment type summary.');
      }

      return callInvestorBackend<DashboardInvestmentTypeSummaryRow[]>(
        `/investors/dashboard/investment-types?${dashboardScopeQuery(scope)}`,
        'GET',
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useDashboardUpcomingMaturities(limit = 5) {
  const { user, role } = useAuth();

  return useQuery({
    queryKey: ['dashboard-upcoming-maturities', limit, user?.id, role, 'staff'],
    enabled: !!user?.id,
    queryFn: async () => {
      return callInvestorBackend<DashboardInvestorRow[]>(
        `/investors/dashboard/upcoming-maturities?scope=staff&limit=${Math.max(limit, 1)}`,
        'GET',
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useDashboardUpcomingMaturitiesByScope(limit = 5, scope: DashboardScope = 'staff') {
  const { user, role } = useAuth();

  return useQuery({
    queryKey: ['dashboard-upcoming-maturities', limit, user?.id, role, scope],
    enabled: !!user?.id,
    queryFn: async () => {
      return callInvestorBackend<DashboardInvestorRow[]>(
        `/investors/dashboard/upcoming-maturities?${dashboardScopeQuery(scope)}&limit=${Math.max(limit, 1)}`,
        'GET',
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useInvestor(id: string | undefined) {
  const { role, user } = useAuth();

  return useQuery({
    queryKey: ['investors', id, role, user?.id],
    enabled: !!id,
    queryFn: async () => {
      return callInvestorBackend<InvestorRow>(`/investors/${id}`, 'GET');
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
  });
}

export function useCreateInvestor() {
  const queryClient = useQueryClient();
  const { user, role } = useAuth();

  return useMutation({
    mutationFn: async (investor: Omit<InvestorInsert, 'created_by'>) => {
      if (!user) {
        throw new Error('You must be signed in to create an investor.');
      }

      if (!role) {
        throw new Error('Your account does not have an assigned role yet. Please sign out and sign back in after the role setup is complete.');
      }

      return callInvestorBackend<InvestorRow>('/investors', 'POST', investor);
    },
    onSuccess: () => {
      invalidateInvestorRelatedQueries(queryClient, true);
    },
  });
}

export function useUpdateInvestor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<InvestorRow> & { id: string }) => {
      return callInvestorBackend<InvestorRow>(`/investors/${id}`, 'PATCH', updates);
    },
    onSuccess: () => {
      invalidateInvestorRelatedQueries(queryClient, true);
      invalidateInvestorUpdateSideEffects(queryClient);
    },
  });
}

export function useDeleteInvestor() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id || !role) {
        throw new Error('You must be signed in to delete an investor.');
      }

      await deleteInvestorPermanently(id);
    },
    onSuccess: () => {
      invalidateInvestorRelatedQueries(queryClient, true);
    },
  });
}
