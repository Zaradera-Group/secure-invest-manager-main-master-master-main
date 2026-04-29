import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AnnouncementRow = {
  id: string;
  title: string;
  detail: string;
  status: 'info' | 'urgent' | 'matured';
  created_at: string;
};

function normalizeAnnouncementStatus(status: unknown): AnnouncementRow['status'] {
  if (status === 'urgent' || status === 'matured') {
    return status;
  }

  return 'info';
}

export function useAnnouncements(page = 0, pageSize = 8) {
  return useQuery<{ data: AnnouncementRow[]; count: number }>({
    queryKey: ['announcements', page, pageSize],
    queryFn: async (): Promise<{ data: AnnouncementRow[]; count: number }> => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from('announcements')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return {
        data: (data ?? []).map((announcement) => ({
          id: announcement.id,
          title: announcement.title,
          detail: announcement.detail,
          status: normalizeAnnouncementStatus(announcement.status),
          created_at: announcement.created_at,
        })),
        count: count ?? 0,
      };
    },
    staleTime: 1000 * 60,
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (announcement: Omit<AnnouncementRow, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('announcements')
        .insert(announcement)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}
