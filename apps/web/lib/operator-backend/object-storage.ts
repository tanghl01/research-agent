import path from "node:path";
import { repoRoot } from "@operator/core";
import { LocalFsStorageAdapter, S3CompatibleStorageAdapter, type ObjectStorageAdapter } from "@operator/storage";
import { getOperatorBackendRuntimeStatus } from "./config";

let storage: ObjectStorageAdapter | undefined;
let storageSignature: string | undefined;

export function getObjectStorage(): ObjectStorageAdapter {
  const signature = objectStorageSignature();
  if (!storage || storageSignature !== signature) {
    storage = createObjectStorage();
    storageSignature = signature;
  }
  return storage;
}

function createObjectStorage(): ObjectStorageAdapter {
  const status = getOperatorBackendRuntimeStatus();
  if (!status.storageConfigured) {
    throw new Error("Operator object storage is not configured.");
  }
  if (status.storageProvider === "s3") {
    return new S3CompatibleStorageAdapter(s3StorageConfig());
  }
  return new LocalFsStorageAdapter(storageRoot());
}

export function storageRoot(): string {
  const configuredRoot = process.env.OPERATOR_STORAGE_ROOT?.trim();
  if (!configuredRoot) return path.join(repoRoot(), "tmp/object-storage");
  return path.isAbsolute(configuredRoot) ? configuredRoot : path.join(repoRoot(), configuredRoot);
}

function s3StorageConfig(): ConstructorParameters<typeof S3CompatibleStorageAdapter>[0] {
  const region = process.env.OPERATOR_S3_REGION?.trim();
  if (!region) {
    throw new Error("OPERATOR_S3_REGION is required when S3 storage is enabled.");
  }
  const accessKeyId = process.env.OPERATOR_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OPERATOR_S3_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("OPERATOR_S3_ACCESS_KEY_ID and OPERATOR_S3_SECRET_ACCESS_KEY must be configured together.");
  }
  return {
    endpoint: process.env.OPERATOR_S3_ENDPOINT?.trim() || undefined,
    region,
    accessKeyId: accessKeyId || undefined,
    secretAccessKey: secretAccessKey || undefined,
    forcePathStyle: booleanEnv(process.env.OPERATOR_S3_FORCE_PATH_STYLE) ?? Boolean(process.env.OPERATOR_S3_ENDPOINT?.trim())
  };
}

function objectStorageSignature(): string {
  return [
    process.env.OPERATOR_STORAGE_PROVIDER,
    process.env.OPERATOR_STORAGE_ROOT,
    process.env.OPERATOR_DEPLOYMENT_STAGE,
    process.env.OPERATOR_ENV,
    process.env.OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE,
    process.env.OPERATOR_S3_ENDPOINT,
    process.env.OPERATOR_S3_REGION,
    process.env.OPERATOR_S3_ACCESS_KEY_ID,
    process.env.OPERATOR_S3_FORCE_PATH_STYLE
  ].join("|");
}

function booleanEnv(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}
