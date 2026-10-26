import { createRemoteJWKSet, jwtVerify } from "jose";
import { parse } from "cookie";
import type { IdentityProvider, IdentitySession, LoginParams } from "./types.js";

export const DEFAULT_OIDC_COOKIE = "operator_identity_token";

export type OidcJwtIdentityProviderConfig = {
  issuer: string;
  audience: string | string[];
  jwksUri: string;
  cookieName?: string;
  defaultTtlSeconds?: number;
};

type Env = Record<string, string | undefined>;

export class OidcJwtIdentityProvider implements IdentityProvider {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly cookieName: string;
  private readonly defaultTtlSeconds: number;

  constructor(private readonly config: OidcJwtIdentityProviderConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
    this.cookieName = config.cookieName?.trim() || DEFAULT_OIDC_COOKIE;
    this.defaultTtlSeconds = Math.max(60, Math.floor(config.defaultTtlSeconds ?? 60 * 60));
  }

  async getSession(request: Request): Promise<IdentitySession | null> {
    const token = tokenFromRequest(request, this.cookieName);
    if (!token) return null;

    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.audience
    });

    const subject = stringClaim(payload.sub);
    if (!subject) return null;

    const email = stringClaim(payload.email);
    const phone = stringClaim(payload.phone_number);
    const displayName =
      stringClaim(payload.name) ??
      stringClaim(payload.preferred_username) ??
      stringClaim(payload.nickname) ??
      email?.split("@")[0] ??
      phone ??
      subject;

    return {
      user: {
        id: subject,
        email: email ?? null,
        phone: phone ?? null,
        displayName,
        avatarUrl: stringClaim(payload.picture) ?? null
      },
      expiresAt: expiresAtFromPayload(payload.exp, this.defaultTtlSeconds)
    };
  }

  async login(_params: LoginParams): Promise<IdentitySession> {
    throw new Error("OIDC login is handled by the configured external identity provider.");
  }

  async logout(_request: Request): Promise<void> {
    // OIDC logout is provider-specific. Operator clears only its local session cookie.
  }
}

export function createOidcJwtIdentityProviderFromEnv(env: Env = process.env): OidcJwtIdentityProvider | null {
  const issuer = envValue(env, "OPERATOR_OIDC_ISSUER");
  const audience = csvEnv(envValue(env, "OPERATOR_OIDC_AUDIENCE"));
  const jwksUri = envValue(env, "OPERATOR_OIDC_JWKS_URI");
  if (!issuer || !audience.length || !jwksUri) return null;
  return new OidcJwtIdentityProvider({
    issuer,
    audience,
    jwksUri,
    cookieName: envValue(env, "OPERATOR_OIDC_COOKIE_NAME") || DEFAULT_OIDC_COOKIE,
    defaultTtlSeconds: positiveInteger(envValue(env, "OPERATOR_OIDC_DEFAULT_TTL_SECONDS"), 60 * 60)
  });
}

export function isOidcJwtIdentityProviderConfigured(env: Env = process.env): boolean {
  return Boolean(
    envValue(env, "OPERATOR_OIDC_ISSUER") && envValue(env, "OPERATOR_OIDC_AUDIENCE") && envValue(env, "OPERATOR_OIDC_JWKS_URI")
  );
}

export function tokenFromRequest(request: Request, cookieName = DEFAULT_OIDC_COOKIE): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/iu.exec(authorization)?.[1]?.trim();
  if (bearer) return bearer;
  const cookieHeader = request.headers.get("cookie");
  return cookieHeader ? parse(cookieHeader)[cookieName] : undefined;
}

function expiresAtFromPayload(exp: unknown, fallbackTtlSeconds: number): string {
  if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) {
    return new Date(exp * 1000).toISOString();
  }
  return new Date(Date.now() + fallbackTtlSeconds * 1000).toISOString();
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function envValue(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

function csvEnv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
