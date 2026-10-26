import { parse, serialize } from "cookie";

export const OPERATOR_SESSION_COOKIE = "operator_session";

const OPAQUE_SESSION_VALUE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;

export function createSessionCookieValue(sessionToken: string): string {
  const token = sessionToken.trim();
  if (!OPAQUE_SESSION_VALUE_PATTERN.test(token)) {
    throw new Error("Operator session token must be an opaque base64url value.");
  }
  return token;
}

export function parseSessionCookieValue(value: string | undefined): string | null {
  const token = value?.trim();
  if (!token || !OPAQUE_SESSION_VALUE_PATTERN.test(token)) return null;
  return token;
}

export function sessionCookieHeader(value: string, options: { maxAgeSeconds: number; secure?: boolean }): string {
  return serialize(OPERATOR_SESSION_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: Math.max(0, Math.floor(options.maxAgeSeconds)),
    secure: Boolean(options.secure)
  });
}

export function clearSessionCookieHeader(): string {
  return serialize(OPERATOR_SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0
  });
}

export function parseSessionCookieHeader(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  return parse(header)[OPERATOR_SESSION_COOKIE];
}
