import { motion } from 'framer-motion';
import {
  TrendingUp,
  Users,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Copy,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatInvestorCurrency, formatDate, getStatusColor } from '@/lib/format';
import {
  useDashboardPortfolioSummary,
  useDashboardInvestmentTypeSummaryByScope,
  useDashboardUpcomingMaturitiesByScope,
} from '@/hooks/useInvestors';
import { useCertificateInbox, usePendingApprovals } from '@/hooks/useCertificates';
import { useDashboardNotifications, useMarkDashboardNotificationRead } from '@/hooks/useDashboardNotifications';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { daysUntilMaturity } from '@/types/investment';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2 } },
};

type DashboardScope = 'staff' | 'executive' | 'all';

type DashboardProps = {
  scope?: DashboardScope;
  title?: string;
  description?: string;
};

export default function Dashboard({
  scope = 'staff',
  title = 'Dashboard',
  description = "Welcome back. Here's your investment overview.",
}: DashboardProps) {
  const { role } = useAuth();
  const { toast } = useToast();
  const { data: portfolioSummary, isLoading: isSummaryLoading } = useDashboardPortfolioSummary(scope);
  const { data: upcomingMaturities = [], isLoading: isUpcomingLoading } = useDashboardUpcomingMaturitiesByScope(5, scope);
  const { data: investmentTypeSummary = [], isLoading: isTypeSummaryLoading } = useDashboardInvestmentTypeSummaryByScope(scope);
  const { data: certificateInbox = [], isLoading: isCertificateInboxLoading } = useCertificateInbox(scope);
  const { data: dashboardNotifications = [], isLoading: isDashboardNotificationsLoading } = useDashboardNotifications(5);
  const markDashboardNotificationRead = useMarkDashboardNotificationRead();
  const { data: pendingApprovals = 0 } = usePendingApprovals(scope);
  const isLoading = isSummaryLoading || isUpcomingLoading || isTypeSummaryLoading;
  const foreignCurrencyCodes = useMemo(() => portfolioSummary?.foreign_currency_codes ?? [], [portfolioSummary?.foreign_currency_codes]);
  const hasForeignCurrency = foreignCurrencyCodes.length > 0;

  const stats = useMemo(() => {
    const baseStats = [
      {
        label: 'Total Investments',
        value: formatCurrency(Number(portfolioSummary?.total_investment_value ?? 0), 'NGN'),
        change: `${portfolioSummary?.total_investments ?? 0} records`,
        note: hasForeignCurrency ? `Includes foreign currencies: ${foreignCurrencyCodes.join(', ')}` : null,
        up: true,
        icon: TrendingUp,
      },
      {
        label: 'Active Investors',
        value: String(portfolioSummary?.active_investments ?? 0),
        change: 'Currently active',
        up: true,
        icon: Users,
      },
      {
        label: 'Maturing Soon',
        value: String(portfolioSummary?.maturing_soon ?? 0),
        change: 'Next 30 days',
        up: false,
        icon: Clock,
      },
      {
        label: 'Liquidated',
        value: String(portfolioSummary?.liquidated_investments ?? 0),
        change: 'Total',
        up: false,
        icon: AlertTriangle,
      },
    ];

    if (pendingApprovals > 0) {
      baseStats.splice(2, 0, {
        label: 'Pending Approvals',
        value: String(pendingApprovals),
        change: 'Require your action',
        up: false,
        icon: AlertTriangle,
      });
    }

    return baseStats;
  }, [foreignCurrencyCodes, hasForeignCurrency, pendingApprovals, portfolioSummary]);

  const urgentUpcomingMaturities = useMemo(
    () => upcomingMaturities.filter((investor) => {
      const days = daysUntilMaturity(investor.maturity_date);
      return days >= 0 && days <= 5;
    }),
    [upcomingMaturities],
  );

  const generalManagerCertificateNotifications = useMemo(
    () =>
      role === 'general_manager'
        ? dashboardNotifications.filter(
            (notification) => notification.user_role === 'general_manager' && !!notification.action_path,
          )
        : [],
    [dashboardNotifications, role],
  );

  const investmentTypeMap = useMemo(
    () => new Map(investmentTypeSummary.map((entry) => [entry.investment_type, entry])),
    [investmentTypeSummary],
  );

  const investmentTypeChartData = useMemo(
    () => {
      const typeOrder = ['Upfront', 'Monthly', 'Quarterly', 'At Maturity'] as const;

      return typeOrder.map((type) => {
        const entry = investmentTypeMap.get(type);
        return {
          name: type,
          investors: Number(entry?.investor_count ?? 0),
          value: Number(entry?.total_investment_value ?? 0),
        };
      });
    },
    [investmentTypeMap],
  );

  const pieColors = ['#f97316', '#0f766e', '#2563eb', '#7c3aed'];
  const hasChartData = investmentTypeChartData.some((entry) => entry.investors > 0 || entry.value > 0);
  const canUsePublicIntakeTools = !!role && ['investment_manager', 'accountant', 'general_manager', 'super_admin', 'admin'].includes(role);
  const publicIntakeLink = `${globalThis.location.origin}/investor-intake`;

  const handleCopyPublicIntakeLink = async () => {
    try {
      await navigator.clipboard.writeText(publicIntakeLink);
      toast({
        title: 'Copied',
        description: 'Public intake link copied to clipboard.',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32 md:h-8 md:w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
          {[1, 2, 3, 4].map((value) => <Skeleton key={value} className="h-24 md:h-28" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <Skeleton className="h-64 lg:col-span-2" />
          <div className="space-y-3 md:space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" exit="exit" className="space-y-4 md:space-y-6">
      <motion.div variants={item}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-heading font-bold">{title}</h1>
            <p className="text-muted-foreground text-sm mt-1">{description}</p>
          </div>
          {canUsePublicIntakeTools && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/public-intake-inbox">Public Intake Inbox</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopyPublicIntakeLink}>
                <Copy className="w-4 h-4 mr-2" />
                Copy public intake link
              </Button>
            </div>
          )}
        </div>
        {hasForeignCurrency && (
          <div className="mt-3">
            <Badge variant="outline">
              Foreign currency on this dashboard: {foreignCurrencyCodes.join(', ')}
            </Badge>
          </div>
        )}
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardContent className="p-4 md:p-5">
              <div className="flex items-center justify-between mb-2 md:mb-3">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <stat.icon className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                </div>
                <span className={`text-xs font-medium flex items-center gap-1 ${stat.up ? 'text-success' : 'text-muted-foreground'}`}>
                  {stat.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  <span className="hidden sm:inline">{stat.change}</span>
                </span>
              </div>
              <p className="text-xl md:text-2xl font-heading font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              {'note' in stat && stat.note && (
                <p className="text-[11px] text-amber-700 mt-2">{stat.note}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg font-heading">Upcoming Maturities</CardTitle>
                <Link to="/investors" className="text-xs text-accent hover:underline font-medium">View all -&gt;</Link>
              </div>
            </CardHeader>
            <CardContent className="p-0 md:p-6">
              <div className="block lg:hidden space-y-3 p-4">
                {upcomingMaturities.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No active investments yet. Add your first investment to get started.</p>
                )}
                {upcomingMaturities.map((investor) => {
                  const days = daysUntilMaturity(investor.maturity_date);
                  const isUrgent = days <= 5 && days >= 0;
                  let daysText = 'Passed';

                  if (days > 0) {
                    daysText = `${days} days`;
                  } else if (days === 0) {
                    daysText = 'Today';
                  }

                  return (
                    <Link
                      key={investor.id}
                      to={`/investors/${investor.id}`}
                      className="block p-3 rounded-lg border hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium truncate">{investor.name}</span>
                        <Badge variant="secondary" className={getStatusColor(investor.liquidation_status)}>
                          {investor.liquidation_status}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Amount:</span>
                          <span className="font-medium">{formatInvestorCurrency(Number(investor.investment_amount), investor)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Maturity:</span>
                          <span>{formatDate(investor.maturity_date)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Days left:</span>
                          <span className={isUrgent ? 'text-accent font-semibold' : ''}>{daysText}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="hidden md:block lg:hidden">
                <div className="space-y-1 p-4">
                  <div className="grid grid-cols-4 gap-3 text-xs font-medium text-muted-foreground mb-3">
                    <span>Investor</span><span>Amount</span><span>Days Left</span><span>Status</span>
                  </div>
                  {upcomingMaturities.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">No active investments yet. Add your first investment to get started.</p>
                  )}
                  {upcomingMaturities.map((investor) => {
                    const days = daysUntilMaturity(investor.maturity_date);
                    const isUrgent = days <= 5 && days >= 0;
                    let daysText = 'Passed';

                    if (days > 0) {
                      daysText = `${days} days`;
                    } else if (days === 0) {
                      daysText = 'Today';
                    }

                    return (
                      <Link
                        key={investor.id}
                        to={`/investors/${investor.id}`}
                        className="grid grid-cols-4 gap-3 text-sm p-3 rounded-lg hover:bg-secondary/50 transition-colors items-center"
                      >
                        <span className="font-medium truncate">{investor.name}</span>
                        <span className="text-sm">{formatInvestorCurrency(Number(investor.investment_amount), investor)}</span>
                        <span className={isUrgent ? 'text-accent font-semibold' : ''}>{daysText}</span>
                        <Badge variant="secondary" className={getStatusColor(investor.liquidation_status)}>
                          {investor.liquidation_status}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="hidden lg:block">
                <div className="space-y-1">
                  <div className="grid grid-cols-5 gap-4 text-xs font-medium text-muted-foreground px-3 py-2">
                    <span>Investor</span><span>Amount</span><span>Maturity Date</span><span>Days Left</span><span>Status</span>
                  </div>
                  {upcomingMaturities.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">No active investments yet. Add your first investment to get started.</p>
                  )}
                  {upcomingMaturities.map((investor) => {
                    const days = daysUntilMaturity(investor.maturity_date);
                    const isUrgent = days <= 5 && days >= 0;
                    let daysText = 'Passed';

                    if (days > 0) {
                      daysText = `${days} days`;
                    } else if (days === 0) {
                      daysText = 'Today';
                    }

                    return (
                      <Link
                        key={investor.id}
                        to={`/investors/${investor.id}`}
                        className="grid grid-cols-5 gap-4 text-sm px-3 py-3 rounded-lg hover:bg-secondary/50 transition-colors items-center"
                      >
                        <span className="font-medium truncate">{investor.name}</span>
                        <span>{formatInvestorCurrency(Number(investor.investment_amount), investor)}</span>
                        <span className="text-muted-foreground">{formatDate(investor.maturity_date)}</span>
                        <span className={isUrgent ? 'text-accent font-semibold' : ''}>{daysText}</span>
                        <Badge variant="secondary" className={getStatusColor(investor.liquidation_status)}>
                          {investor.liquidation_status}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item} className="space-y-3 md:space-y-4">
          {role === 'general_manager' && (
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base md:text-lg font-heading">Certificate Attention Needed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isDashboardNotificationsLoading && (
                  <p className="text-sm text-muted-foreground">Loading certificate alerts...</p>
                )}
                {!isDashboardNotificationsLoading && generalManagerCertificateNotifications.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No certificate alerts need your attention right now.
                  </p>
                )}
                {generalManagerCertificateNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-amber-950">{notification.title}</p>
                        <p className="text-xs text-amber-900 mt-1">{notification.detail}</p>
                        <p className="text-[11px] text-amber-800 mt-2">{formatDate(notification.created_at)}</p>
                      </div>
                      {notification.is_read ? (
                        <Badge variant="outline">Viewed</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-950">
                          New
                        </Badge>
                      )}
                    </div>
                    {notification.action_path && (
                      <div className="mt-3">
                        <Button asChild size="sm">
                          <Link
                            to={notification.action_path}
                            onClick={() => {
                              if (!notification.is_read) {
                                markDashboardNotificationRead.mutate(notification.id);
                              }
                            }}
                          >
                            Open Investor Details
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg font-heading">Alerts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {urgentUpcomingMaturities.map((investor) => (
                <div key={investor.id} className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/20">
                  <AlertTriangle className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{investor.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Matures in {daysUntilMaturity(investor.maturity_date)} days · {formatInvestorCurrency(Number(investor.investment_amount), investor)}
                    </p>
                  </div>
                </div>
              ))}
              {urgentUpcomingMaturities.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No urgent alerts</p>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg font-heading">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(['Upfront', 'Monthly', 'Quarterly', 'At Maturity'] as const).map((type) => {
                const summary = investmentTypeMap.get(type);

                return (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{type}</span>
                    <span className="font-medium">
                      {summary?.investor_count ?? 0} · {formatCurrency(Number(summary?.total_investment_value ?? 0), 'NGN')}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
        <motion.div variants={item}>
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg font-heading">Investment Value by Type</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {hasChartData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={investmentTypeChartData}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `${Number(value) / 1000000}m`} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value), 'NGN')} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {investmentTypeChartData.map((entry, index) => (
                        <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  No investment data yet for charting.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg font-heading">Investor Mix by Type</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {hasChartData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={investmentTypeChartData} dataKey="investors" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                      {investmentTypeChartData.map((entry, index) => (
                        <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value} investors`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Investor mix will appear once records are available.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {role && ['investment_manager', 'accountant', 'general_manager', 'super_admin', 'admin'].includes(role) && (
        <motion.div variants={item}>
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg font-heading">Certificate Workflow Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isCertificateInboxLoading && (
                <p className="text-sm text-muted-foreground">Loading certificate queue...</p>
              )}
              {!isCertificateInboxLoading && certificateInbox.length === 0 && (
                <p className="text-sm text-muted-foreground">No certificates are waiting for your action right now.</p>
              )}
              {certificateInbox.map((item) => (
                <a
                  key={item.certificate.id}
                  href={item.href}
                  target={item.href.startsWith('http') ? '_blank' : undefined}
                  rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3 hover:bg-secondary/40 transition-colors"
                >
                  <div>
                    <p className="font-medium">{item.investor.name}</p>
                      <p className="text-sm text-muted-foreground">
                      {item.nextActionLabel} · {item.certificate.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <Badge variant="outline">{item.investor.email}</Badge>
                </a>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
