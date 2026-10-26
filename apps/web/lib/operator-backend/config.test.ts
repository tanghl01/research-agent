import { describe, expect, test } from "vitest";
import { assertOperatorBackendConfigured, getOperatorBackendRuntimeStatus } from "./config";

describe("Operator backend config", () => {
  test("stays disabled when database or identity configuration is missing", () => {
    expect(getOperatorBackendRuntimeStatus({})).toMatchObject({
      enabled: false,
      databaseConfigured: false,
      identityConfigured: false,
      serviceConfigured: false
    });

    expect(
      getOperatorBackendRuntimeStatus({
        DATABASE_URL: "postgres://localhost/operator"
      })
    ).toMatchObject({
      enabled: false,
      databaseConfigured: true,
      identityConfigured: false
    });
  });

  test("reports configured self-hosted state without exposing secrets", () => {
    const status = getOperatorBackendRuntimeStatus({
      DATABASE_URL: "postgres://user:pass@localhost/operator",
      OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length",
      OPERATOR_STORAGE_ARTIFACT_BUCKET: "artifacts",
      OPERATOR_STORAGE_DRIVE_BUCKET: "drive",
      OPERATOR_STORAGE_CACHE_BUCKET: "cache",
      OPERATOR_STORAGE_KNOWLEDGE_BUCKET: "knowledge",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(status).toEqual({
      enabled: true,
      deploymentStage: "development",
      publicConfigured: true,
      serviceConfigured: true,
      databaseConfigured: true,
      identityConfigured: true,
      standardIdentityConfigured: false,
      storageConfigured: true,
      storageProvider: "local",
      queueConfigured: true,
      unverifiedEmailLoginAllowed: true,
      provider: "self-hosted",
      buckets: {
        artifacts: "artifacts",
        drive: "drive",
        cache: "cache",
        knowledge: "knowledge"
      }
    });
    expect(JSON.stringify(status)).not.toContain("user:pass");
    expect(JSON.stringify(status)).not.toContain("operator-session-secret");
  });

  test("requires explicit S3 storage or local-storage opt-in in production", () => {
    const productionEnv = {
      NODE_ENV: "production",
      OPERATOR_DEPLOYMENT_STAGE: "production",
      DATABASE_URL: "postgres://localhost/operator",
      OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length",
      REDIS_URL: "redis://localhost:6379"
    };

    expect(getOperatorBackendRuntimeStatus(productionEnv)).toMatchObject({
      enabled: true,
      serviceConfigured: false,
      storageProvider: "local",
      storageConfigured: false
    });
    expect(() => assertOperatorBackendConfigured(productionEnv)).toThrow(/object storage/i);

    expect(
      getOperatorBackendRuntimeStatus({
        ...productionEnv,
        OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE: "true"
      })
    ).toMatchObject({
      storageProvider: "local",
      storageConfigured: true
    });

    expect(
      getOperatorBackendRuntimeStatus({
        ...productionEnv,
        OPERATOR_STORAGE_PROVIDER: "s3",
        OPERATOR_S3_REGION: "us-east-1"
      })
    ).toMatchObject({
      storageProvider: "s3",
      storageConfigured: true
    });
  });

  test("allows local object storage for staging deployments running optimized Next.js", () => {
    const stagingEnv = {
      NODE_ENV: "production",
      OPERATOR_DEPLOYMENT_STAGE: "staging",
      DATABASE_URL: "postgres://localhost/operator",
      OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length",
      OPERATOR_STORAGE_PROVIDER: "local",
      OPERATOR_STORAGE_ROOT: "/var/lib/operator/object-storage"
    };

    expect(getOperatorBackendRuntimeStatus(stagingEnv)).toMatchObject({
      enabled: true,
      deploymentStage: "staging",
      serviceConfigured: true,
      storageProvider: "local",
      storageConfigured: true
    });
    expect(assertOperatorBackendConfigured(stagingEnv).storageConfigured).toBe(true);
  });

  test("accepts standard OIDC identity configuration", () => {
    expect(
      getOperatorBackendRuntimeStatus({
        DATABASE_URL: "postgres://localhost/operator",
        OPERATOR_OIDC_ISSUER: "https://issuer.example.test",
        OPERATOR_OIDC_AUDIENCE: "operator-web",
        OPERATOR_OIDC_JWKS_URI: "https://issuer.example.test/.well-known/jwks.json"
      })
    ).toMatchObject({
      enabled: true,
      identityConfigured: true,
      standardIdentityConfigured: true
    });
  });

  test("reports S3 storage only when standard S3 config is coherent", () => {
    expect(
      getOperatorBackendRuntimeStatus({
        DATABASE_URL: "postgres://localhost/operator",
        OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length",
        OPERATOR_STORAGE_PROVIDER: "s3",
        OPERATOR_S3_REGION: "us-east-1"
      })
    ).toMatchObject({
      storageProvider: "s3",
      storageConfigured: true
    });

    expect(
      getOperatorBackendRuntimeStatus({
        DATABASE_URL: "postgres://localhost/operator",
        OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length",
        OPERATOR_STORAGE_PROVIDER: "s3",
        OPERATOR_S3_REGION: "us-east-1",
        OPERATOR_S3_ACCESS_KEY_ID: "key"
      })
    ).toMatchObject({
      storageProvider: "s3",
      storageConfigured: false
    });
  });

  test("can be explicitly disabled", () => {
    const env = {
      DATABASE_URL: "postgres://localhost/operator",
      OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length",
      OPERATOR_BACKEND_ENABLED: "false"
    };

    expect(getOperatorBackendRuntimeStatus(env)).toMatchObject({ enabled: false });
    expect(() => assertOperatorBackendConfigured(env)).toThrow(/disabled/i);
  });

  test("disables unverified email login by default in production", () => {
    expect(
      getOperatorBackendRuntimeStatus({
        NODE_ENV: "production"
      }).unverifiedEmailLoginAllowed
    ).toBe(false);

    expect(
      getOperatorBackendRuntimeStatus({
        NODE_ENV: "production",
        OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN: "true"
      }).unverifiedEmailLoginAllowed
    ).toBe(true);
  });
});
