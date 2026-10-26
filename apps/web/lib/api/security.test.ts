import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ApiSecurityError, assertSameOrigin, consumeRateLimit } from "./security";

const previousRedisUrl = process.env.REDIS_URL;
const previousNodeEnv = process.env.NODE_ENV;
const previousAllowMemoryRateLimiter = process.env.OPERATOR_ALLOW_MEMORY_RATE_LIMITER;
const writableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  delete process.env.REDIS_URL;
  delete process.env.OPERATOR_ALLOW_MEMORY_RATE_LIMITER;
});

afterEach(() => {
  if (previousRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = previousRedisUrl;
  }
  if (previousNodeEnv === undefined) {
    delete writableEnv.NODE_ENV;
  } else {
    writableEnv.NODE_ENV = previousNodeEnv;
  }
  if (previousAllowMemoryRateLimiter === undefined) {
    delete process.env.OPERATOR_ALLOW_MEMORY_RATE_LIMITER;
  } else {
    process.env.OPERATOR_ALLOW_MEMORY_RATE_LIMITER = previousAllowMemoryRateLimiter;
  }
});

describe("API security helpers", () => {
  test("allows same-origin mutations", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://operator.test/api", {
          method: "POST",
          headers: {
            host: "operator.test",
            origin: "https://operator.test"
          }
        })
      )
    ).not.toThrow();
  });

  test("rejects cross-origin mutations", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://operator.test/api", {
          method: "POST",
          headers: {
            host: "operator.test",
            origin: "https://evil.test"
          }
        })
      )
    ).toThrow(ApiSecurityError);
  });

  test("rate limits by namespace and client key", async () => {
    const request = new Request("https://operator.test/api", {
      headers: {
        "x-forwarded-for": "192.0.2.10"
      }
    });
    const namespace = `test-${crypto.randomUUID()}`;

    await expect(consumeRateLimit(request, { namespace, points: 1, durationSeconds: 60 })).resolves.toBeUndefined();
    await expect(consumeRateLimit(request, { namespace, points: 1, durationSeconds: 60 })).rejects.toThrow(ApiSecurityError);
  });

  test("requires the Redis-backed standard limiter in production", async () => {
    writableEnv.NODE_ENV = "production";
    const request = new Request("https://operator.test/api", {
      headers: {
        "x-forwarded-for": "192.0.2.11"
      }
    });

    await expect(
      consumeRateLimit(request, { namespace: `production-${crypto.randomUUID()}`, points: 1, durationSeconds: 60 })
    ).rejects.toMatchObject({
      status: 503,
      code: "RATE_LIMITER_BACKEND_REQUIRED"
    });
  });

  test("allows the in-memory limiter only through an explicit non-standard override", async () => {
    writableEnv.NODE_ENV = "production";
    process.env.OPERATOR_ALLOW_MEMORY_RATE_LIMITER = "true";
    const request = new Request("https://operator.test/api", {
      headers: {
        "x-forwarded-for": "192.0.2.12"
      }
    });

    await expect(
      consumeRateLimit(request, { namespace: `override-${crypto.randomUUID()}`, points: 1, durationSeconds: 60 })
    ).resolves.toBeUndefined();
  });
});
