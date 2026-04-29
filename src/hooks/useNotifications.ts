import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface NotificationPreferences {
  user_id: string;
  email_enabled: boolean;
  maturity_reminders: boolean;
  payment_reminders: boolean;
  monthly_reports: boolean;
  birthday_notifications: boolean;
  reminder_days_before: number[];
  created_at: string;
  updated_at: string;
}

export interface EmailNotification {
  id: string;
  user_id: string;
  investor_id?: string;
  notification_type: string;
  email_subject: string;
  email_body: string;
  sent_at: string;
  delivery_status: string;
  delivery_channel: string;
  recipient: string;
  error_message?: string;
  days_until_maturity?: number;
  investment_amount?: number;
  maturity_date?: string;
  provider_name?: string | null;
  provider_message_id?: string | null;
  provider_status?: string | null;
  provider_response?: Record<string, unknown> | null;
  provider_error_code?: string | null;
  provider_error_message?: string | null;
}

export interface NotificationJob {
  id: string;
  notification_type: string;
  user_id?: string | null;
  investor_id?: string | null;
  payload: Record<string, unknown>;
  dedupe_key?: string | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  scheduled_for: string;
  locked_at?: string | null;
  processed_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArchivedEmailNotification extends EmailNotification {
  archived_at: string;
}

export interface ArchivedNotificationJob extends NotificationJob {
  archived_at: string;
}

export interface ArchivedJobRun extends JobRun {
  archived_at: string;
}

export interface JobRun {
  id: string;
  worker_name: string;
  status: string;
  batch_size: number;
  jobs_claimed: number;
  jobs_completed: number;
  jobs_failed: number;
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface JobRunResult {
  id: string;
  status: string;
  notificationType: string;
  recipient?: string | null;
  error?: string;
}

export interface JobRunSummary {
  [notificationType: string]: {
    completed: number;
    failed: number;
  };
}

export function useNotificationPreferences() {
  const { user, loading } = useAuth();

  return useQuery<NotificationPreferences | null>({
    queryKey: ['notification-preferences', user?.id],
    enabled: !loading && !!user?.id,
    queryFn: async (): Promise<NotificationPreferences | null> => {
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null;
        }
        throw error;
      }
      return data;
    },
  });
}

export function useUpdateNotificationPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: Partial<Omit<NotificationPreferences, 'created_at' | 'updated_at'>>) => {
      if (!user) throw new Error('User not authenticated');

      const { data: existingPreferences, error: existingPreferencesError } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', preferences.user_id || user.id)
        .maybeSingle();

      if (existingPreferencesError && existingPreferencesError.code !== 'PGRST116') {
        throw existingPreferencesError;
      }

      const { data, error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: preferences.user_id || user.id,
          email_enabled: preferences.email_enabled ?? existingPreferences?.email_enabled ?? true,
          maturity_reminders: preferences.maturity_reminders ?? existingPreferences?.maturity_reminders ?? true,
          payment_reminders: preferences.payment_reminders ?? existingPreferences?.payment_reminders ?? true,
          monthly_reports: preferences.monthly_reports ?? existingPreferences?.monthly_reports ?? false,
          birthday_notifications: preferences.birthday_notifications ?? existingPreferences?.birthday_notifications ?? true,
          reminder_days_before: preferences.reminder_days_before ?? existingPreferences?.reminder_days_before ?? [7, 3, 1],
        }, {
          onConflict: 'user_id',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}

export function useEmailNotifications(page = 0, pageSize = 20) {
  return useQuery({
    queryKey: ['email-notifications', page, pageSize],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('email_notifications')
        .select('*')
        .order('sent_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data;
    },
  });
}

export function useArchivedEmailNotifications(page = 0, pageSize = 20) {
  return useQuery({
    queryKey: ['archived-email-notifications', page, pageSize],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('email_notifications_archive')
        .select('*')
        .order('archived_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data as ArchivedEmailNotification[];
    },
  });
}

export function useNotificationJobs(page = 0, pageSize = 20) {
  return useQuery({
    queryKey: ['notification-jobs', page, pageSize],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('notification_jobs')
        .select('*')
        .order('scheduled_for', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data as NotificationJob[];
    },
  });
}

export function useArchivedNotificationJobs(page = 0, pageSize = 20) {
  return useQuery({
    queryKey: ['archived-notification-jobs', page, pageSize],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('notification_jobs_archive')
        .select('*')
        .order('archived_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data as ArchivedNotificationJob[];
    },
  });
}

export function useJobRuns(page = 0, pageSize = 20) {
  return useQuery({
    queryKey: ['job-runs', page, pageSize],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('job_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data as JobRun[];
    },
  });
}

export function useArchivedJobRuns(page = 0, pageSize = 20) {
  return useQuery({
    queryKey: ['archived-job-runs', page, pageSize],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('job_runs_archive')
        .select('*')
        .order('archived_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data as ArchivedJobRun[];
    },
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to: 'test@example.com', // This would be the user's email in real implementation
          subject: 'Test Email from Zaradera',
          html: '<h1>Test Email</h1><p>This is a test email from your investment management system.</p>',
          userId: 'test-user-id',
          notificationType: 'test_email',
        },
      });

      if (error) throw error;
      return data;
    },
  });
}

export function useAdminNotificationAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
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
    }) => {
      const { data, error } = await supabase.functions.invoke('admin-notification-actions', {
        body: payload,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['email-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['job-runs'] });
      queryClient.invalidateQueries({ queryKey: ['archived-email-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['archived-notification-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['archived-job-runs'] });
    },
  });
}
