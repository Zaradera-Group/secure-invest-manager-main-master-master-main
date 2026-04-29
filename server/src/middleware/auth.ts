import type { NextFunction, Request, Response } from "express";
import { getUserFromBearerToken, isSupabaseTimeoutError } from "../lib/supabase.js";
import type { AppRole } from "../types/certificates.js";

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
