import { describe, expect, it } from "vitest";
import { createSessionCookieValue, parseSessionCookieHeader, parseSessionCookieValue, sessionCookieHeader } from "../src/session-cookie.js";

describe("session cookie helpers", () => {
  it("round-trips an opaque session token", () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-";
    const value = createSessionCookieValue(token);

    expect(value).toBe(token);
    expect(parseSessionCookieValue(value)).toBe(token);
  });

  it("rejects structured, short, and malformed session cookies", () => {
    expect(parseSessionCookieValue(undefined)).toBeNull();
    expect(parseSessionCookieValue("short")).toBeNull();
    expect(parseSessionCookieValue("payload.signature")).toBeNull();
    expect(parseSessionCookieValue(JSON.stringify({ userId: "user_1", sessionToken: "token_1" }))).toBeNull();
    expect(() => createSessionCookieValue("payload.signature")).toThrow(/opaque/u);
  });

  it("creates an http-only session header", () => {
    const header = sessionCookieHeader("abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-", { maxAgeSeconds: 60, secure: true });

    expect(header).toContain("operator_session=abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(parseSessionCookieHeader(header)).toBe("abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-");
  });
});
