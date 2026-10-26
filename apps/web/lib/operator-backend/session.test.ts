import { afterEach, describe, expect, test, vi } from "vitest";
import { aliyunDypnsConfig, normalizePhoneForLogin, shouldUseSecureSessionCookie } from "./session";

describe("Operator phone login helpers", () => {
  test("normalizes mainland China mobile numbers to E.164", () => {
    expect(normalizePhoneForLogin("138 0000 0000")).toBe("+8613800000000");
    expect(normalizePhoneForLogin("8613800000000")).toBe("+8613800000000");
  });

  test("accepts generic E.164 numbers and rejects invalid values", () => {
    expect(normalizePhoneForLogin("+14155552671")).toBe("+14155552671");
    expect(normalizePhoneForLogin("12345")).toBe("");
    expect(normalizePhoneForLogin("not-a-phone")).toBe("");
  });

  test("uses secure cookies for HTTPS and production without trusting proxy headers by default", () => {
    expect(shouldUseSecureSessionCookie(new Request("http://operator.test", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
    expect(shouldUseSecureSessionCookie(new Request("http://operator.test", { headers: { "x-forwarded-proto": "https" } }))).toBe(false);
    expect(shouldUseSecureSessionCookie(new Request("https://operator.test"))).toBe(true);
    expect(shouldUseSecureSessionCookie(new Request("http://operator.test"))).toBe(false);
    expect(shouldUseSecureSessionCookie(new Request("http://operator.test"), { NODE_ENV: "production" })).toBe(true);
  });

  test("uses forwarded proto only when proxy headers are trusted", () => {
    expect(
      shouldUseSecureSessionCookie(new Request("http://operator.test", { headers: { "x-forwarded-proto": "https" } }), {
        OPERATOR_TRUST_PROXY_HEADERS: "true"
      })
    ).toBe(true);
    expect(
      shouldUseSecureSessionCookie(new Request("https://operator.test", { headers: { "x-forwarded-proto": "http" } }), {
        OPERATOR_TRUST_PROXY_HEADERS: "true"
      })
    ).toBe(false);
  });
});

describe("Aliyun DYPNS phone login config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("never returns the real verification code to the client in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALIYUN_ACCESS_KEY_ID", "test-access-key-id");
    vi.stubEnv("ALIYUN_ACCESS_KEY_SECRET", "test-access-key-secret");
    vi.stubEnv("OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE", "true");

    expect(aliyunDypnsConfig().returnVerifyCode).toBe(false);
  });

  test("honors OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE outside of production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALIYUN_ACCESS_KEY_ID", "test-access-key-id");
    vi.stubEnv("ALIYUN_ACCESS_KEY_SECRET", "test-access-key-secret");
    vi.stubEnv("OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE", "true");

    expect(aliyunDypnsConfig().returnVerifyCode).toBe(true);
  });
});
