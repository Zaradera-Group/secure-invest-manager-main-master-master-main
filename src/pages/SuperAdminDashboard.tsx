import { useQuery } from '@tanstack/react-query';
import { ArrowRight, UserCog, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import Dashboard from './Dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { PublicIntakeLinkCard } from '@/components/public-intake/PublicIntakeLinkCard';

export default function SuperAdminDashboard() {
  const { data: creatorDirectory = new Map<string, { displayName: string; roleLabel: string }>() } = useQuery({
    queryKey: ['super-admin-creator-directory'],
    queryFn: async () => {
      const [profilesResult, rolesResult] = await Promise.all([
        supabase.from('profiles').select('id, full_name'),
        supabase.from('user_roles').select('user_id, role'),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const profileMap = new Map(
        ((profilesResult.data ?? []) as Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'full_name'>[])
          .map((profile) => [profile.id, profile.full_name?.trim() || null]),
      );

      return new Map(
        ((rolesResult.data ?? []) as Pick<Database['public']['Tables']['user_roles']['Row'], 'user_id' | 'role'>[])
          .map((roleRow) => {
            const roleLabel = formatRoleLabel(roleRow.role);
            const fullName = profileMap.get(roleRow.user_id);

            return [
              roleRow.user_id,
              {
                displayName: fullName || roleLabel,
                roleLabel,
              },
            ];
          }),
      );
    },
  });
  const { data: roleCounts = {} as Record<string, number> } = useQuery<Record<string, number>>({
    queryKey: ['super-admin-role-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role');

      if (error) throw error;

      return (data ?? []).reduce<Record<string, number>>((acc, item) => {
        acc[item.role] = (acc[item.role] ?? 0) + 1;
        return acc;
      }, {});
    },
  });
  const { data: recentInvestorActivity = [] } = useQuery<Array<{
    id: string;
    action: string;
    created_at: string;
    user_id: string | null;
    record_id: string | null;
    investorName: string;
  }>>({
    queryKey: ['super-admin-investor-activity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs' as never)
        .select('id, action, created_at, user_id, record_id, new_data, old_data')
        .eq('table_name', 'investors')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      return ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
        const newData = item.new_data as Record<string, unknown> | null;
        const oldData = item.old_data as Record<string, unknown> | null;
        const investorName =
          (typeof newData?.name === 'string' && newData.name)
          || (typeof oldData?.name === 'string' && oldData.name)
          || 'Unknown investor';

        return {
          id: String(item.id ?? ''),
          action: String(item.action ?? 'UNKNOWN'),
          created_at: String(item.created_at ?? ''),
          user_id: typeof item.user_id === 'string' ? item.user_id : null,
          record_id: typeof item.record_id === 'string' ? item.record_id : null,
          investorName,
        };
      });
    },
  });

  const staffCount =
    (roleCounts.staff ?? 0)
    + (roleCounts.investment_manager ?? 0)
    + (roleCounts.accountant ?? 0)
    + (roleCounts.general_manager ?? 0);

  const cards = [
    { label: 'CEO', value: roleCounts.super_admin ?? 0, icon: UserCog },
    { label: 'Admins', value: roleCounts.admin ?? 0, icon: UserCog },
    { label: 'Staff', value: staffCount, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Executive Oversight Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">See every investor, certificate workflow stage, and staff-recorded activity across the full system.</p>
      </div>

      <PublicIntakeLinkCard
        title="Public Intake Shortcut"
        description="Copy and share the external intake link from the CEO workspace without exposing the internal investor creation flow."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Card key={card.label} className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <card.icon className="w-4 h-4 text-primary" />
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-heading font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-heading">Recent Investor Activity</CardTitle>
            <Link to="/notification-audit" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              Open audit
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentInvestorActivity.length === 0 && (
            <p className="text-sm text-muted-foreground">No investor activity has been recorded yet.</p>
          )}
          {recentInvestorActivity.map((activity) => (
            <div key={activity.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{activity.investorName}</p>
                <p className="text-xs text-muted-foreground">
                  {humanizeAuditAction(activity.action)} by {formatActorLabel(activity.user_id, creatorDirectory)} on {formatAuditTimestamp(activity.created_at)}
                </p>
                {activity.record_id && (
                  <Link to={`/investors/${activity.record_id}`} className="text-xs text-accent hover:underline">
                    Open investor record
                  </Link>
                )}
              </div>
              <Badge variant="outline">{humanizeAuditAction(activity.action)}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dashboard
        scope="all"
        title="Executive Portfolio View"
        description="A full oversight dashboard covering all investor records, maturities, and certificate actions created by staff across the business."
      />
    </div>
  );
}

function formatRoleLabel(role: string | null | undefined) {
  switch (role) {
    case 'investment_manager':
      return 'Investment Manager';
    case 'accountant':
      return 'Accountant';
    case 'general_manager':
      return 'General Manager';
    case 'admin':
      return 'IT Manager';
    case 'super_admin':
      return 'CEO';
    case 'software_engineer':
      return 'Software Engineer';
    case 'staff':
      return 'Staff';
    default:
      return 'Staff';
  }
}

function formatActorLabel(
  userId: string | null,
  creatorDirectory: Map<string, { displayName: string; roleLabel: string }>,
) {
  if (!userId) {
    return 'unknown user';
  }

  const actor = creatorDirectory.get(userId);
  if (!actor) {
    return 'staff member';
  }

  if (actor.displayName === actor.roleLabel) {
    return actor.roleLabel;
  }

  return `${actor.displayName} (${actor.roleLabel})`;
}

function humanizeAuditAction(action: string) {
  switch (action.toUpperCase()) {
    case 'INSERT':
      return 'Created';
    case 'UPDATE':
      return 'Updated';
    case 'DELETE':
      return 'Deleted';
    default:
      return action;
  }
}

function formatAuditTimestamp(timestamp: string) {
  if (!timestamp) {
    return 'unknown time';
  }

  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
