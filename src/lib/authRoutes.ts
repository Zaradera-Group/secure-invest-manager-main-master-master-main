import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

function getRouteMemoryKey(role: AppRole | null | undefined) {
  return `last-route:${role ?? 'guest'}`;
}

export function getDefaultDashboardPath(role: AppRole | null | undefined) {
  return '/dashboard';
}

export function rememberRoute(role: AppRole | null | undefined, path: string) {
  if (!role || !path.startsWith('/')) {
    return;
  }

  globalThis.localStorage?.setItem(getRouteMemoryKey(role), path);
}

export function getPreferredRoute(role: AppRole | null | undefined) {
  const rememberedPath = globalThis.localStorage?.getItem(getRouteMemoryKey(role));

  if (rememberedPath && rememberedPath.startsWith('/')) {
    return rememberedPath;
  }

  return getDefaultDashboardPath(role);
}
