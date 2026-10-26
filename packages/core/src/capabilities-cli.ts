#!/usr/bin/env node
import { loadDotenv } from "./env.js";
import {
  CapabilityInstallBatchError,
  CapabilityInstallError,
  classifyCapabilityRepository,
  listSyncableCapabilityDescriptors,
  resolveCapabilityInstallReceipt,
  syncAllCapabilities,
  syncCapability,
  type CapabilityInstallReceipt
} from "./capabilities/index.js";
import { runCommand } from "./process.js";
import { repoRoot } from "./workspace.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

async function main(argv: string[]) {
  loadDotenv();
  const [command, capabilityId, ...rest] = argv;
  const helpRequested = command === "--help" || command === "-h" || capabilityId === "--help" || capabilityId === "-h" || rest.includes("--help");
  if (!command || helpRequested) {
    printHelp();
    return helpRequested ? 0 : 1;
  }

  const args = [capabilityId, ...rest].filter((value): value is string => Boolean(value));
  const force = args.includes("--force");
  const includeExternal = args.includes("--include-external");
  const includeGeneric = args.includes("--include-generic");
  const kind = valueAfter(args, "--kind");

  if (command === "list") {
    const capabilities = listSyncableCapabilityDescriptors({
      kind: normalizeKind(kind),
      includeExternal,
      includeGeneric
    }).map((descriptor) => ({
      capability_id: descriptor.id,
      kind: descriptor.kind,
      adapter: descriptor.adapter.type,
      compatibility_level: descriptor.compatibilityLevel,
      source_type: descriptor.sourceType,
      manifest: descriptor.manifestPath
    }));
    console.log(JSON.stringify({ status: "listed", capabilities }, null, 2));
    return 0;
  }

  if (command === "inspect" && capabilityId) {
    const receipt = resolveCapabilityInstallReceipt(capabilityId);
    console.log(JSON.stringify({ status: "inspected", capability_id: capabilityId, receipt }, null, 2));
    return 0;
  }

  if (command === "import" && capabilityId) {
    const ref = valueAfter(args, "--ref");
    const root = await resolveImportSource(capabilityId, ref);
    const detection = classifyCapabilityRepository(root);
    console.log(
      JSON.stringify(
        {
          status: "drafted",
          source: capabilityId,
          root,
          detection,
          enablement: detection.compatibilityLevel === "generic-open-source" ? "draft-only" : "requires-manifest-review"
        },
        null,
        2
      )
    );
    return 0;
  }

  if (command !== "sync" || !capabilityId) {
    printHelp();
    return 1;
  }

  if (capabilityId === "--list") {
    const capabilities = listSyncableCapabilityDescriptors({
      kind: normalizeKind(kind),
      includeExternal,
      includeGeneric
    }).map((descriptor) => ({
      capability_id: descriptor.id,
      kind: descriptor.kind,
      adapter: descriptor.adapter.type,
      compatibility_level: descriptor.compatibilityLevel,
      manifest: descriptor.manifestPath
    }));
    console.log(JSON.stringify({ status: "listed", capabilities }, null, 2));
    return 0;
  }

  if (capabilityId === "--all") {
    const receipts = await syncAllCapabilities({
      force,
      includeExternal,
      includeGeneric,
      kind: normalizeKind(kind)
    });
    console.log(
      JSON.stringify(
        {
          status: "enabled",
          count: receipts.length,
          capabilities: receipts.map(summarizeReceipt)
        },
        null,
        2
      )
    );
    return 0;
  }

  const receipt = await syncCapability(capabilityId, { force });
  console.log(JSON.stringify({ status: "enabled", capability: summarizeReceipt(receipt) }, null, 2));
  return 0;
}

function summarizeReceipt(receipt: CapabilityInstallReceipt) {
  return {
    capability_id: receipt.capability_id,
    kind: receipt.kind,
    adapter: receipt.adapter_type,
    lifecycle_status: receipt.lifecycle_status,
    status: receipt.status,
    receipt_path: receipt.receipt_path,
    version_key: receipt.version_key,
    failed_checks: receipt.checks
      .filter((check) => check.required && check.status === "failed")
      .map((check) => ({ phase: check.phase, name: check.name, message: check.message }))
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeKind(kind: string | undefined) {
  if (!kind) return undefined;
  if (kind === "skill" || kind === "workflow" || kind === "agent" || kind === "tool" || kind === "package") return kind;
  throw new Error(`Unsupported capability kind: ${kind}`);
}

function printHelp(): void {
  console.log(`Usage:
  pnpm capabilities:sync ppt-master
  pnpm capabilities:sync --all
  pnpm capabilities:sync --all --kind skill
  pnpm capabilities:sync --list
  pnpm capabilities:list
  pnpm capabilities:inspect ppt-master
  pnpm capabilities:import https://github.com/org/repo --ref main

This command runs the Operator capability lifecycle: source resolution,
installation, required configuration checks, capability validation, concrete
adapter registration/deployment gates, enablement, and receipt writing. Skills
are managed by this same capability lifecycle.
Use --include-external for external agent package manifests and --include-generic
for generic open-source repositories that are not Operator-compatible yet.`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof CapabilityInstallBatchError) {
      console.error(
        JSON.stringify(
          {
            status: "failed",
            capabilities: error.receipts.map(summarizeReceipt)
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }
    if (error instanceof CapabilityInstallError) {
      console.error(JSON.stringify({ status: "failed", capability: summarizeReceipt(error.receipt) }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

async function resolveImportSource(source: string, ref?: string): Promise<string> {
  if (!looksLikeGitUrl(source)) return path.resolve(repoRoot(), source);
  const cacheRoot = path.join(
    process.env.OPERATOR_RUNTIME_CACHE_ROOT ? resolvePath(process.env.OPERATOR_RUNTIME_CACHE_ROOT) : path.join(repoRoot(), "tmp", "runtimes"),
    "_capability-imports"
  );
  const target = path.join(cacheRoot, createHash("sha256").update(`${source}#${ref ?? "HEAD"}`).digest("hex").slice(0, 16));
  if (!existsSync(target)) {
    mkdirSync(cacheRoot, { recursive: true });
    const args = ["clone", "--depth", "1"];
    if (ref) args.push("--branch", ref);
    args.push(source, target);
    await runCommand("git", args, { timeoutMs: 300_000 });
  }
  return target;
}

function looksLikeGitUrl(value: string): boolean {
  return /^https?:\/\//u.test(value) || value.startsWith("git@");
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot(), value);
}
