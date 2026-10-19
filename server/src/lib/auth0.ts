import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import type { AppRole, AuthenticatedUser } from "../types/certificates.js";

const supportedRoles = new Set<AppRole>([
  "investment_manager",
  "accountant",
  "general_manager",
  "super_admin",
  "admin",
]);

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let configuredIssuer: string | undefined;

export class Auth0AuthenticationError extends Error {}

export const isAuth0Enabled = () => env.AUTH_MODE === "dual" || env.AUTH_MODE === "auth0";

export const getUserFromAuth0BearerToken = async (token: string): Promise<AuthenticatedUser> => {
  if (!isAuth0Enabled() || !env.AUTH0_ISSUER_BASE_URL || !env.AUTH0_AUDIENCE) {
    throw new Auth0AuthenticationError("Auth0 authentication is not configured");
  }

  const issuer = `${env.AUTH0_ISSUER_BASE_URL}/`;

  if (!jwks || configuredIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
    configuredIssuer = issuer;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.AUTH0_AUDIENCE,
      algorithms: ["RS256"],
    });

    return toAuthenticatedUser(payload);
  } catch (error) {
    if (error instanceof Auth0AuthenticationError) {
      throw error;
    }

    throw new Auth0AuthenticationError("Invalid Auth0 access token");
  }
};

const toAuthenticatedUser = (payload: JWTPayload): AuthenticatedUser => {
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) {
    throw new Auth0AuthenticationError("Auth0 access token has no subject");
  }

  const roles = readStringArray(payload[env.AUTH0_ROLES_CLAIM]);
  const matchingRoles = roles.filter((role): role is AppRole => supportedRoles.has(role as AppRole));

  if (matchingRoles.length !== 1) {
    throw new Auth0AuthenticationError("Auth0 user must have exactly one Zaradera workflow role");
  }

  return {
    id: subject,
    email: typeof payload.email === "string" ? payload.email : "",
    role: matchingRoles[0],
    provider: "auth0",
    permissions: readStringArray(payload.permissions),
  };
};

const readStringArray = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    : []
);
