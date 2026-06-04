import { useMemo, useState } from 'react';
import { Check, Copy, RefreshCw, Archive, XCircle, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/format';

type IntakeStatus = 'submitted' | 'reviewed' | 'archived' | 'rejected';

type PublicIntakeRequest = {
  id: string;
  status: IntakeStatus;
  submitted_by_name: string;
  email: string;
  phone: string;
  investment_amount: number;
  start_date: string;
  maturity_date: string;
  tenure: number;
  percentage?: number | null;
  investment_type: string;
  client_account_number: string;
  client_bank: string;
  brought_by?: string | null;
  gender?: string | null;
  address?: string | null;
  currency_code?: string | null;
  occupation?: string | null;
  source_of_funds?: string | null;
  next_of_kin_name?: string | null;
  next_of_kin_phone?: string | null;
  next_of_kin_relationship?: string | null;
  investor_category?: string | null;
  category_reference_name?: string | null;
  category_reference_email?: string | null;
  category_notes?: string | null;
  assigned_email?: string | null;
  review_notes?: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

const statusOrder: IntakeStatus[] = ['submitted', 'reviewed', 'archived', 'rejected'];

export default function PublicIntakeInbox() {
  const { role, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [queryText, setQueryText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | IntakeStatus>('all');
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<PublicIntakeRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['public-intake-requests', role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_intake_requests' as never)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as PublicIntakeRequest[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (payload: { id: string; status: IntakeStatus }) => {
      const { error } = await supabase
        .from('public_intake_requests' as never)
        .update({
          status: payload.status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id ?? null,
          review_notes: notesById[payload.id]?.trim() || null,
        } as never)
        .eq('id', payload.id);

      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['public-intake-requests'] });
      toast({
        title: 'Updated',
        description: 'The intake request status was saved.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Could not update the request.',
        variant: 'destructive',
      });
    },
  });

  const deleteRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('public_intake_requests' as never)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['public-intake-requests'] });
      setDeleteTarget(null);
      toast({
        title: 'Deleted',
        description: 'The public intake submission was removed from the queue.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Could not delete the public intake request.',
        variant: 'destructive',
      });
    },
  });

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      const statusMatches = statusFilter === 'all' || request.status === statusFilter;
      const search = queryText.trim().toLowerCase();
      const textMatches = !search
        || [request.submitted_by_name, request.email, request.phone, request.client_bank, request.investment_type]
          .join(' ')
          .toLowerCase()
          .includes(search);

      return statusMatches && textMatches;
    });
  }, [queryText, requests, statusFilter]);

  const summary = useMemo(() => {
    const counts = {
      submitted: 0,
      reviewed: 0,
      archived: 0,
      rejected: 0,
    };

    for (const request of requests) {
      counts[request.status] += 1;
    }

    return counts;
  }, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent font-semibold">Public Intake</p>
          <h1 className="mt-2 text-2xl md:text-3xl font-heading font-bold">Review Queue</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            These submissions were captured from the public form and are waiting for manual review before any investor record is created.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['public-intake-requests'] })}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statusOrder.map((status) => (
          <Card key={status} className="glass-card">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{status}</p>
              <p className="mt-2 text-2xl font-heading font-bold">{summary[status]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Search name, email, bank, or investment type"
            />
            <div className="flex flex-wrap gap-2">
              {(['all', ...statusOrder] as const).map((status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                >
                  {status}
                </Button>
              ))}
            </div>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Loading public intake requests...</p>}

          {!isLoading && filteredRequests.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">No intake requests match the current filters.</p>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredRequests.map((request) => (
              <Card key={request.id} className="border border-border/70">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{request.submitted_by_name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{request.email} · {request.phone}</p>
                    </div>
                    <Badge variant="outline">{request.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Info label="Amount" value={formatMoney(request.investment_amount, request.currency_code)} />
                    <Info label="Type" value={request.investment_type} />
                    <Info label="Bank" value={request.client_bank} />
                    <Info label="Account" value={request.client_account_number} />
                    <Info label="Gender" value={request.gender ?? 'Not provided'} />
                    <Info label="Address" value={request.address ?? 'Not provided'} />
                    <Info label="Start Date" value={formatDate(request.start_date)} />
                    <Info label="Maturity" value={formatDate(request.maturity_date)} />
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p><span className="text-foreground font-medium">Reference:</span> {request.category_reference_name ?? 'None'} {request.category_reference_email ? `(${request.category_reference_email})` : ''}</p>
                    <p><span className="text-foreground font-medium">Next of Kin:</span> {request.next_of_kin_name ?? 'None'} {request.next_of_kin_phone ? `(${request.next_of_kin_phone})` : ''}</p>
                    <p><span className="text-foreground font-medium">Next of Kin Relationship:</span> {request.next_of_kin_relationship ?? 'None'}</p>
                    <p><span className="text-foreground font-medium">Assigned Email:</span> {request.assigned_email ?? 'Not set'}</p>
                    <p><span className="text-foreground font-medium">Submitted:</span> {formatDate(request.created_at)}</p>
                    {request.reviewed_at && <p><span className="text-foreground font-medium">Reviewed:</span> {formatDate(request.reviewed_at)}</p>}
                  </div>

                  <Textarea
                    placeholder="Optional review notes"
                    value={notesById[request.id] ?? request.review_notes ?? ''}
                    onChange={(e) => setNotesById((current) => ({ ...current, [request.id]: e.target.value }))}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyIntake(request, toast)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy details
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => updateStatus.mutate({ id: request.id, status: 'reviewed' })}
                      disabled={updateStatus.isPending}
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Mark reviewed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatus.mutate({ id: request.id, status: 'archived' })}
                      disabled={updateStatus.isPending}
                    >
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => updateStatus.mutate({ id: request.id, status: 'rejected' })}
                      disabled={updateStatus.isPending}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(request)}
                      disabled={deleteRequest.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-red-700">Delete public intake submission?</DialogTitle>
            <DialogDescription>
              This will permanently remove the public intake record for{' '}
              <span className="font-semibold text-foreground">{deleteTarget?.submitted_by_name ?? 'this investor'}</span>.
              The request will disappear from the review queue and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteRequest.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                void deleteRequest.mutateAsync(deleteTarget.id);
              }}
              disabled={deleteRequest.isPending}
            >
              {deleteRequest.isPending ? 'Deleting...' : 'Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg border bg-secondary/20 p-3">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-words">{value}</p>
    </div>
  );
}

function formatMoney(amount: number, currency?: string | null) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'NGN',
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0));
}

async function copyIntake(request: PublicIntakeRequest, toast: ReturnType<typeof useToast>['toast']) {
  const text = [
    `Name: ${request.submitted_by_name}`,
    `Email: ${request.email}`,
    `Phone: ${request.phone}`,
    `Amount: ${formatMoney(request.investment_amount, request.currency_code)}`,
    `Investment Type: ${request.investment_type}`,
    `Start Date: ${request.start_date}`,
    `Maturity Date: ${request.maturity_date}`,
    `Client Bank: ${request.client_bank}`,
    `Account Number: ${request.client_account_number}`,
    `Status: ${request.status}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: 'The intake details were copied to your clipboard.',
    });
  } catch {
    toast({
      title: 'Copy failed',
      description: 'Your browser blocked clipboard access.',
      variant: 'destructive',
    });
  }
}
