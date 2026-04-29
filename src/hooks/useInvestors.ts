import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';
import type { QueryClient } from '@tanstack/react-query';

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

const SELECTED_COLUMNS = 'id,name,email,phone,date_of_birth,gender,nin,bvn,address,next_of_kin_name,next_of_kin_phone,next_of_kin_relationship,passport_photo_url,currency_code,nin_verification_status,bvn_verification_status,verification_provider,last_verified_at,occupation,source_of_funds,reference_number,investment_amount,start_date,maturity_date,tenure,percentage,investment_type,expected_maturity_amount,client_account_number,client_bank,brought_by,investment_certificate_url,liquidation_status,investor_category,category_reference_name,category_reference_email,category_notes,created_at,updated_at,created_by';
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

function buildGroupedInvestmentTypeSummary(userId: string, investors: DashboardInvestorRow[]) {
  const groupedByType = new Map<string, DashboardInvestmentTypeSummaryRow>();

  for (const investor of investors) {
    const investmentType = investor.investment_type;
    const existing = groupedByType.get(investmentType);

    groupedByType.set(investmentType, {
      user_id: userId,
      investment_type: investmentType,
      investor_count: Number(existing?.investor_count ?? 0) + 1,
      total_investment_value: Number(existing?.total_investment_value ?? 0) + Number(investor.investment_amount ?? 0),
    });
  }

  return Array.from(groupedByType.values()).sort((left, right) =>
    left.investment_type.localeCompare(right.investment_type),
  );
}

async function getDashboardInvestorBaseRows() {
  const { data, error } = await supabase
    .from('investors')
    .select('id,name,investment_amount,maturity_date,liquidation_status,investment_type,created_by,currency_code');

  if (error) throw error;
  return (data ?? []) as DashboardInvestorRow[];
}

async function getVisibleInvestorsForRole(role: string | null | undefined, userId?: string | null) {
  if (role === 'admin') {
    const { data, error } = await supabase
      .from('investors')
      .select(SELECTED_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as InvestorRow[];
  }

  if (!userId) {
    return [] as InvestorRow[];
  }

  const { data, error } = await supabase
    .from('investors')
    .select(SELECTED_COLUMNS)
    .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as InvestorRow[];
}

async function getDashboardInvestorRows(scope: DashboardScope, role: string | null | undefined, userId?: string | null) {
  const investors = await getDashboardInvestorBaseRows();

  if (role === 'admin') {
    if (scope === 'executive' && userId) {
      return investors.filter((investor) => investor.created_by === userId);
    }

    return investors;
  }

  if (!userId) {
    return [] as DashboardInvestorRow[];
  }

  return investors.filter((investor) => investor.created_by === userId);
}

export function useInvestors(page = 0, pageSize = 50) {
  const { role, user } = useAuth();

  return useQuery({
    queryKey: ['investors', page, pageSize, role, user?.id],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const visibleInvestors = await getVisibleInvestorsForRole(role, user?.id);
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
      let visibleInvestors = await getVisibleInvestorsForRole(role, user?.id);

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
  const { data: { user } } = await supabase.auth.getUser();
  let role: string | null = null;

  if (user?.id) {
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    role = roleRow?.role ?? null;
  }

  const { search = '', statusFilter = 'all', typeFilter = 'all', categoryFilter = 'all' } = options;
  let visibleInvestors = await getVisibleInvestorsForRole(role, user?.id);

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
    queryFn: async () => {
      const visibleInvestors = await getVisibleInvestorsForRole(role, user?.id);
      return visibleInvestors
        .filter((investor) => investor.liquidation_status === 'Active')
        .sort((left, right) => new Date(left.maturity_date).getTime() - new Date(right.maturity_date).getTime())
        .slice(page * pageSize, page * pageSize + pageSize)
        .map((investor) => ({
          id: investor.id,
          name: investor.name,
          maturity_date: investor.maturity_date,
          liquidation_status: investor.liquidation_status,
          investment_type: investor.investment_type,
          expected_maturity_amount: investor.expected_maturity_amount,
          client_bank: investor.client_bank,
        })) as MaturityAlertRow[];
    },
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

      const investors = await getDashboardInvestorRows(scope, role, userId);
      const now = new Date();
      const maturingSoon = investors.filter((investor) => {
        if (!investor.maturity_date) return false;
        const maturityDate = new Date(investor.maturity_date);
        const diffDays = Math.ceil((maturityDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 30;
      }).length;
      const foreignCurrencyCodes = Array.from(
        new Set(
          investors
            .map((investor) => (investor.currency_code ?? 'NGN').toUpperCase())
            .filter((currencyCode) => currencyCode !== 'NGN'),
        ),
      ).sort();

      return {
        user_id: userId,
        total_investments: investors.length,
        total_investment_value: investors.reduce((sum, investor) => sum + Number(investor.investment_amount ?? 0), 0),
        active_investments: investors.filter((investor) => investor.liquidation_status === 'Active').length,
        maturing_soon: maturingSoon,
        liquidated_investments: investors.filter((investor) => investor.liquidation_status === 'Liquidated').length,
        foreign_currency_investments: investors.filter((investor) => (investor.currency_code ?? 'NGN').toUpperCase() !== 'NGN').length,
        foreign_currency_codes: foreignCurrencyCodes,
      };
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

      const investors = await getDashboardInvestorRows('staff', role, userId);
      return buildGroupedInvestmentTypeSummary(userId, investors);
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

      const data = await getDashboardInvestorRows(scope, role, userId);
      return buildGroupedInvestmentTypeSummary(userId, data);
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
      const investors = await getDashboardInvestorRows('staff', role, user?.id);

      return investors
        .filter((investor) => investor.liquidation_status === 'Active')
        .sort((left, right) => new Date(left.maturity_date).getTime() - new Date(right.maturity_date).getTime())
        .slice(0, Math.max(limit, 1));
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
      const investors = await getDashboardInvestorRows(scope, role, user?.id);

      return investors
        .filter((investor) => investor.liquidation_status === 'Active')
        .sort((left, right) => new Date(left.maturity_date).getTime() - new Date(right.maturity_date).getTime())
        .slice(0, Math.max(limit, 1));
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
      const visibleInvestors = await getVisibleInvestorsForRole(role, user?.id);
      const investor = visibleInvestors.find((item) => item.id === id);

      if (!investor) {
        throw new Error('Investor not found.');
      }

      return investor;
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

      if (role !== 'admin' && role !== 'investment_manager') {
        throw new Error('Only admin and investment manager can add new investors.');
      }

      const { data, error } = await supabase
        .from('investors')
        .insert({ ...investor, created_by: user.id })
        .select()
        .single();
      if (error) {
        if (error.code === '42501') {
          throw new Error('Your account does not have permission to create investors yet. Please confirm your staff/admin role is present in Supabase.');
        }

        if (error.code === 'PGRST204' || error.code === '42703') {
          throw new Error('The investor form is sending a field that does not match your database schema.');
        }

        throw error;
      }
      return data;
    },
    onSuccess: () => {
      invalidateInvestorRelatedQueries(queryClient);
    },
  });
}

export function useUpdateInvestor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<InvestorRow> & { id: string }) => {
      const { data, error } = await supabase
        .from('investors')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) {
        if (error.code === '42501' || error.code === 'PGRST116') {
          throw new Error('Your account does not yet have permission to update investor records. Please apply the latest database migration and sign in again.');
        }

        throw error;
      }

      if (!data) {
        throw new Error('No investor record was updated. Please confirm the investor still exists and that your role has update access.');
      }

      return data;
    },
    onSuccess: () => {
      invalidateInvestorRelatedQueries(queryClient);
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

      const { data: investor, error: fetchError } = await supabase
        .from('investors')
        .select('id,name,email,created_by')
        .eq('id', id)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!investor) throw new Error('Investor record was not found.');

      const { error: investorCertificateCleanupError } = await supabase
        .from('investor_certificates')
        .delete()
        .eq('investor_id', id);

      if (investorCertificateCleanupError) {
        throw investorCertificateCleanupError;
      }

      const { error } = await supabase.from('investors').delete().eq('id', id);
      if (error) throw error;

      if (role === 'investment_manager' || role === 'general_manager') {
        const executiveUserIds = await getExecutiveUserIds();

        if (executiveUserIds.length) {
          const notificationRows = executiveUserIds.map((recipientUserId) => ({
            user_role: 'ceo',
            title: 'Investor deleted',
            detail: `${role === 'investment_manager' ? 'Investment Manager' : 'General Manager'} deleted investor ${investor.name}.`,
            action_path: '/investors',
            recipient_user_id: recipientUserId,
            is_read: false,
          }));

          const { error: notificationError } = await supabase
            .from('notifications' as never)
            .insert(notificationRows as never);

          if (notificationError) {
            console.error('Failed to notify CEO about investor deletion:', notificationError);
          }
        }
      }
    },
    onSuccess: () => {
      invalidateInvestorRelatedQueries(queryClient, true);
    },
  });
}
