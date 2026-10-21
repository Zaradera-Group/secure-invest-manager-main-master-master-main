import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const NOTIFICATIONS_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';
const NOTIFICATION_REFRESH_INTERVAL_MS = 30_000;

type WorkflowNotificationRole = 'manager' | 'general_manager' | 'ceo' | 'investor';

export type WorkflowNotification = {
  id: string;
  user_role: WorkflowNotificationRole;
  message?: string | null;
  title: string;
  detail: string;
  certificate_id?: string | null;
  read?: boolean;
  is_read: boolean;
  recipient_user_id: string | null;
  recipient_email: string | null;
  action_path: string | null;
  created_at: string;
};

function toOptionalString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function toStringOrFallback(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function mapNotificationRecord(notification: Record<string, unknown>): WorkflowNotification {
  return {
    id: toStringOrFallback(notification.id, ''),
    user_role: notification.user_role as WorkflowNotificationRole,
    message: toOptionalString(notification.message),
    title: toStringOrFallback(notification.title, 'Certificate workflow update'),
    detail: toStringOrFallback(notification.detail, toStringOrFallback(notification.message, '')),
    certificate_id: toOptionalString(notification.certificate_id),
    read: typeof notification.read === 'boolean' ? notification.read : undefined,
    is_read: toBoolean(notification.is_read),
    recipient_user_id: toOptionalString(notification.recipient_user_id),
    recipient_email: toOptionalString(notification.recipient_email),
    action_path: toOptionalString(notification.action_path),
    created_at: toStringOrFallback(notification.created_at, ''),
  };
}

async function callNotificationsBackend<T>(path: string, method: 'GET' | 'PATCH') {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in to perform this action.');

  const response = await fetch(`${NOTIFICATIONS_API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  let payload: { message?: string } | T | null = null;
  if (raw) {
    try {
      payload = JSON.parse(raw) as { message?: string } | T;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload ? payload.message : null;
    throw new Error(message ?? 'Notification request failed.');
  }

  return payload as T;
}

export function useDashboardNotifications(limit = 20) {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ['dashboard-notifications', user?.id, user?.email, role, limit],
    enabled: !!userId && !!role,
    queryFn: async () => {
      const records = await callNotificationsBackend<Array<Record<string, unknown>>>(`/notifications/dashboard?limit=${limit}`, 'GET');
      return records.map(mapNotificationRecord);
    },
    refetchInterval: NOTIFICATION_REFRESH_INTERVAL_MS,
  });
}

export function useUnreadDashboardNotificationCount() {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ['dashboard-notifications-unread-count', user?.id, user?.email, role],
    enabled: !!userId && !!role,
    queryFn: async () => {
      const result = await callNotificationsBackend<{ count: number }>('/notifications/dashboard/unread-count', 'GET');
      return result.count;
    },
    refetchInterval: NOTIFICATION_REFRESH_INTERVAL_MS,
  });
}

export function useMarkDashboardNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      await callNotificationsBackend<void>(`/notifications/dashboard/${notificationId}/read`, 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-notifications-unread-count'] });
    },
  });
}

export function useMarkAllDashboardNotificationsRead() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user?.id || !role) return;
      await callNotificationsBackend<void>('/notifications/dashboard/read-all', 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-notifications-unread-count'] });
    },
  });
}
