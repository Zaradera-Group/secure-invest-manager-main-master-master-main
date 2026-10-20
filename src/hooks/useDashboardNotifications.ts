import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const NOTIFICATIONS_API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';

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
  const userEmail = user?.email?.toLowerCase() ?? null;
  useRealtimeNotificationInvalidation(user?.id, user?.email ?? null, role ?? null);

  return useQuery({
    queryKey: ['dashboard-notifications', user?.id, user?.email, role, limit],
    enabled: !!userId && !!role,
    queryFn: async () => {
      const records = await callNotificationsBackend<Array<Record<string, unknown>>>(`/notifications/dashboard?limit=${limit}`, 'GET');
      return records.map(mapNotificationRecord);
    },
  });
}

export function useUnreadDashboardNotificationCount() {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;
  const userEmail = user?.email?.toLowerCase() ?? null;
  useRealtimeNotificationInvalidation(user?.id, user?.email ?? null, role ?? null);

  return useQuery({
    queryKey: ['dashboard-notifications-unread-count', user?.id, user?.email, role],
    enabled: !!userId && !!role,
    queryFn: async () => {
      const result = await callNotificationsBackend<{ count: number }>('/notifications/dashboard/unread-count', 'GET');
      return result.count;
    },
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

function useRealtimeNotificationInvalidation(userId?: string, email?: string | null, role?: string | null) {
  const queryClient = useQueryClient();
  const channelNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !role) return;

    if (!channelNameRef.current) {
      const uniqueSuffix =
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      channelNameRef.current = `workflow-notifications-${userId}-${uniqueSuffix}`;
    }

    const channelName = channelNameRef.current;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => {
          const record = (payload.new ?? payload.old) as Partial<WorkflowNotification> | null;
          if (!record) return;

          const notificationRole = mapAppRoleToNotificationRole(role);
          const matchesUser = record.recipient_user_id === userId;
          const matchesEmail = !!email && record.recipient_email?.toLowerCase() === email.toLowerCase();
          const matchesRole = notificationRole ? record.user_role === notificationRole : false;

          if (matchesUser || matchesEmail || matchesRole) {
            queryClient.invalidateQueries({ queryKey: ['dashboard-notifications'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-notifications-unread-count'] });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [email, queryClient, role, userId]);

  useEffect(() => {
    channelNameRef.current = null;
  }, [userId, role]);
}

function mapAppRoleToNotificationRole(role: string | null): WorkflowNotificationRole | null {
  switch (role) {
    case 'investment_manager':
    case 'accountant':
      return 'manager';
    case 'general_manager':
      return 'general_manager';
    case 'super_admin':
      return 'ceo';
    default:
      return 'investor';
  }
}
