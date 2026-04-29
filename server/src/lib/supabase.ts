import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { AppRole, AuthenticatedUser } from "../types/certificates.js";

const createTimeoutSignal = (timeoutMs: number, upstreamSignal?: AbortSignal | null) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Supabase request timed out after ${timeoutMs}ms`)), timeoutMs);

  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", abortFromUpstream);
      }
    },
  };
};

const timeoutAwareFetch: typeof fetch = async (input, init) => {
  const { signal, cleanup } = createTimeoutSignal(env.SUPABASE_REQUEST_TIMEOUT_MS, init?.signal);

  try {
    return await fetch(input, {
      ...init,
      signal,
    });
  } finally {
    cleanup();
  }
};

export const adminSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: timeoutAwareFetch,
  },
});

const AUTH_TIMEOUT_ERROR_CODES = ["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"];

const isSupabaseTimeoutError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = error.cause as { code?: string; message?: string } | undefined;
  return AUTH_TIMEOUT_ERROR_CODES.includes(cause?.code ?? "")
    || error.message.includes("Connect Timeout")
    || error.message.includes("fetch failed")
    || (cause?.message?.includes("Connect Timeout") ?? false);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mapRole = (role: string): AppRole => {
  if (role === "investment_manager" || role === "general_manager" || role === "super_admin" || role === "admin") {
    return role;
  }

  throw new Error(`Unsupported application role: ${role}`);
};

export const getUserFromBearerToken = async (token: string): Promise<AuthenticatedUser> => {
  let user: User | null = null;
  let authError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const authResult = await adminSupabase.auth.getUser(token);
      if (authResult.error) {
        authError = authResult.error;

        if (isSupabaseTimeoutError(authResult.error) && attempt < 2) {
          console.warn(`[auth] Supabase auth lookup timed out. Retrying (${attempt + 1}/2)...`);
          await delay(500 * (attempt + 1));
          continue;
        }

        throw authResult.error;
      }

      user = authResult.data.user;
      break;
    } catch (error) {
      authError = error instanceof Error ? error : new Error("Supabase auth lookup failed");

      if (!isSupabaseTimeoutError(error) || attempt >= 2) {
        throw error;
      }

      console.warn(`[auth] Supabase auth lookup timed out. Retrying (${attempt + 1}/2)...`);
      await delay(500 * (attempt + 1));
    }
  }

  if (authError || !user) {
    if (authError && isSupabaseTimeoutError(authError)) {
      throw authError;
    }

    throw new Error("Invalid JWT");
  }

  const role = await getPrimaryRoleForUser(user);

  return {
    id: user.id,
    email: user.email ?? "",
    role,
  };
};

export { isSupabaseTimeoutError };

const getPrimaryRoleForUser = async (user: User): Promise<AppRole> => {
  const normalizedEmail = user.email?.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("Approved user email not found");
  }

  const { data: allowedUser, error: allowlistError } = await adminSupabase
    .from("allowed_auth_users")
    .select("email, is_active")
    .eq("email", normalizedEmail)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (allowlistError) {
    throw allowlistError;
  }

  if (!allowedUser) {
    throw new Error("Forbidden for current user");
  }

  const { data, error } = await adminSupabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.role) {
    throw new Error("User role not found");
  }

  return mapRole(data.role);
};
