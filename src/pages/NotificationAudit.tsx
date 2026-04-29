import { type ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Clock, Filter, Mail, MessageSquare, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminNotificationAction,
  useArchivedEmailNotifications,
  useArchivedJobRuns,
  useArchivedNotificationJobs,
  useEmailNotifications,
  useJobRuns,
  useNotificationJobs,
} from '@/hooks/useNotifications';
import { useToast } from '@/hooks/use-toast';
import { formatDate, formatNaira } from '@/lib/format';

type AdminActionPayload = {
  action:
    | 'retry_failed_jobs'
    | 'process_queue_now'
    | 'queue_reminders_now'
    | 'retry_single_job'
    | 'retry_selected_jobs'
    | 'cancel_single_job'
    | 'cancel_selected_jobs';
  batchSize?: number;
  jobId?: string;
  jobIds?: string[];
};

type RunResult = {
  id: string;
  status: string;
  notificationType: string;
  recipient?: string | null;
  error?: string;
};

type RunSummary = Record<string, { completed: number; failed: number }>;

const humanizeUnderscoreText = (value: string) =>
  value
    .split('_')
    .join(' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const getStatusIcon = (status: string) => {
  if (status === 'failed') {
    return <AlertTriangle className="w-4 h-4 text-red-500" />;
  }

  if (status === 'processing' || status === 'pending' || status === 'partial') {
    return <Clock className="w-4 h-4 text-amber-500" />;
  }

  return <CheckCircle className="w-4 h-4 text-green-500" />;
};

const getStatusBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'failed') {
    return 'destructive';
  }

  if (status === 'delivered' || status === 'completed' || status === 'sent') {
    return 'secondary';
  }

  return 'outline';
};

const getTypeBadgeColor = (type: string) => {
  if (type.includes('maturity')) {
    return 'bg-amber-100 text-amber-800 border-amber-200';
  }

  if (type.includes('payment')) {
    return 'bg-blue-100 text-blue-800 border-blue-200';
  }

  if (type.includes('birthday')) {
    return 'bg-pink-100 text-pink-800 border-pink-200';
  }

  if (type.includes('report')) {
    return 'bg-violet-100 text-violet-800 border-violet-200';
  }

  return 'bg-slate-100 text-slate-800 border-slate-200';
};

export default function NotificationAudit() {
  const [page, setPage] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [archivePage, setArchivePage] = useState(0);

  const { data: notifications, isLoading, error } = useEmailNotifications(page, 20);
  const { data: jobs = [] } = useNotificationJobs(0, 50);
  const { data: jobRuns = [] } = useJobRuns(0, 20);
  const { data: archivedNotifications = [] } = useArchivedEmailNotifications(archivePage, 10);
  const { data: archivedJobs = [] } = useArchivedNotificationJobs(archivePage, 10);
  const { data: archivedJobRuns = [] } = useArchivedJobRuns(archivePage, 10);
  const adminAction = useAdminNotificationAction();
  const { toast } = useToast();
  const { role } = useAuth();
  const canManageNotifications = role === 'admin' || role === 'super_admin';

  const filteredNotifications = (notifications ?? []).filter((notification) => {
    const searchableText = [
      notification.email_subject,
      notification.email_body,
      notification.recipient,
      notification.notification_type,
    ].filter(Boolean).join(' ').toLowerCase();

    return (!searchTerm || searchableText.includes(searchTerm.toLowerCase()))
      && (statusFilter === 'all' || notification.delivery_status === statusFilter)
      && (typeFilter === 'all' || notification.notification_type === typeFilter)
      && (channelFilter === 'all' || notification.delivery_channel === channelFilter);
  });

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const selectedRun = jobRuns.find((run) => run.id === selectedRunId) ?? null;
  const runResults = parseRunResults(selectedRun?.metadata);
  const runSummary = parseRunSummary(selectedRun?.metadata);
  const actionableJobIds = jobs.filter((job) => !['completed', 'cancelled'].includes(job.status)).map((job) => job.id);
  const retryableJobIds = jobs.filter((job) => selectedJobIds.includes(job.id) && job.status === 'failed').map((job) => job.id);
  const cancellableJobIds = jobs.filter((job) => selectedJobIds.includes(job.id) && ['pending', 'failed', 'processing'].includes(job.status)).map((job) => job.id);
  const allActionableSelected = actionableJobIds.length > 0 && actionableJobIds.every((jobId) => selectedJobIds.includes(jobId));

  const notificationStats = [
    { label: 'Total Sent', value: notifications?.length ?? 0, icon: <Mail className="w-8 h-8 text-blue-500" /> },
    { label: 'Sent', value: notifications?.filter((item) => item.delivery_status === 'sent').length ?? 0, icon: <CheckCircle className="w-8 h-8 text-green-500" /> },
    { label: 'Delivered', value: notifications?.filter((item) => item.delivery_status === 'delivered').length ?? 0, icon: <CheckCircle className="w-8 h-8 text-blue-500" /> },
    { label: 'Failed', value: notifications?.filter((item) => item.delivery_status === 'failed').length ?? 0, icon: <AlertTriangle className="w-8 h-8 text-red-500" /> },
  ];

  const queueStats = [
    { label: 'Queued Jobs', value: jobs.filter((job) => job.status === 'pending').length },
    { label: 'Processing Jobs', value: jobs.filter((job) => job.status === 'processing').length },
    { label: 'Failed Queue Jobs', value: jobs.filter((job) => job.status === 'failed').length },
  ];

  const runAdminAction = async (payload: AdminActionPayload, successMessage: string) => {
    try {
      await adminAction.mutateAsync(payload);
      if (payload.action === 'retry_selected_jobs' || payload.action === 'cancel_selected_jobs') {
        setSelectedJobIds([]);
      }
      toast({ title: 'Success', description: successMessage });
    } catch (actionError) {
      toast({
        title: 'Error',
        description: actionError instanceof Error ? actionError.message : 'Admin action failed.',
        variant: 'destructive',
      });
    }
  };

  const toggleSelection = (jobId: string, checked: boolean) => {
    setSelectedJobIds((current) => checked ? [...new Set([...current, jobId])] : current.filter((id) => id !== jobId));
  };

  if (error) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
        <div className="text-center py-8">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Notifications</h2>
          <p className="text-muted-foreground">Failed to load notification audit data. Please try again later.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Notification Audit</h1>
        <p className="text-muted-foreground text-sm mt-1">Monitor email delivery history, queue health, and worker execution details.</p>
      </div>

      {canManageNotifications && (
        <ActionCard
          isPending={adminAction.isPending}
          retryableCount={retryableJobIds.length}
          cancellableCount={cancellableJobIds.length}
          onRetryFailed={() => runAdminAction({ action: 'retry_failed_jobs' }, 'Failed jobs have been requeued.')}
          onProcessNow={() => runAdminAction({ action: 'process_queue_now', batchSize: 50 }, 'Queue processing has been triggered.')}
          onQueueNow={() => runAdminAction({ action: 'queue_reminders_now' }, 'Reminder jobs have been queued.')}
          onRetrySelected={() => runAdminAction({ action: 'retry_selected_jobs', jobIds: retryableJobIds }, 'Selected failed jobs have been requeued.')}
          onCancelSelected={() => runAdminAction({ action: 'cancel_selected_jobs', jobIds: cancellableJobIds }, 'Selected jobs have been cancelled.')}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {notificationStats.map((stat) => (
          <ValueCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {queueStats.map((stat) => (
          <SimpleValueCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search notifications..." className="pl-10" />
            </div>
            <FilterSelect value={statusFilter} onChange={setStatusFilter} placeholder="Filter by status" items={['all', 'sent', 'delivered', 'failed']} />
            <FilterSelect value={typeFilter} onChange={setTypeFilter} placeholder="Filter by type" items={['all', 'investment_confirmation', 'maturity_reminder', 'payment_reminder', 'monthly_report', 'birthday_greeting']} />
            <FilterSelect value={channelFilter} onChange={setChannelFilter} placeholder="Filter by channel" items={['all', 'email', 'sms']} />
          </div>
        </CardContent>
      </Card>

      <NotificationHistoryTable
        isLoading={isLoading}
        notifications={notifications ?? []}
        filteredNotifications={filteredNotifications}
        page={page}
        onPrevious={() => setPage(Math.max(0, page - 1))}
        onNext={() => setPage(page + 1)}
        getStatusIcon={getStatusIcon}
        getStatusBadgeVariant={getStatusBadgeVariant}
        getTypeBadgeColor={getTypeBadgeColor}
      />

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading">Queue Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManageNotifications && jobs.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Checkbox checked={allActionableSelected} onCheckedChange={(checked) => setSelectedJobIds(checked === true ? actionableJobIds : [])} />
                <span>{selectedJobIds.length} selected</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={adminAction.isPending || retryableJobIds.length === 0} onClick={() => runAdminAction({ action: 'retry_selected_jobs', jobIds: retryableJobIds }, 'Selected failed jobs have been requeued.')}>Retry Selected</Button>
                <Button variant="destructive" size="sm" disabled={adminAction.isPending || cancellableJobIds.length === 0} onClick={() => runAdminAction({ action: 'cancel_selected_jobs', jobIds: cancellableJobIds }, 'Selected jobs have been cancelled.')}>Cancel Selected</Button>
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No queued notification jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canManageNotifications && <TableHead className="w-12">Select</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className={selectedJobId === job.id ? 'bg-secondary/30' : ''} onClick={() => setSelectedJobId(job.id)}>
                    {canManageNotifications && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox checked={selectedJobIds.includes(job.id)} disabled={['completed', 'cancelled'].includes(job.status)} onCheckedChange={(checked) => toggleSelection(job.id, checked === true)} />
                      </TableCell>
                    )}
                    <TableCell><Badge variant={job.status === 'failed' ? 'destructive' : job.status === 'completed' ? 'secondary' : 'outline'}>{job.status}</Badge></TableCell>
                    <TableCell><Badge className={getTypeBadgeColor(job.notification_type)}>{humanizeUnderscoreText(job.notification_type)}</Badge></TableCell>
                    <TableCell>{job.attempt_count} / {job.max_attempts}</TableCell>
                    <TableCell>{formatDate(job.scheduled_for)} <span className="text-xs text-muted-foreground">{new Date(job.scheduled_for).toLocaleTimeString()}</span></TableCell>
                    <TableCell className="max-w-xs"><div className="truncate text-sm text-muted-foreground" title={job.last_error ?? ''}>{job.last_error || 'None'}</div></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {job.status === 'failed' && (
                          <Button variant="outline" size="sm" disabled={adminAction.isPending} onClick={(event) => { event.stopPropagation(); runAdminAction({ action: 'retry_single_job', jobId: job.id }, 'Selected job has been requeued.'); }}>Retry</Button>
                        )}
                        {['pending', 'failed', 'processing'].includes(job.status) && (
                          <Button variant="destructive" size="sm" disabled={adminAction.isPending} onClick={(event) => { event.stopPropagation(); runAdminAction({ action: 'cancel_single_job', jobId: job.id }, 'Selected job has been cancelled.'); }}>Cancel</Button>
                        )}
                        {['completed', 'cancelled'].includes(job.status) && <span className="text-xs text-muted-foreground">View details</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedJob && (
        <DetailCard
          title="Selected Job Details"
          details={[
            ['Job ID', selectedJob.id],
            ['Dedupe Key', selectedJob.dedupe_key || 'N/A'],
            ['Status', selectedJob.status],
            ['Attempts', `${selectedJob.attempt_count} / ${selectedJob.max_attempts}`],
            ['Scheduled For', `${formatDate(selectedJob.scheduled_for)} ${new Date(selectedJob.scheduled_for).toLocaleTimeString()}`],
            ['Locked At', selectedJob.locked_at ? `${formatDate(selectedJob.locked_at)} ${new Date(selectedJob.locked_at).toLocaleTimeString()}` : 'Not locked'],
          ]}
          blocks={[
            ['Payload', JSON.stringify(selectedJob.payload, null, 2), 'min-h-48 font-mono text-xs'],
            ['Last Error', selectedJob.last_error || 'No error recorded', 'min-h-24 text-xs'],
          ]}
        />
      )}

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading">Archived History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SimpleValueCard label="Archived Deliveries" value={archivedNotifications.length} />
            <SimpleValueCard label="Archived Queue Jobs" value={archivedJobs.length} />
            <SimpleValueCard label="Archived Worker Runs" value={archivedJobRuns.length} />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Archived Deliveries</p>
            {archivedNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">No archived deliveries yet.</p>
            ) : (
              <div className="space-y-2">
                {archivedNotifications.map((notification) => (
                  <div key={`${notification.id}-${notification.archived_at}`} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{notification.email_subject}</p>
                        <p className="text-xs text-muted-foreground">{notification.recipient}</p>
                      </div>
                      <Badge variant={notification.delivery_status === 'failed' ? 'destructive' : 'secondary'}>
                        {notification.delivery_status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>Provider: {notification.provider_name || 'N/A'} {notification.provider_status ? `· ${notification.provider_status}` : ''}</p>
                      <p>Archived: {formatDate(notification.archived_at)} {new Date(notification.archived_at).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Archived Queue Jobs</p>
            {archivedJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No archived queue jobs yet.</p>
            ) : (
              <div className="space-y-2">
                {archivedJobs.map((job) => (
                  <div key={`${job.id}-${job.archived_at}`} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{humanizeUnderscoreText(job.notification_type)}</span>
                      <Badge variant="outline">{job.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Archived: {formatDate(job.archived_at)} {new Date(job.archived_at).toLocaleTimeString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Archived Worker Runs</p>
            {archivedJobRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No archived worker runs yet.</p>
            ) : (
              <div className="space-y-2">
                {archivedJobRuns.map((run) => (
                  <div key={`${run.id}-${run.archived_at}`} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{run.worker_name}</span>
                      <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>{run.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Archived: {formatDate(run.archived_at)} {new Date(run.archived_at).toLocaleTimeString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setArchivePage((current) => Math.max(0, current - 1))} disabled={archivePage === 0}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchivePage((current) => current + 1)}
              disabled={archivedNotifications.length < 10 && archivedJobs.length < 10 && archivedJobRuns.length < 10}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading">Worker Run History</CardTitle>
        </CardHeader>
        <CardContent>
          {jobRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No worker run history yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Results</TableHead>
                  <TableHead>Failure Detail</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobRuns.map((run) => {
                  const failedCount = parseRunResults(run.metadata).filter((result) => result.status === 'failed').length;
                  return (
                    <TableRow key={run.id} className={selectedRunId === run.id ? 'bg-secondary/30' : ''} onClick={() => setSelectedRunId(run.id)}>
                      <TableCell><Badge variant={run.status === 'failed' ? 'destructive' : run.status === 'partial' ? 'outline' : 'secondary'}>{run.status}</Badge></TableCell>
                      <TableCell>{run.worker_name}</TableCell>
                      <TableCell>{run.batch_size}</TableCell>
                      <TableCell><div className="text-sm">Claimed: {run.jobs_claimed}</div><div className="text-xs text-muted-foreground">Done: {run.jobs_completed} · Failed: {run.jobs_failed}</div></TableCell>
                      <TableCell className="max-w-xs"><div className="truncate text-sm text-muted-foreground" title={run.error_message ?? ''}>{run.error_message || `${failedCount} job-level failures`}</div></TableCell>
                      <TableCell>{formatDate(run.started_at)} <span className="text-xs text-muted-foreground">{new Date(run.started_at).toLocaleTimeString()}</span></TableCell>
                      <TableCell>{run.completed_at ? `${formatDate(run.completed_at)} ${new Date(run.completed_at).toLocaleTimeString()}` : <span className="text-sm text-muted-foreground">Still running</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedRun && (
        <DetailCard
          title="Selected Worker Run Details"
          details={[
            ['Run ID', selectedRun.id],
            ['Worker', selectedRun.worker_name],
            ['Status', selectedRun.status],
            ['Batch Size', String(selectedRun.batch_size)],
            ['Started', `${formatDate(selectedRun.started_at)} ${new Date(selectedRun.started_at).toLocaleTimeString()}`],
            ['Completed', selectedRun.completed_at ? `${formatDate(selectedRun.completed_at)} ${new Date(selectedRun.completed_at).toLocaleTimeString()}` : 'Still running'],
          ]}
          metricBlocks={[
            ['Claimed', selectedRun.jobs_claimed],
            ['Completed', selectedRun.jobs_completed],
            ['Failed', selectedRun.jobs_failed],
          ]}
          summary={runSummary}
          blocks={[
            ['Run Error', selectedRun.error_message || 'No run-level error recorded', 'min-h-24 text-xs'],
            ['Raw Metadata', JSON.stringify(selectedRun.metadata, null, 2), 'min-h-48 font-mono text-xs'],
          ]}
          runResults={runResults}
        />
      )}
    </motion.div>
  );
}

function ValueCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return <Card className="glass-card"><CardContent className="p-4"><div className="flex items-center gap-3">{icon}<div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div></div></CardContent></Card>;
}

function SimpleValueCard({ label, value }: { label: string; value: number }) {
  return <Card className="glass-card"><CardContent className="p-4"><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>;
}

function FilterSelect({ value, onChange, placeholder, items }: { value: string; onChange: (value: string) => void; placeholder: string; items: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item} value={item}>{item === 'all' ? `All ${placeholder.split(' ').pop()}s` : humanizeUnderscoreText(item)}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function ActionCard(props: {
  isPending: boolean;
  retryableCount: number;
  cancellableCount: number;
  onRetryFailed: () => void;
  onProcessNow: () => void;
  onQueueNow: () => void;
  onRetrySelected: () => void;
  onCancelSelected: () => void;
}) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Admin Actions</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={props.onRetryFailed} disabled={props.isPending}>Retry Failed Jobs</Button>
        <Button variant="outline" onClick={props.onProcessNow} disabled={props.isPending}>Process Queue Now</Button>
        <Button onClick={props.onQueueNow} disabled={props.isPending}>Queue Reminders Now</Button>
        <Button variant="outline" onClick={props.onRetrySelected} disabled={props.isPending || props.retryableCount === 0}>Retry Selected</Button>
        <Button variant="destructive" onClick={props.onCancelSelected} disabled={props.isPending || props.cancellableCount === 0}>Cancel Selected</Button>
      </CardContent>
    </Card>
  );
}

function NotificationHistoryTable(props: {
  isLoading: boolean;
  notifications: Array<Record<string, unknown>>;
  filteredNotifications: Array<Record<string, unknown>>;
  page: number;
  onPrevious: () => void;
  onNext: () => void;
  getStatusIcon: (status: string) => ReactNode;
  getStatusBadgeVariant: (status: string) => 'default' | 'secondary' | 'destructive' | 'outline';
  getTypeBadgeColor: (type: string) => string;
}) {
  if (props.isLoading) {
    return <Card className="glass-card"><CardHeader className="pb-3"><CardTitle className="text-base font-heading">Notification History</CardTitle></CardHeader><CardContent><div className="space-y-4">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 bg-secondary/50 rounded animate-pulse" />)}</div></CardContent></Card>;
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Notification History</CardTitle></CardHeader>
      <CardContent>
        {props.filteredNotifications.length === 0 ? (
          <div className="text-center py-8">
            <Mail className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Notifications Found</h3>
            <p className="text-muted-foreground">Try adjusting your filters or wait for the first delivery records to arrive.</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Channel</TableHead><TableHead>Type</TableHead><TableHead>Subject</TableHead><TableHead>Recipient</TableHead><TableHead>Amount</TableHead><TableHead>Sent At</TableHead></TableRow></TableHeader>
              <TableBody>
                {props.filteredNotifications.map((notification) => {
                  const item = notification as {
                    id: string; delivery_status: string; delivery_channel: string; notification_type: string; email_subject: string;
                    recipient: string; investor_id?: string | null; investment_amount?: number | null; sent_at: string;
                    provider_name?: string | null; provider_status?: string | null; provider_message_id?: string | null;
                  };
                  return (
                    <TableRow key={item.id}>
                      <TableCell><div className="flex items-center gap-2">{props.getStatusIcon(item.delivery_status)}<Badge variant={props.getStatusBadgeVariant(item.delivery_status)}>{item.delivery_status}</Badge></div></TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{item.delivery_channel === 'sms' ? <MessageSquare className="w-3 h-3 mr-1" /> : <Mail className="w-3 h-3 mr-1" />}{item.delivery_channel}</Badge></TableCell>
                      <TableCell><Badge className={props.getTypeBadgeColor(item.notification_type)}>{humanizeUnderscoreText(item.notification_type)}</Badge></TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={item.email_subject}>{item.email_subject}</div>
                        {(item.provider_name || item.provider_status || item.provider_message_id) && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {item.provider_name || 'Provider'} {item.provider_status ? `· ${item.provider_status}` : ''} {item.provider_message_id ? `· ${item.provider_message_id}` : ''}
                          </div>
                        )}
                      </TableCell>
                      <TableCell><div className="text-sm">{item.recipient}</div><div className="text-xs text-muted-foreground">Investor ID: {item.investor_id || 'N/A'}</div></TableCell>
                      <TableCell>{item.investment_amount ? formatNaira(Number(item.investment_amount)) : 'N/A'}</TableCell>
                      <TableCell>{formatDate(item.sent_at)} <span className="text-xs text-muted-foreground">{new Date(item.sent_at).toLocaleTimeString()}</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">Showing {props.filteredNotifications.length} of {props.notifications.length} notifications</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={props.onPrevious} disabled={props.page === 0}>Previous</Button>
                <Button variant="outline" size="sm" onClick={props.onNext} disabled={props.filteredNotifications.length < 20}>Next</Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DetailCard(props: {
  title: string;
  details: Array<[string, string]>;
  blocks: Array<[string, string, string]>;
  metricBlocks?: Array<[string, number]>;
  summary?: RunSummary;
  runResults?: RunResult[];
}) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-3"><CardTitle className="text-base font-heading">{props.title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {props.details.map(([label, value]) => <div key={label}><p className="text-muted-foreground">{label}</p><p className="font-mono break-all">{value}</p></div>)}
        </div>
        {props.metricBlocks && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{props.metricBlocks.map(([label, value]) => <div key={label} className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>}
        {props.summary && Object.keys(props.summary).length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Payload Summary</p>
            {Object.entries(props.summary).map(([type, summary]) => <div key={type} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span className="capitalize">{humanizeUnderscoreText(type)}</span><span className="text-muted-foreground">{summary.completed} completed · {summary.failed} failed</span></div>)}
          </div>
        )}
        {props.runResults && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Job Results</p>
            {props.runResults.length === 0
              ? <p className="text-sm text-muted-foreground">No job results recorded for this run.</p>
              : props.runResults.map((result) => <div key={result.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><div className="text-sm font-medium">{humanizeUnderscoreText(result.notificationType)}</div><Badge variant={result.status === 'failed' ? 'destructive' : 'secondary'}>{result.status}</Badge></div><div className="mt-2 space-y-1 text-xs text-muted-foreground"><p className="font-mono break-all">Job ID: {result.id}</p><p>Recipient: {result.recipient || 'N/A'}</p><p>{result.error || 'No job-level error recorded'}</p></div></div>)}
          </div>
        )}
        {props.blocks.map(([label, value, className]) => <div key={label}><p className="text-sm text-muted-foreground mb-2">{label}</p><Textarea value={value} readOnly className={className} /></div>)}
      </CardContent>
    </Card>
  );
}

function parseRunResults(metadata: unknown): RunResult[] {
  const results = typeof metadata === 'object' && metadata !== null ? (metadata as { results?: unknown }).results : null;
  if (!Array.isArray(results)) return [];
  return results.filter((result): result is RunResult => typeof result === 'object' && result !== null && typeof (result as { id?: unknown }).id === 'string' && typeof (result as { status?: unknown }).status === 'string' && typeof (result as { notificationType?: unknown }).notificationType === 'string');
}

function parseRunSummary(metadata: unknown): RunSummary {
  const summary = typeof metadata === 'object' && metadata !== null ? (metadata as { summary?: unknown }).summary : null;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return {};
  return Object.entries(summary).reduce<RunSummary>((accumulator, [key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { completed?: unknown }).completed === 'number' && typeof (value as { failed?: unknown }).failed === 'number') {
      accumulator[key] = { completed: (value as { completed: number }).completed, failed: (value as { failed: number }).failed };
    }
    return accumulator;
  }, {});
}
