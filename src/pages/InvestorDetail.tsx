import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Mail, Phone, Calendar, Building2, User, CreditCard, TrendingUp, Clock, FileText, Edit, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteInvestor, useInvestor } from '@/hooks/useInvestors';
import { CertificateWorkflowCard } from '@/components/certificates/CertificateWorkflowCard';
import { ConfirmInvestorDeleteDialog } from '@/components/investors/ConfirmInvestorDeleteDialog';
import { formatDate, formatInvestorCurrency, getStatusColor } from '@/lib/format';
import { getInvestorCategoryBadgeClass, getInvestorCategoryLabel, getInvestorCategoryShortLabel } from '@/lib/investorCategories';
import { daysUntilMaturity } from '@/types/investment';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getDefaultDashboardPath } from '@/lib/authRoutes';

export default function InvestorDetail() {
  const { id } = useParams();
  const { role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: investor, isLoading, error } = useInvestor(id);
  const deleteInvestor = useDeleteInvestor();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-10 w-64" /><div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><Skeleton className="h-80" /><Skeleton className="h-80 lg:col-span-2" /></div></div>;
  }

  if (error || !investor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <p className="text-muted-foreground">Investor not found.</p>
        <Button variant="outline" asChild><Link to="/investors">← Back to Investors</Link></Button>
      </div>
    );
  }

  const days = daysUntilMaturity(investor.maturity_date);

  let daysText;
  if (days > 0) {
    daysText = `${days} days`;
  } else if (days === 0) {
    daysText = 'Today';
  } else {
    daysText = 'Passed';
  }

  const details = [
    { icon: FileText, label: 'Investor Reference', value: investor.reference_number ? `#${investor.reference_number}` : 'Pending' },
    { icon: Mail, label: 'Email', value: investor.email },
    { icon: Phone, label: 'Phone', value: investor.phone },
    { icon: Calendar, label: 'Date of Birth', value: investor.date_of_birth ? formatDate(investor.date_of_birth) : 'N/A' },
    { icon: User, label: 'Gender', value: investor.gender ?? 'N/A' },
    { icon: Building2, label: 'Bank', value: investor.client_bank },
    { icon: CreditCard, label: 'Account No.', value: investor.client_account_number },
    { icon: User, label: 'Brought By', value: investor.brought_by ?? 'Self' },
    { icon: FileText, label: 'Investor Category', value: getInvestorCategoryLabel(investor.investor_category) },
  ];

  const investmentDetails = [
    { label: 'Investment Amount', value: formatInvestorCurrency(Number(investor.investment_amount), investor) },
    { label: 'Currency', value: investor.currency_code ?? 'NGN' },
    { label: 'Interest Rate', value: `${investor.percentage}%` },
    { label: 'Tenure', value: `${investor.tenure} months` },
    { label: 'Monthly Return', value: formatInvestorCurrency(Number(investor.investment_amount) * (Number(investor.percentage) / 100), investor) },
    { label: 'Total Return', value: formatInvestorCurrency((Number(investor.investment_amount) * (Number(investor.percentage) / 100)) * Number(investor.tenure), investor) },
    { label: 'Investment Type', value: investor.investment_type },
    { label: 'Start Date', value: formatDate(investor.start_date) },
    { label: 'Maturity Date', value: formatDate(investor.maturity_date) },
    { label: 'Expected Maturity Amount', value: formatInvestorCurrency(Number(investor.expected_maturity_amount), investor) },
    { label: 'Days Until Maturity', value: daysText },
  ];

  const canDeleteInvestor = role === 'investment_manager' || role === 'accountant' || role === 'general_manager' || role === 'admin' || role === 'super_admin';

  const handleDeleteInvestor = async () => {
    try {
      await deleteInvestor.mutateAsync(investor.id);
      toast({
        title: 'Investor deleted',
        description: `${investor.name} was removed successfully.`,
      });
      setIsDeleteDialogOpen(false);
      navigate(getDefaultDashboardPath(role), { replace: true });
    } catch (deleteError) {
      toast({
        title: 'Delete failed',
        description: deleteError instanceof Error ? deleteError.message : 'Could not delete the investor record.',
        variant: 'destructive',
      });
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link to="/investors"><ArrowLeft className="w-5 h-5" /></Link></Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-heading font-bold">{investor.name}</h1>
              <Badge variant="secondary" className={getStatusColor(investor.liquidation_status)}>{investor.liquidation_status}</Badge>
              <Badge variant="secondary" className={getInvestorCategoryBadgeClass(investor.investor_category)}>
                {getInvestorCategoryShortLabel(investor.investor_category)} · {getInvestorCategoryLabel(investor.investor_category)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              Added {formatDate(investor.created_at)} · Last updated {formatDate(investor.updated_at)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Reference #{investor.reference_number}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(role === 'investment_manager' || role === 'accountant' || role === 'admin') && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/investors/${investor.id}/edit`}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Link>
            </Button>
          )}
          {canDeleteInvestor && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={deleteInvestor.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Personal Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {details.map((d) => (
              <div key={d.label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                  <d.icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{d.label}</p>
                  <p className="text-sm font-medium">{d.value}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="glass-card lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent" />Investment Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {investmentDetails.map((d) => (
                <div key={d.label} className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs text-muted-foreground mb-1">{d.label}</p>
                  <p className="text-sm font-semibold">{d.value}</p>
                </div>
              ))}
            </div>

            <Separator className="my-4" />

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" />Investment Progress</p>
                <span className="text-xs text-muted-foreground">
                  {Math.max(0, Math.min(100, Math.round(((investor.tenure * 30 - Math.max(0, days)) / (investor.tenure * 30)) * 100)))}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all" style={{
                  width: `${Math.max(0, Math.min(100, ((investor.tenure * 30 - Math.max(0, days)) / (investor.tenure * 30)) * 100))}%`,
                }} />
              </div>
            </div>

            <Separator className="my-4" />

            <div>
              <p className="text-sm font-medium flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-muted-foreground" />Documents</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30 text-sm">
                  <FileText className="w-4 h-4 text-accent" />
                  <span>Investment Certificate</span>
                  <Badge variant="outline" className="text-xs">{investor.investment_certificate_url ? 'Uploaded' : 'Not uploaded'}</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <CertificateWorkflowCard investor={investor} />

      <ConfirmInvestorDeleteDialog
        open={isDeleteDialogOpen}
        investorName={investor.name}
        isDeleting={deleteInvestor.isPending}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={() => void handleDeleteInvestor()}
      />
    </motion.div>
  );
}
