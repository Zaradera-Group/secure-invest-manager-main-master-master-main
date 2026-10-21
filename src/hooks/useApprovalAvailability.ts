import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBackendAccessToken } from '@/lib/backendAccessToken';

const API_URL = import.meta.env.VITE_CERTIFICATE_API_URL ?? 'http://localhost:4000';
const APPROVAL_AVAILABILITY_PATH = '/settings/approval-availability';

type ApprovalAvailabilityResponse = {
  available: boolean;
};

async function callApprovalAvailabilityApi<T>(method: 'GET' | 'PATCH', body?: unknown): Promise<T> {
  const accessToken = await getBackendAccessToken();

  const response = await fetch(`${API_URL}${APPROVAL_AVAILABILITY_PATH}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null) as { message?: string } | T | null;

  if (!response.ok) {
    throw new Error(payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'Approval availability request failed.');
  }

  return payload as T;
}

export function useApprovalAvailability(enabled: boolean) {
  return useQuery({
    queryKey: ['approval-availability'],
    enabled,
    queryFn: () => callApprovalAvailabilityApi<ApprovalAvailabilityResponse>('GET'),
  });
}

export function useUpdateApprovalAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (available: boolean) => callApprovalAvailabilityApi<ApprovalAvailabilityResponse>('PATCH', { available }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-availability'] });
    },
  });
}
