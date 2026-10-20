import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';

export type IntakeStatus = 'submitted' | 'reviewed' | 'archived' | 'rejected';

export type PublicIntakeRequest = {
  id: string;
  status: IntakeStatus;
  submitted_by_name: string;
  email: string;
  phone: string;
  date_of_birth?: string | null;
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

async function requestIntake<T>(path: string, options?: RequestInit): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('Your session has expired. Please sign in again.');

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as { message?: string } | T | null;
  if (!response.ok) {
    throw new Error(payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'Public intake request failed.');
  }
  return payload as T;
}

export function usePublicIntakeRequests() {
  return useQuery({
    queryKey: ['public-intake-requests'],
    queryFn: () => requestIntake<PublicIntakeRequest[]>('/intake/requests'),
  });
}

export async function fetchPublicIntakeRequest(id: string) {
  return requestIntake<PublicIntakeRequest>(`/intake/requests/${encodeURIComponent(id)}`);
}

export function useUpdatePublicIntakeRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reviewNotes }: { id: string; status: IntakeStatus; reviewNotes?: string | null }) =>
      requestIntake<PublicIntakeRequest>(`/intake/requests/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reviewNotes: reviewNotes?.trim() || null }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-intake-requests'] }),
  });
}

export function useDeletePublicIntakeRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestIntake<void>(`/intake/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-intake-requests'] }),
  });
}
