import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../workspace.js";
import type { CapabilityDescriptor, CapabilityInstallReceipt } from "./types.js";

export function capabilityInstallStateRoot(): string {
  const runtimeRoot = process.env.OPERATOR_RUNTIME_CACHE_ROOT
    ? resolveRepoPath(process.env.OPERATOR_RUNTIME_CACHE_ROOT)
    : path.join(repoRoot(), "tmp", "runtimes");
  return process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT
    ? resolveRepoPath(process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT)
    : path.join(runtimeRoot, "_capability-installs");
}

export function capabilityReceiptPath(descriptor: CapabilityDescriptor, versionKey: string): string {
  return path.join(capabilityInstallStateRoot(), sanitizePathSegment(descriptor.id), `${versionKey}.json`);
}

export function writeCapabilityInstallReceipt(receipt: CapabilityInstallReceipt): void {
  const dir = path.dirname(receipt.receipt_path);
  mkdirSync(dir, { recursive: true });
  for (const filename of readdirSync(dir)) {
    const existingPath = path.join(dir, filename);
    if (filename.endsWith(".json") && existingPath !== receipt.receipt_path) {
      rmSync(existingPath, { force: true });
    }
  }
  writeFileSync(receipt.receipt_path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot(), value);
}

export function sha256Text(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}
