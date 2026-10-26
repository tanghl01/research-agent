import IORedis from "ioredis";
import { RateLimiterMemory, RateLimiterRedis, type IRateLimiterOptions, type RateLimiterAbstract } from "rate-limiter-flexible";

export class ApiSecurityError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "ApiSecurityError";
  }
}

type RateLimitOptions = {
  namespace: string;
  points: number;
  durationSeconds: number;
  key?: string;
};

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const limiterCache = new Map<string, RateLimiterAbstract>();
let redisClient: IORedis | undefined;

export function assertSameOrigin(request: Request): void {
  if (!unsafeMethods.has(request.method.toUpperCase())) return;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new ApiSecurityError("Cross-site requests are not allowed.", 403, "CROSS_SITE_REQUEST_DENIED");
  }

  const origin = request.headers.get("origin");
  if (!origin) return;

  const originHost = parseHost(origin);
  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!originHost || !requestHost || normalizeHost(originHost) !== normalizeHost(requestHost)) {
    throw new ApiSecurityError("Request origin does not match host.", 403, "ORIGIN_MISMATCH");
  }
}

export async function consumeRateLimit(request: Request, options: RateLimitOptions): Promise<void> {
  const limiter = rateLimiter(options);
  const key = `${options.namespace}:${options.key ?? clientIp(request)}`;
  try {
    await limiter.consume(key);
  } catch {
    throw new ApiSecurityError("Too many requests. Please retry later.", 429, "RATE_LIMITED");
  }
}

export function apiSecurityErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ApiSecurityError)) return null;
  return Response.json({ error: error.message, code: error.code }, { status: error.status });
}

function rateLimiter(options: RateLimitOptions): RateLimiterAbstract {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl && process.env.NODE_ENV === "production" && process.env.OPERATOR_ALLOW_MEMORY_RATE_LIMITER !== "true") {
    throw new ApiSecurityError("REDIS_URL is required for production Operator API rate limiting.", 503, "RATE_LIMITER_BACKEND_REQUIRED");
  }

  const cacheKey = `${options.namespace}:${options.points}:${options.durationSeconds}:${redisUrl ? "redis" : "memory"}`;
  const existing = limiterCache.get(cacheKey);
  if (existing) return existing;

  const baseOptions: IRateLimiterOptions = {
    keyPrefix: `operator:${options.namespace}`,
    points: options.points,
    duration: options.durationSeconds
  };
  const created = redisUrl
    ? new RateLimiterRedis({
        ...baseOptions,
        storeClient: sharedRedisClient(redisUrl)
      })
    : new RateLimiterMemory(baseOptions);
  limiterCache.set(cacheKey, created);
  return created;
}

function sharedRedisClient(redisUrl: string): IORedis {
  redisClient ??= new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  return redisClient;
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "local";
}

function parseHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}
