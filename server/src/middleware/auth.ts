import type { NextFunction, Request, Response } from "express";
import { Auth0AuthenticationError, getUserFromAuth0BearerToken, isAuth0Enabled } from "../lib/auth0.js";
import { getUserFromBearerToken, isSupabaseTimeoutError } from "../lib/supabase.js";
import { env } from "../config/env.js";
import {
  Auth0StaffAccountMappingError,
  Auth0StaffAccountService,
} from "../services/auth0-staff-account.service.js";
import type { AppRole } from "../types/certificates.js";

const auth0StaffAccounts = new Auth0StaffAccountService();

const extractBearerToken = (request: Request): string | null => {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
};

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(request);

    if (!token) {
      response.status(401).json({ message: "Missing bearer token" });
      return;
    }

    request.authUser = await getUserFromBearerToken(token);
    next();
  } catch (error) {
    if (isSupabaseTimeoutError(error)) {
      response.status(503).json({
        message: "Authentication is temporarily unavailable. Please try again shortly.",
      });
      return;
    }

    response.status(401).json({
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
};

// This middleware is intentionally used only by Auth0 readiness routes until staff identities
// are mapped to existing Supabase user IDs in MongoDB.
export const requireDualAuth = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(request);

    if (!token) {
      response.status(401).json({ message: "Missing bearer token" });
      return;
    }

    if (isAuth0Enabled()) {
      try {
        request.authUser = await getUserFromAuth0BearerToken(token);
        next();
        return;
      } catch (error) {
        if (!(error instanceof Auth0AuthenticationError)) {
          throw error;
        }

        if (env.AUTH_MODE === "auth0") {
          throw error;
        }
      }
    }

    request.authUser = await getUserFromBearerToken(token);
    next();
  } catch (error) {
    if (isSupabaseTimeoutError(error)) {
      response.status(503).json({
        message: "Authentication is temporarily unavailable. Please try again shortly.",
      });
      return;
    }

    response.status(401).json({
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
};

// Only the Auth0 readiness endpoint requires a previously validated MongoDB staff mapping.
// Existing Supabase sessions still use the normal fallback in dual-auth mode.
export const requireMappedDualAuth = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(request);

    if (!token) {
      response.status(401).json({ message: "Missing bearer token" });
      return;
    }

    if (isAuth0Enabled()) {
      try {
        const auth0User = await getUserFromAuth0BearerToken(token);
        await auth0StaffAccounts.assertMappedActiveAccount(auth0User);
        request.authUser = auth0User;
        next();
        return;
      } catch (error) {
        if (error instanceof Auth0StaffAccountMappingError) {
          throw error;
        }

        if (!(error instanceof Auth0AuthenticationError)) {
          throw error;
        }

        if (env.AUTH_MODE === "auth0") {
          throw error;
        }
      }
    }

    request.authUser = await getUserFromBearerToken(token);
    next();
  } catch (error) {
    if (isSupabaseTimeoutError(error)) {
      response.status(503).json({
        message: "Authentication is temporarily unavailable. Please try again shortly.",
      });
      return;
    }

    response.status(401).json({
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
};

export const requireRole = (...roles: AppRole[]) => {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.authUser) {
      response.status(401).json({ message: "Unauthenticated request" });
      return;
    }

    if (!roles.includes(request.authUser.role)) {
      response.status(403).json({ message: "Forbidden for current role" });
      return;
    }

    next();
  };
};
