import { useMemo, useState } from 'react';
import { Eye, FileCheck2, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCertificatesList } from '@/hooks/useCertificates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getInvestorCategoryBadgeClass, getInvestorCategoryShortLabel, INVESTOR_CATEGORY_OPTIONS } from '@/lib/investorCategories';

type CertificateRow = {
  id: string;
  investor_name: string;
  investor_email: string;
  amount: number;
  interest_rate: number;
  status: string;
  certificate_url: string | null;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  investor_category?: string | null;
};

const statusLabel = (status: string) => status.split('_').join(' ');

export default function CertificatesList() {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const navigate = useNavigate();

  const { data: certificateRows = [], isLoading } = useCertificatesList();
  const certificates = useMemo(
    () => certificateRows
      .filter((certificate) => categoryFilter === 'all' || certificate.investor_category === categoryFilter)
      .filter((certificate) => statusFilter === 'all' || certificate.status === statusFilter) as CertificateRow[],
    [certificateRows, categoryFilter, statusFilter],
  );

  const stats = useMemo(
    () => ({
      total: certificates.length,
      generated: certificates.filter((certificate) => certificate.status !== 'sent').length,
      approved: certificates.filter((certificate) => certificate.status === 'approved').length,
      sent: certificates.filter((certificate) => certificate.status === 'sent').length,
    }),
    [certificates],
  );

  const generatedCertificates = useMemo(
    () => certificates.filter((certificate) => certificate.status !== 'sent'),
    [certificates],
  );

  const sentCertificates = useMemo(
    () => certificates.filter((certificate) => certificate.status === 'sent'),
    [certificates],
  );

  const [openingCertificateId, setOpeningCertificateId] = useState<string | null>(null);

  const openCertificate = async (certificateId: string) => {
    setOpeningCertificateId(certificateId);

    try {
      navigate(`/certificates/${certificateId}/view`);
    } finally {
      setOpeningCertificateId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Certificates</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review generated certificates, approved records, and investor deliveries from one secure workspace.
        </p>
        {openingCertificateId && (
          <p className="text-sm text-muted-foreground mt-2">Preparing certificate for opening...</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Records" value={stats.total} icon={FileCheck2} />
        <StatCard title="Generated" value={stats.generated} icon={ShieldCheck} />
        <StatCard title="Approved" value={stats.approved} icon={FileCheck2} />
        <StatCard title="Sent" value={stats.sent} icon={MailCheck} />
      </div>

      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All Categories</option>
              {INVESTOR_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.shortLabel} - {option.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="pending_manager">Pending Manager</option>
              <option value="pending_general_manager">Pending General Manager</option>
              <option value="pending_ceo">Pending CEO</option>
              <option value="approved">Approved</option>
              <option value="sent">Sent</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <CertificateSection
        title="Generated Certificates"
        description="Certificates currently in workflow or approved and waiting for final delivery."
        certificates={generatedCertificates}
        isLoading={isLoading}
        openingCertificateId={openingCertificateId}
        onOpen={openCertificate}
      />

      <CertificateSection
        title="Sent Certificates"
        description="Certificates already delivered to investors by email."
        certificates={sentCertificates}
        isLoading={isLoading}
        openingCertificateId={openingCertificateId}
        onOpen={openCertificate}
      />
    </div>
  );
}

function CertificateSection({
  title,
  description,
  certificates,
  isLoading,
  openingCertificateId,
  onOpen,
}: Readonly<{
  title: string;
  description: string;
  certificates: CertificateRow[];
  isLoading: boolean;
  openingCertificateId: string | null;
  onOpen: (certificateId: string) => Promise<void>;
}>) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading certificates...</p>}
        {!isLoading && certificates.length === 0 && (
          <p className="text-sm text-muted-foreground">No certificate records found for this section.</p>
        )}
        {certificates.map((certificate) => (
          <div key={certificate.id} className="rounded-lg border border-slate-200/50 bg-gradient-to-br from-white to-slate-50/50 p-5 hover:shadow-sm transition-shadow">
            <div className="space-y-4">
              {/* Header Row */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Investor</p>
                  <p className="font-semibold text-base text-foreground">{certificate.investor_name}</p>
                  <p className="text-sm text-muted-foreground mt-1">{certificate.investor_email}</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <Badge className="whitespace-nowrap">{statusLabel(certificate.status)}</Badge>
                  {certificate.investor_category && (
                    <Badge variant="secondary" className={getInvestorCategoryBadgeClass(certificate.investor_category)}>
                      {getInvestorCategoryShortLabel(certificate.investor_category)}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                <InfoTile label="Amount" value={new Intl.NumberFormat('en-NG').format(Number(certificate.amount))} />
                <InfoTile label="Interest Rate" value={`${certificate.interest_rate}%`} />
                <InfoTile label="Created" value={new Date(certificate.created_at).toLocaleDateString()} />
                <InfoTile label="Sent" value={certificate.sent_at ? new Date(certificate.sent_at).toLocaleDateString() : 'Pending'} />
              </div>

              {/* Action Button */}
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onOpen(certificate.id)}
                  disabled={openingCertificateId === certificate.id}
                  className="gap-2"
                >
                  {openingCertificateId === certificate.id ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Opening...
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      View Certificate
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
}: Readonly<{
  title: string;
  value: number;
  icon: typeof FileCheck2;
}>) {
  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-2xl font-heading font-bold mt-2">{value}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoTile({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-md bg-slate-100/50 p-3 border border-slate-200/50">
      <p className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-1">{label}</p>
      <p className="font-semibold text-sm text-slate-900">{value}</p>
    </div>
  );
}
