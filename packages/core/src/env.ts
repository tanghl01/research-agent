import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./workspace.js";

export function loadDotenv(envPath = path.join(repoRoot(), ".env"), override = false): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    if (!key) continue;
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = stripEnvValue(rest.join("=").trim());
  }
}

function stripEnvValue(value: string): string {
  if (value.length >= 2 && value[0] === value[value.length - 1] && ["'", '"'].includes(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}
