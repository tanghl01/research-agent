import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { ObjectStorageAdapter, PutObjectInput, ObjectBody, ObjectStat, SignedUrlOptions } from "./types.js";
import { safeObjectKey } from "./pathing.js";

export class LocalFsStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "local";

  constructor(private readonly rootDir: string) {}

  async putObject(input: PutObjectInput): Promise<void> {
    const target = this.objectPath(input.bucket, input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await bodyToBuffer(input.body));
    if (input.metadata || input.contentType) {
      await writeFile(
        `${target}.metadata.json`,
        JSON.stringify({ contentType: input.contentType, metadata: input.metadata ?? {} }, null, 2)
      );
    }
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    return readFile(this.objectPath(bucket, key));
  }

  async statObject(bucket: string, key: string): Promise<ObjectStat> {
    const objectPath = this.objectPath(bucket, key);
    const stats = await stat(objectPath);
    const metadata = await this.readMetadata(objectPath);
    return {
      bucket,
      key,
      sizeBytes: stats.size,
      contentType: metadata.contentType,
      updatedAt: stats.mtime,
      metadata: metadata.metadata
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const objectPath = this.objectPath(bucket, key);
    await rm(objectPath, { force: true });
    await rm(`${objectPath}.metadata.json`, { force: true });
  }

  async createSignedUrl(bucket: string, key: string, _options: SignedUrlOptions): Promise<string> {
    return `/api/operator/object-storage/local/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;
  }

  createReadStream(bucket: string, key: string): Readable {
    return createReadStream(this.objectPath(bucket, key));
  }

  private objectPath(bucket: string, key: string): string {
    const normalizedKey = safeObjectKey(key);
    const root = path.resolve(this.rootDir);
    const target = path.resolve(root, safeObjectKey(bucket), normalizedKey);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (target !== root && !target.startsWith(rootWithSep)) {
      throw new Error(`Object key escapes local storage root: ${bucket}/${key}`);
    }
    return target;
  }

  private async readMetadata(objectPath: string): Promise<{ contentType: string; metadata: Record<string, string> }> {
    try {
      const parsed = JSON.parse(await readFile(`${objectPath}.metadata.json`, "utf8")) as {
        contentType?: string;
        metadata?: Record<string, string>;
      };
      return {
        contentType: parsed.contentType ?? "application/octet-stream",
        metadata: parsed.metadata ?? {}
      };
    } catch {
      return { contentType: "application/octet-stream", metadata: {} };
    }
  }
}

async function bodyToBuffer(body: ObjectBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
