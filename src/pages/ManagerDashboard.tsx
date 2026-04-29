import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCertificateInbox, usePendingApprovals } from '@/hooks/useCertificates';
import { getInvestorCategoryBadgeClass, getInvestorCategoryShortLabel } from '@/lib/investorCategories';

export default function ManagerDashboard() {
  const { data: certificateInbox = [], isLoading } = useCertificateInbox();
  const { data: pendingApprovals = 0 } = usePendingApprovals();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">IN Manager Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Certificates waiting for Investment Manager review.</p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Pending Certificates</span>
            <Badge variant="secondary">{pendingApprovals}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading certificates...</p>}
          {!isLoading && certificateInbox.length === 0 && (
            <p className="text-sm text-muted-foreground">No certificates are waiting for your signature.</p>
          )}
          {certificateInbox.map((item) => (
            <a
              key={item.certificate.id}
              href={item.href}
              target={item.href.startsWith('http') ? '_blank' : undefined}
              rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
              className="block rounded-lg border p-4 hover:bg-secondary/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{item.investor.name}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-muted-foreground">{item.investor.email}</p>
                    {item.investor.category && (
                      <Badge variant="secondary" className={getInvestorCategoryBadgeClass(item.investor.category)}>
                        {getInvestorCategoryShortLabel(item.investor.category)}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge>{item.certificate.status.replace(/_/g, ' ')}</Badge>
              </div>
            </a>
          ))}
          <Link to="/certificates" className="text-sm text-accent hover:underline inline-block pt-2">View all certificates</Link>
        </CardContent>
      </Card>
    </div>
  );
}
