import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function repoRoot(): string {
  const configuredRoot = process.env.OPERATOR_REPO_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }
  for (const start of [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]) {
    const found = findRepoRoot(start);
    if (found) return found;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function findRepoRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveWorkspace(workspace: string | undefined, runId: string): string {
  const base = workspace?.trim() ? workspace : path.join("tmp", "runs", runId);
  const resolved = path.isAbsolute(base) ? base : path.resolve(repoRoot(), base);
  mkdirSync(path.join(resolved, "output"), { recursive: true });
  return resolved;
}

export function workspacePath(workspace: string, relativeOrAbsolutePath: string): string {
  const raw = relativeOrAbsolutePath.trim();
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
  const root = path.resolve(workspace);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes workflow workspace: ${relativeOrAbsolutePath}`);
  }
  return resolved;
}

export function relativeToWorkspace(workspace: string, absolutePath: string): string {
  return path.relative(path.resolve(workspace), path.resolve(absolutePath)).split(path.sep).join("/");
}

export function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function writeText(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}
