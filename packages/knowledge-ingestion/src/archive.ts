import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { filenameFromUrl, sha256Buffer } from "./utils.js";

const execFileAsync = promisify(execFile);

export type ArchiveMemberCandidate = {
  memberPath: string;
  body: Buffer;
  sizeBytes: number;
  sha256: string;
  filename: string;
  contentType: string;
};

export type ArchiveExpandResult = {
  status: "expanded" | "skipped" | "failed";
  members: ArchiveMemberCandidate[];
  metadata: Record<string, unknown>;
};

export type ArchiveExpandOptions = {
  tempDir?: string;
  maxMembers?: number;
  maxTotalBytes?: number;
  maxDepth?: number;
};

const DEFAULT_MAX_MEMBERS = 500;
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 4;

export async function expandArchive(resource: { url: string; body: Buffer }, options: ArchiveExpandOptions = {}): Promise<ArchiveExpandResult> {
  const tempRoot = await mkdtemp(path.join(options.tempDir || os.tmpdir(), "operator-archive-"));
  const archivePath = path.join(tempRoot, filenameFromUrl(resource.url));
  const extractDir = path.join(tempRoot, "extract");
  try {
    await writeFile(archivePath, resource.body);
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("7z", ["x", "-y", `-o${extractDir}`, archivePath], { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 });
    const members = await collectMembers(extractDir, {
      maxMembers: options.maxMembers ?? DEFAULT_MAX_MEMBERS,
      maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH
    });
    return {
      status: "expanded",
      members,
      metadata: {
        extractor: "7z",
        member_count: members.length,
        extracted_total_bytes: members.reduce((sum, member) => sum + member.sizeBytes, 0)
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: /ENOENT/u.test(message) ? "skipped" : "failed",
      members: [],
      metadata: {
        extractor: "7z",
        error: message
      }
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function collectMembers(
  root: string,
  limits: { maxMembers: number; maxTotalBytes: number; maxDepth: number },
  current = root,
  depth = 0,
  state: { totalBytes: number; members: ArchiveMemberCandidate[] } = { totalBytes: 0, members: [] }
): Promise<ArchiveMemberCandidate[]> {
  if (depth > limits.maxDepth) return state.members;
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (state.members.length >= limits.maxMembers || state.totalBytes >= limits.maxTotalBytes) break;
    const absolute = path.resolve(current, entry.name);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (absolute !== root && !absolute.startsWith(rootWithSep)) continue;
    if (entry.isDirectory()) {
      await collectMembers(root, limits, absolute, depth + 1, state);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await stat(absolute);
    if (state.totalBytes + stats.size > limits.maxTotalBytes) break;
    const body = await readFile(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    state.totalBytes += body.length;
    state.members.push({
      memberPath: relative,
      body,
      sizeBytes: body.length,
      sha256: sha256Buffer(body),
      filename: path.basename(relative) || randomUUID(),
      contentType: guessContentType(relative)
    });
  }
  return state.members;
}

function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".ppt") return "application/vnd.ms-powerpoint";
  if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (ext === ".txt" || ext === ".csv") return "text/plain";
  return "application/octet-stream";
}
