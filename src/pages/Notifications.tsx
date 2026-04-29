import { motion } from 'framer-motion';
import { Bell, CheckCircle, AlertTriangle, Clock, CircleDot, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';
import { useMaturityAlerts } from '@/hooks/useInvestors';
import { formatDate, formatNaira } from '@/lib/format';
import { daysUntilMaturity } from '@/types/investment';
import {
  useDashboardNotifications,
  useMarkAllDashboardNotificationsRead,
  useMarkDashboardNotificationRead,
} from '@/hooks/useDashboardNotifications';

export default function Notifications() {
  const [page, setPage] = useState(0);
  const { data: investors = [], isLoading: isMaturityLoading } = useMaturityAlerts(page, 20);
  const { data: dashboardNotifications = [], isLoading: isDashboardLoading } = useDashboardNotifications(25);
  const markRead = useMarkDashboardNotificationRead();
  const markAllRead = useMarkAllDashboardNotificationsRead();

  const handleOpenNotification = (notificationId: string, isRead: boolean) => {
    if (!isRead) {
      markRead.mutate(notificationId);
    }
  };

  const maturityNotifications = investors
    .filter((i) => i.liquidation_status === 'Active')
    .map((i) => {
      const days = daysUntilMaturity(i.maturity_date);
      return { ...i, daysLeft: days };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((i) => ({
      id: i.id,
      title:
        i.daysLeft <= 0
          ? `${i.name}'s investment has matured`
          : i.daysLeft <= 5
            ? `${i.name}'s investment matures in ${i.daysLeft} days`
            : `${i.name}'s investment matures on ${formatDate(i.maturity_date)}`,
      description: `${formatNaira(Number(i.expected_maturity_amount))} · ${i.investment_type} · ${i.client_bank}`,
      type: i.daysLeft <= 0 ? 'matured' : i.daysLeft <= 5 ? 'urgent' : 'info',
      time: i.daysLeft <= 0 ? 'Matured' : `${i.daysLeft} days left`,
    }));

  const isLoading = isMaturityLoading || isDashboardLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6 max-w-4xl"
    >
      <div>
        <h1 className="text-2xl font-heading font-bold">Notifications</h1>
        <p className="text-muted-foreground text-sm mt-1">Role-targeted certificate updates and investment maturity alerts.</p>
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Bell className="w-4 h-4 text-accent" />
              Certificate Workflow Alerts
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending || dashboardNotifications.every((notification) => notification.is_read)}
            >
              <CheckCheck className="w-4 h-4 mr-2" />
              Mark all as read
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {dashboardNotifications.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No certificate workflow alerts assigned to you right now.
            </p>
          )}

          {dashboardNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`rounded-lg border p-4 transition-colors ${
                notification.is_read ? 'bg-secondary/20 border-border/50' : 'bg-accent/5 border-accent/20'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {notification.is_read ? (
                    <CircleDot className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{notification.title}</p>
                      {!notification.is_read && <Badge variant="secondary" className="bg-accent/10 text-accent">New</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{notification.detail}</p>
                    <p className="text-xs text-muted-foreground mt-2">{formatDate(notification.created_at)}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {notification.action_path && (
                    <Button asChild size="sm">
                      <Link
                        to={notification.action_path}
                        onClick={() => handleOpenNotification(notification.id, notification.is_read)}
                      >
                        Open
                      </Link>
                    </Button>
                  )}
                  {!notification.is_read && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => markRead.mutate(notification.id)}
                      disabled={markRead.isPending}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            Investment Maturity Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {maturityNotifications.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No maturity alerts yet. Alerts will appear as investments approach maturity.
            </p>
          )}

          {maturityNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`flex items-start gap-3 p-4 rounded-lg border transition-colors ${
                notification.type === 'urgent'
                  ? 'bg-accent/5 border-accent/20'
                  : notification.type === 'matured'
                    ? 'bg-success/5 border-success/20'
                    : 'bg-secondary/30 border-border/50'
              }`}
            >
              {notification.type === 'urgent' ? (
                <AlertTriangle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
              ) : notification.type === 'matured' ? (
                <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              ) : (
                <Clock className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">{notification.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{notification.description}</p>
              </div>
              <Badge
                variant="secondary"
                className={
                  notification.type === 'urgent'
                    ? 'bg-accent/10 text-accent'
                    : notification.type === 'matured'
                      ? 'bg-success/10 text-success'
                      : ''
                }
              >
                {notification.time}
              </Badge>
            </div>
          ))}

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground">Showing up to 20 maturity alerts per page</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={maturityNotifications.length < 20}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
