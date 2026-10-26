#!/usr/bin/env node
import {
  closeKnowledgeTransferDatabase,
  cleanupHtmlPageFileAssets,
  exportKnowledgeBundle,
  importKnowledgeBundle,
  loadKnowledgeTransferEnv
} from "./transfer.js";

type Command = "export" | "import" | "cleanup-html";

type CliOptions = {
  command: Command;
  space?: string;
  out?: string;
  bundle?: string;
  bucket?: string;
  overwrite?: boolean;
  dryRun?: boolean;
};

async function main(): Promise<void> {
  loadKnowledgeTransferEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "export") {
    const spaceKey = options.space ?? "dianji";
    const outDir = options.out ?? `tmp/knowledge-bundles/${spaceKey}-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
    const manifest = await exportKnowledgeBundle({
      spaceKey,
      outDir,
      bucket: options.bucket,
      overwrite: options.overwrite
    });
    console.log(JSON.stringify({ ok: true, action: "export", outDir, manifest }, null, 2));
    return;
  }

  if (options.command === "cleanup-html") {
    const result = await cleanupHtmlPageFileAssets({
      spaceKey: options.space ?? "dianji",
      bucket: options.bucket,
      dryRun: options.dryRun
    });
    console.log(JSON.stringify({ ok: true, action: "cleanup-html", result }, null, 2));
    return;
  }

  if (!options.bundle) throw new Error("Missing --bundle <dir> for knowledge import.");
  const manifest = await importKnowledgeBundle({
    bundleDir: options.bundle,
    bucket: options.bucket
  });
  console.log(JSON.stringify({ ok: true, action: "import", bundleDir: options.bundle, manifest }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const command = args.shift();
  if (command !== "export" && command !== "import" && command !== "cleanup-html") usage();
  const options: CliOptions = { command };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--space") options.space = requireValue(args, ++index, arg);
    else if (arg === "--out") options.out = requireValue(args, ++index, arg);
    else if (arg === "--bundle") options.bundle = requireValue(args, ++index, arg);
    else if (arg === "--bucket") options.bucket = requireValue(args, ++index, arg);
    else if (arg === "--overwrite") options.overwrite = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "-h" || arg === "--help") usage(0);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
  return value;
}

function usage(exitCode = 1): never {
  console.log(`Usage:
  pnpm knowledge:export -- --space dianji --out tmp/knowledge-bundles/dianji --overwrite
  pnpm knowledge:import -- --bundle tmp/knowledge-bundles/dianji
  pnpm knowledge:cleanup-html -- --space dianji --dry-run

Options:
  --space <key>    Knowledge space key to export. Defaults to dianji.
  --out <dir>      Output bundle directory for export.
  --bundle <dir>   Bundle directory for import.
  --bucket <name>  Target/source knowledge object bucket override.
  --overwrite      Remove output directory before export.
  --dry-run        Show cleanup counts without changing DB or object storage.
`);
  process.exit(exitCode);
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeKnowledgeTransferDatabase().catch(() => undefined);
  });
