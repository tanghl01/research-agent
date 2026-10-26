import path from "node:path";

export function safeObjectKey(...parts: string[]): string {
  const key = parts
    .flatMap((part) => part.split(/[\\/]+/u))
    .map((part) => sanitizePathPart(part))
    .filter(Boolean)
    .join("/");
  if (!key || key === "." || key.includes("..")) {
    throw new Error(`Unsafe object key: ${parts.join("/")}`);
  }
  return key;
}

export function safeFilename(filename: string, fallback = "file"): string {
  const basename = path
    .basename(filename)
    .replace(/[^\p{L}\p{N}._() -]+/gu, "_")
    .replace(/\s+/gu, " ")
    .trim();
  return basename && basename !== "." && basename !== ".." ? basename.slice(0, 180) : fallback;
}

function sanitizePathPart(part: string): string {
  const trimmed = part.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "";
  return trimmed.replace(/[^\p{L}\p{N}._=-]+/gu, "_").slice(0, 180);
}
