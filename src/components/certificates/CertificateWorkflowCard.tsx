import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, FileCheck2, PenSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { getInvestorCategoryBadgeClass, getInvestorCategoryLabel, getInvestorCategoryShortLabel } from '@/lib/investorCategories';
import { SignaturePad } from '@/components/certificates/SignaturePad';
import {
  type CertificateAction,
  useCertificateApprovalEvents,
  useInvestorCertificate,
  useManageInvestorCertificate,
} from '@/hooks/useCertificates';
import type { Database } from '@/integrations/supabase/types';

type Investor = Database['public']['Tables']['investors']['Row'];

const statusClasses: Record<string, string> = {
  pending_manager: 'bg-orange-100 text-orange-900',
  pending_general_manager: 'bg-amber-100 text-amber-900',
  pending_ceo: 'bg-blue-100 text-blue-900',
  approved: 'bg-emerald-100 text-emerald-900',
  sent: 'bg-emerald-100 text-emerald-900',
};

interface CertificateWorkflowCardProps {
  investor: Investor;
}

function isExecutiveRole(role: string | null | undefined) {
  return role === 'super_admin' || role === 'admin';
}

export function CertificateWorkflowCard({ investor }: Readonly<CertificateWorkflowCardProps>) {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: certificate, isLoading } = useInvestorCertificate({
    name: investor.name,
    email: investor.email,
  });
  const { data: approvalEvents = [] } = useCertificateApprovalEvents(certificate?.id);
  const manageCertificate = useManageInvestorCertificate();
  const [dialogAction, setDialogAction] = useState<CertificateAction | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [latestCertificateUrl, setLatestCertificateUrl] = useState<string | null>(null);
  const [latestCertificateId, setLatestCertificateId] = useState<string | null>(null);
  const [isOpeningCertificate, setIsOpeningCertificate] = useState(false);
  const [justSigned, setJustSigned] = useState(false);
  const isDirectCeoFlow = isExecutiveRole(role) && certificate?.status === 'pending_ceo' && certificate.created_by === user?.id;

  const availableActions = useMemo(() => {
    if (!role) return [] as Array<{ action: CertificateAction; label: string; icon: typeof FileCheck2; requiresSignature?: boolean }>;

    const actions: Array<{ action: CertificateAction; label: string; icon: typeof FileCheck2; requiresSignature?: boolean }> = [];

    if (!certificate && (role === 'investment_manager' || isExecutiveRole(role))) {
      actions.push({ action: 'generate', label: 'Create Certificate', icon: FileCheck2 });
    }

    if (role === 'admin' && certificate?.status === 'pending_manager') {
      actions.push({ action: 'approve_investment_manager', label: 'Sign as Investment Manager', icon: PenSquare, requiresSignature: true });
    }

    if (role === 'investment_manager' && certificate?.status === 'pending_manager') {
      actions.push({ action: 'approve_investment_manager', label: 'Sign and Submit to General Manager', icon: PenSquare, requiresSignature: true });
    }

    if (role === 'admin' && certificate?.status === 'approved') {
      actions.push({ action: 'send', label: 'Send Certificate to Investor', icon: CheckCircle2 });
    }

    if (role === 'investment_manager' && certificate?.status === 'approved') {
      actions.push({ action: 'send', label: 'Send Certificate to Investor', icon: CheckCircle2 });
    }

    if (role === 'admin' && certificate?.status === 'pending_general_manager') {
      actions.push({ action: 'approve_general_manager', label: 'Sign as General Manager', icon: PenSquare, requiresSignature: true });
    }

    if (role === 'general_manager' && certificate?.status === 'pending_general_manager') {
      actions.push({ action: 'approve_general_manager', label: 'Sign and Submit to CEO', icon: PenSquare, requiresSignature: true });
    }

    if (isExecutiveRole(role) && certificate?.status === 'pending_ceo') {
      actions.push({
        action: 'approve_ceo',
        label: isDirectCeoFlow ? 'Sign and Send to Investor' : 'Review and Approve Certificate',
        icon: CheckCircle2,
        requiresSignature: isDirectCeoFlow,
      });
    }

    return actions;
  }, [certificate, isDirectCeoFlow, role]);

  const currentStepHelp = useMemo(() => {
    if (!certificate) {
      return 'Create the certificate first to begin the approval workflow.';
    }

    if (role === 'investment_manager' && certificate.status === 'pending_manager') {
      return 'Add the Investment Manager signature, then submit it to the General Manager.';
    }

    if (role === 'admin' && certificate.status === 'pending_manager') {
      return 'Add the Investment Manager signature to move this certificate to the General Manager stage.';
    }

    if (role === 'admin' && (certificate.status === 'approved' || certificate.status === 'sent')) {
      return certificate.status === 'approved'
        ? 'This certificate has completed approval and is ready for final sending to the investor.'
        : 'This certificate has been sent to the investor.';
    }

    if (role === 'general_manager' && certificate.status === 'pending_manager') {
      return 'This certificate is still waiting for the Investment Manager signature before you can review and sign it.';
    }

    if (role === 'general_manager' && certificate.status === 'pending_general_manager') {
      return 'Add the General Manager signature here, then submit it to the CEO for review.';
    }

    if (role === 'admin' && certificate.status === 'pending_general_manager') {
      return 'Add the General Manager signature here to move this certificate to the CEO approval stage.';
    }

    if (isExecutiveRole(role) && certificate.status === 'pending_ceo') {
      return isDirectCeoFlow
        ? 'Add the CEO signature and send the certificate directly to the investor.'
        : 'Review the certificate and approve it so it returns to the Investment Manager for final sending.';
    }

    if (role === 'investment_manager' && certificate.status === 'approved') {
      return 'The CEO has approved this certificate. Send it to the investor from here.';
    }

    return 'This certificate is waiting for the next workflow step.';
  }, [certificate, isDirectCeoFlow, role]);

  const runAction = async (action: CertificateAction, signature?: string | null) => {
    try {
      const result = await manageCertificate.mutateAsync({
        investor: {
          id: investor.id,
          name: investor.name,
          email: investor.email,
          phone: investor.phone,
          currency_code: investor.currency_code,
          reference_number: investor.reference_number,
          investment_amount: Number(investor.investment_amount),
          percentage: Number(investor.percentage),
          tenure: Number(investor.tenure),
          investment_type: investor.investment_type,
          maturity_date: investor.maturity_date,
          expected_maturity_amount: Number(investor.expected_maturity_amount),
        },
        certificateId: certificate?.id,
        action,
        signatureDataUrl: signature ?? undefined,
        notes: notes || undefined,
        issueDate,
      });

      if (result.certificateUrl) {
        setLatestCertificateUrl(result.certificateUrl);
      }

      if (result.certificateId) {
        setLatestCertificateId(result.certificateId);
      }

      // Set justSigned flag for signing actions
      const signingActions: CertificateAction[] = ['approve_investment_manager', 'approve_general_manager', 'approve_ceo'];
      if (signingActions.includes(action)) {
        setJustSigned(true);
      }

      toast({
        title: 'Certificate updated',
        description: result.message,
      });

      setDialogAction(null);
      setSignatureDataUrl(null);
      setNotes('');
    } catch (error) {
      toast({
        title: 'Certificate action failed',
        description: error instanceof Error ? error.message : 'Could not complete this certificate action.',
        variant: 'destructive',
      });
    } finally {
      setSignatureDataUrl(null);
      setNotes('');
    }
  };

  const openActionDialog = (action: CertificateAction) => {
    setJustSigned(false);
    setDialogAction(action);
    setSignatureDataUrl(null);
    setNotes('');
    setIssueDate(new Date().toISOString().split('T')[0]);
  };

  const needsSignature = dialogAction === 'approve_investment_manager'
    || dialogAction === 'approve_general_manager';
  const requiresCeoSignature = dialogAction === 'approve_ceo' && isDirectCeoFlow;
  const requiresSignature = needsSignature || requiresCeoSignature;
  const openLatestCertificate = async () => {
    const certificateIdToOpen = latestCertificateId ?? certificate?.id ?? null;

    if (!certificateIdToOpen) {
      toast({
        title: 'Certificate not ready',
        description: 'Please create a certificate first.',
        variant: 'destructive',
      });
      return;
    }

    setIsOpeningCertificate(true);
    try {
      navigate(`/certificates/${certificateIdToOpen}/view`);
    } finally {
      setIsOpeningCertificate(false);
    }
  };

  return (
    <>
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-heading">Certificate Workflow</CardTitle>
            <Badge variant="secondary" className={statusClasses[certificate?.status ?? 'pending_manager'] ?? 'bg-secondary text-secondary-foreground'}>
              {humanizeToken(certificate?.status ?? 'not_created')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!certificate && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              No certificate has been created for this investor yet. Start the workflow here.
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/50">
                <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-2">Date of Issue</p>
                <p className="text-sm font-semibold text-blue-900">{formatDate(certificate?.created_at ?? issueDate)}</p>
              </div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/50">
                <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide mb-2">Investment Amount</p>
                <p className="text-sm font-semibold text-emerald-900">{formatCurrency(Number(investor.investment_amount), investor.currency_code)}</p>
              </div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100/50 border border-purple-200/50">
                <p className="text-xs font-medium text-purple-600 uppercase tracking-wide mb-2">Interest Rate</p>
                <p className="text-sm font-semibold text-purple-900">{Number(investor.percentage).toFixed(2)}%</p>
              </div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/50">
                <p className="text-xs font-medium text-amber-600 uppercase tracking-wide mb-2">Category</p>
                <Badge variant="secondary" className={getInvestorCategoryBadgeClass(investor.investor_category)}>
                  {getInvestorCategoryShortLabel(investor.investor_category)}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Approval Checklist</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">Investment Manager</p>
                  <p className="text-xs text-slate-500">Signature Required</p>
                </div>
                <Badge variant={certificate?.manager_signature ? 'default' : 'secondary'} className="whitespace-nowrap">
                  {certificate?.manager_signature ? '✓ Done' : 'Pending'}
                </Badge>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">General Manager</p>
                  <p className="text-xs text-slate-500">Signature Required</p>
                </div>
                <Badge variant={certificate?.general_manager_signature ? 'default' : 'secondary'} className="whitespace-nowrap">
                  {certificate?.general_manager_signature ? '✓ Done' : 'Pending'}
                </Badge>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">CEO Approval</p>
                  <p className="text-xs text-slate-500">Final Approval</p>
                </div>
                <Badge variant={certificate?.approved_at || certificate?.sent_at ? 'default' : 'secondary'} className="whitespace-nowrap">
                  {certificate?.approved_at || certificate?.sent_at ? '✓ Approved' : 'Pending'}
                </Badge>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">Investor Delivery</p>
                  <p className="text-xs text-slate-500">Sent to Investor</p>
                </div>
                <Badge variant={certificate?.sent_at ? 'default' : 'secondary'} className="whitespace-nowrap">
                  {certificate?.sent_at ? `✓ Sent` : 'Pending'}
                </Badge>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-primary/15 bg-primary/5 p-3 text-sm text-foreground">
            {currentStepHelp}
          </div>

          {(latestCertificateUrl || certificate?.certificate_url || certificate) && (
            <div className={`rounded-lg border p-4 ${latestCertificateUrl ? 'border-emerald-300 bg-emerald-50' : 'border-blue-200 bg-blue-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`font-semibold ${latestCertificateUrl ? 'text-emerald-900' : 'text-blue-900'}`}>
                  {latestCertificateUrl ? '✓ Certificate Ready to View' : '📄 Certificate Available'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={latestCertificateUrl ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => void openLatestCertificate()}
                  disabled={(!latestCertificateId && !certificate?.id) || isOpeningCertificate || manageCertificate.isPending}
                >
                  {isOpeningCertificate ? 'Opening...' : (latestCertificateUrl ? 'View Updated Certificate' : 'View Current Certificate')}
                </Button>
                {certificate && role === 'general_manager' && certificate.status === 'pending_general_manager' && (
                  <p className="text-blue-900 text-sm self-center">
                    Review the certificate, then sign and submit it to the CEO.
                  </p>
                )}
                {latestCertificateUrl && role === 'investment_manager' && certificate?.status === 'approved' && (
                  <p className="text-emerald-900 text-sm self-center">
                    Certificate approved. Ready to send to investor.
                  </p>
                )}
              </div>
            </div>
          )}

          {justSigned && certificate && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-green-900">
                  🎉 Certificate Signed Successfully
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void openLatestCertificate()}
                  disabled={(!latestCertificateId && !certificate?.id) || isOpeningCertificate || manageCertificate.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  {isOpeningCertificate ? 'Opening...' : 'View Certificate with Your Signature'}
                </Button>
                <p className="text-green-900 text-sm self-center">
                  Your signature has been added to the certificate. Click above to view it.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Available Actions</p>
            <div className="flex flex-wrap gap-2">
            {availableActions.map(({ action, label, icon: Icon, requiresSignature }) => (
              <Button
                key={action}
                type="button"
                variant="outline"
                onClick={() => (requiresSignature || action === 'generate' ? openActionDialog(action) : runAction(action))}
                disabled={manageCertificate.isPending || isLoading}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </Button>
            ))}
            {availableActions.length === 0 && (
              <p className="text-sm text-muted-foreground">No action is required from your role on this certificate right now.</p>
            )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Workflow Notifications</p>
            {approvalEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workflow notifications yet.</p>
            ) : (
              approvalEvents.map((event) => (
                <div key={event.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="font-medium">{humanizeToken(event.user_role)}</p>
                    <p className="text-muted-foreground">{formatDate(event.created_at)}</p>
                  </div>
                  <p className="text-muted-foreground mt-1">{event.message}</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!dialogAction} onOpenChange={(open) => !open && setDialogAction(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Complete Certificate Step</DialogTitle>
              <DialogDescription>
                {getDialogDescription(dialogAction, isDirectCeoFlow)}
              </DialogDescription>
            </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="certificate-issue-date">Date of Issue</Label>
                <Input
                  id="certificate-issue-date"
                  type="date"
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                  min="2000-01-01"
                  max={new Date().toISOString().split('T')[0]}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Interest Rate</Label>
                <Input value={`${Number(investor.percentage).toFixed(2)}%`} readOnly />
              </div>
            </div>

            {requiresSignature && (
              <div className="space-y-2">
                <Label>Digital Signature</Label>
                <SignaturePad onChange={setSignatureDataUrl} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="certificate-notes">Notes</Label>
              <Textarea
                id="certificate-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional workflow notes."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogAction(null)}>
              Cancel
            </Button>
              <Button
                type="button"
                onClick={() => dialogAction && runAction(dialogAction, signatureDataUrl)}
                disabled={manageCertificate.isPending || (requiresSignature && !signatureDataUrl)}
              >
                {manageCertificate.isPending ? 'Processing...' : 'Confirm'}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

function humanizeToken(value: string) {
  return value.split('_').join(' ');
}

function getDialogDescription(dialogAction: CertificateAction | null, isDirectCeoFlow: boolean) {
  if (dialogAction === 'generate') {
    return 'Create the certificate record and start the approval workflow.';
  }

  if (dialogAction === 'approve_ceo') {
    return isDirectCeoFlow
      ? 'Add the CEO signature and send this certificate directly to the investor.'
      : 'Review the certificate and approve it so it returns to the Investment Manager for final sending.';
  }

  return 'Add the required signature and continue the workflow.';
}
