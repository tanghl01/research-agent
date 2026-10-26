import { isOidcJwtIdentityProviderConfigured } from "@operator/identity";

export type OperatorBackendRuntimeStatus = {
  enabled: boolean;
  deploymentStage: OperatorDeploymentStage;
  publicConfigured: boolean;
  serviceConfigured: boolean;
  databaseConfigured: boolean;
  identityConfigured: boolean;
  standardIdentityConfigured: boolean;
  storageConfigured: boolean;
  storageProvider: "local" | "s3";
  queueConfigured: boolean;
  unverifiedEmailLoginAllowed: boolean;
  provider: "self-hosted";
  buckets: {
    artifacts: string;
    drive: string;
    cache: string;
    knowledge: string;
  };
};

export type OperatorDeploymentStage = "development" | "staging" | "production";

type Env = Record<string, string | undefined>;

const DEFAULT_ARTIFACT_BUCKET = "operator-artifacts";
const DEFAULT_DRIVE_BUCKET = "operator-drive";
const DEFAULT_CACHE_BUCKET = "operator-cache";
const DEFAULT_KNOWLEDGE_BUCKET = "operator-knowledge";

export function getOperatorBackendRuntimeStatus(env: Env = process.env): OperatorBackendRuntimeStatus {
  const deploymentStage = operatorDeploymentStage(env);
  const databaseConfigured = Boolean(envValue(env, "DATABASE_URL"));
  const localSessionConfigured = envValue(env, "OPERATOR_SESSION_SECRET").length >= 24;
  const standardIdentityConfigured = isOidcJwtIdentityProviderConfigured(env);
  const identityConfigured = localSessionConfigured || standardIdentityConfigured;
  const provider = storageProvider(env);
  const requested = booleanEnv(envValue(env, "OPERATOR_BACKEND_ENABLED")) ?? databaseConfigured;
  const enabled = requested && databaseConfigured && identityConfigured;
  const storageConfigured = provider === "s3" ? isS3StorageConfigured(env) : isLocalStorageConfigured(env, enabled, deploymentStage);

  return {
    enabled,
    deploymentStage,
    publicConfigured: identityConfigured,
    serviceConfigured: enabled && storageConfigured,
    databaseConfigured,
    identityConfigured,
    standardIdentityConfigured,
    storageConfigured,
    storageProvider: provider,
    queueConfigured: Boolean(envValue(env, "REDIS_URL")),
    provider: "self-hosted",
    buckets: {
      artifacts: envValue(env, "OPERATOR_STORAGE_ARTIFACT_BUCKET") || DEFAULT_ARTIFACT_BUCKET,
      drive: envValue(env, "OPERATOR_STORAGE_DRIVE_BUCKET") || DEFAULT_DRIVE_BUCKET,
      cache: envValue(env, "OPERATOR_STORAGE_CACHE_BUCKET") || DEFAULT_CACHE_BUCKET,
      knowledge: envValue(env, "OPERATOR_STORAGE_KNOWLEDGE_BUCKET") || DEFAULT_KNOWLEDGE_BUCKET
    },
    unverifiedEmailLoginAllowed: isUnverifiedEmailLoginAllowed(env)
  };
}

export function operatorDeploymentStage(env: Env = process.env): OperatorDeploymentStage {
  const explicit = envValue(env, "OPERATOR_DEPLOYMENT_STAGE") || envValue(env, "OPERATOR_ENV");
  const normalized = explicit.toLowerCase();
  if (["development", "dev", "local", "test"].includes(normalized)) return "development";
  if (["staging", "stage", "preview", "internal", "inner-beta", "beta"].includes(normalized)) return "staging";
  if (["production", "prod"].includes(normalized)) return "production";
  if (explicit) return "production";
  return envValue(env, "NODE_ENV") === "production" ? "production" : "development";
}

export function assertOperatorBackendConfigured(env: Env = process.env): OperatorBackendRuntimeStatus {
  const status = getOperatorBackendRuntimeStatus(env);
  if (!status.databaseConfigured) {
    throw new Error("DATABASE_URL is required for Operator backend operations.");
  }
  if (!status.identityConfigured) {
    throw new Error("Either OPERATOR_SESSION_SECRET or standard OIDC configuration is required for Operator identity.");
  }
  if (!status.enabled) {
    throw new Error("Operator backend is disabled.");
  }
  if (!status.storageConfigured) {
    throw new Error("Operator object storage is not configured.");
  }
  return status;
}

function envValue(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

function booleanEnv(value: string): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function storageProvider(env: Env): "local" | "s3" {
  const explicit = envValue(env, "OPERATOR_STORAGE_PROVIDER").toLowerCase();
  if (explicit === "local" || explicit === "s3") return explicit;
  return envValue(env, "OPERATOR_S3_ENDPOINT") || envValue(env, "OPERATOR_S3_REGION") ? "s3" : "local";
}

function isS3StorageConfigured(env: Env): boolean {
  const hasRegion = Boolean(envValue(env, "OPERATOR_S3_REGION"));
  const accessKey = envValue(env, "OPERATOR_S3_ACCESS_KEY_ID");
  const secretKey = envValue(env, "OPERATOR_S3_SECRET_ACCESS_KEY");
  const explicitCredentialsComplete = Boolean(accessKey && secretKey);
  const explicitCredentialsPartial = Boolean(accessKey || secretKey);
  return hasRegion && !explicitCredentialsPartial ? true : hasRegion && explicitCredentialsComplete;
}

function isLocalStorageConfigured(env: Env, backendEnabled: boolean, deploymentStage: OperatorDeploymentStage): boolean {
  if (deploymentStage === "production" && booleanEnv(envValue(env, "OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE")) !== true) {
    return false;
  }
  return Boolean(envValue(env, "OPERATOR_STORAGE_ROOT")) || backendEnabled;
}

export function isUnverifiedEmailLoginAllowed(env: Env = process.env): boolean {
  const explicit = booleanEnv(envValue(env, "OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN"));
  if (explicit !== undefined) return explicit;
  return envValue(env, "NODE_ENV") !== "production";
}
