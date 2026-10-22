import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBackendAuthorizationHeaders } from '@/lib/backendAccessToken';

const API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';

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

async function getAuthorizationHeaders() {
  return getBackendAuthorizationHeaders();
}

async function requestAnnouncements<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, options);
  const payload = await response.json().catch(() => null) as { message?: string } | T | null;

  if (!response.ok) {
    throw new Error(payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'Announcement request failed');
  }

  return payload as T;
}

export function useAnnouncements(page = 0, pageSize = 8) {
  return useQuery<{ data: AnnouncementRow[]; count: number }>({
    queryKey: ['announcements', page, pageSize],
    queryFn: async (): Promise<{ data: AnnouncementRow[]; count: number }> => {
      const result = await requestAnnouncements<{ data: AnnouncementRow[]; count: number }>(
        `/announcements?page=${page}&pageSize=${pageSize}`,
      );

      return {
        data: (result.data ?? []).map((announcement) => ({
          id: announcement.id,
          title: announcement.title,
          detail: announcement.detail,
          status: normalizeAnnouncementStatus(announcement.status),
          created_at: announcement.created_at,
        })),
        count: result.count ?? 0,
      };
    },
    staleTime: 1000 * 60,
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (announcement: Omit<AnnouncementRow, 'id' | 'created_at'>) => {
      return requestAnnouncements<AnnouncementRow>('/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthorizationHeaders()),
        },
        body: JSON.stringify(announcement),
      });
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
      await requestAnnouncements<void>(`/admin/announcements/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: await getAuthorizationHeaders(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}
