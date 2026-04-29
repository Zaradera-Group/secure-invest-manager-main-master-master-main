import { useQuery } from '@tanstack/react-query';
import { UserCog, Users } from 'lucide-react';
import Dashboard from './Dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

export default function SuperAdminDashboard() {
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

  const staffCount =
    (roleCounts.staff ?? 0)
    + (roleCounts.investment_manager ?? 0)
    + (roleCounts.general_manager ?? 0);

  const cards = [
    { label: 'Admins', value: roleCounts.admin ?? 0, icon: UserCog },
    { label: 'Staff', value: staffCount, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Personal Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Your private admin workspace showing only the investors and certificates tied to your own activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      <Dashboard
        scope="executive"
        title="Personal Admin Dashboard"
        description="A private dashboard for your own admin-managed investor activity."
      />
    </div>
  );
}
