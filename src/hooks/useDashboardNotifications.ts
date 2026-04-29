import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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

export function useDashboardNotifications(limit = 20) {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;
  const userEmail = user?.email?.toLowerCase() ?? null;
  useRealtimeNotificationInvalidation(user?.id, user?.email ?? null, role ?? null);

  return useQuery({
    queryKey: ['dashboard-notifications', user?.id, user?.email, role, limit],
    enabled: !!userId && !!role,
    queryFn: async () => {
      const notificationRole = mapAppRoleToNotificationRole(role);
      if (!notificationRole || !userId) return [];

      let query = supabase
        .from('notifications' as never)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (notificationRole === 'investor') {
        query = query.or(`recipient_user_id.eq.${userId},recipient_email.eq.${userEmail}`);
      } else {
        query = query.or(`recipient_user_id.eq.${userId},user_role.eq.${notificationRole}`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(mapNotificationRecord);
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
      const notificationRole = mapAppRoleToNotificationRole(role);
      if (!notificationRole || !userId) return 0;

      let query = supabase
        .from('notifications' as never)
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      if (notificationRole === 'investor') {
        query = query.or(`recipient_user_id.eq.${userId},recipient_email.eq.${userEmail}`);
      } else {
        query = query.or(`recipient_user_id.eq.${userId},user_role.eq.${notificationRole}`);
      }

      const { count, error } = await query;

      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkDashboardNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications' as never)
        .update({ is_read: true } as never)
        .eq('id', notificationId);

      if (error) throw error;
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
      const notificationRole = mapAppRoleToNotificationRole(role);
      if (!user?.id || !notificationRole) return;

      let query = supabase
        .from('notifications' as never)
        .update({ is_read: true } as never)
        .eq('is_read', false);

      if (notificationRole === 'investor') {
        query = query.or(`recipient_user_id.eq.${user.id},recipient_email.eq.${user.email?.toLowerCase()}`);
      } else {
        query = query.or(`recipient_user_id.eq.${user.id},user_role.eq.${notificationRole}`);
      }

      const { error } = await query;

      if (error) throw error;
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
      return 'manager';
    case 'general_manager':
      return 'general_manager';
    case 'super_admin':
      return 'ceo';
    default:
      return 'investor';
  }
}
