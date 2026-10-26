import path from "node:path";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const isProduction = process.env.NODE_ENV === "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self' http: https: ws: wss:",
  ...(isProduction ? ["upgrade-insecure-requests"] : [])
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  transpilePackages: [
    "@operator/core",
    "@operator/contracts",
    "@operator/db",
    "@operator/identity",
    "@operator/knowledge-ingestion",
    "@operator/mastra-app",
    "@operator/queue",
    "@operator/storage"
  ],
  serverExternalPackages: [
    "@mastra/*",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-node",
    "@opentelemetry/semantic-conventions",
    "rate-limiter-flexible"
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : [])
        ]
      }
    ];
  },
  turbopack: {
    root: repoRoot
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"]
    };
    return config;
  }
};

export default nextConfig;
