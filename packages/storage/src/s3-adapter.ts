import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectCommandInput,
  type GetObjectCommandInput,
  type HeadObjectCommandInput,
  type PutObjectCommandInput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorageAdapter, PutObjectInput, ObjectStat, SignedUrlOptions } from "./types.js";

type S3ClientLike = Pick<S3Client, "send">;

type PresignFn = (client: S3ClientLike, command: GetObjectCommand, options: { expiresIn: number }) => Promise<string>;

export type S3CompatibleStorageAdapterConfig = {
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  client?: S3ClientLike;
  presign?: PresignFn;
};

export class S3CompatibleStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "s3";
  private readonly client: S3ClientLike;
  private readonly presign: PresignFn;

  constructor(readonly config: S3CompatibleStorageAdapterConfig) {
    this.client =
      config.client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials:
          config.accessKeyId && config.secretAccessKey
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
              }
            : undefined
      });
    this.presign = config.presign ?? ((client, command, options) => getSignedUrl(client as S3Client, command, options));
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const commandInput: PutObjectCommandInput = {
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: input.metadata
    };
    await this.client.send(new PutObjectCommand(commandInput));
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const commandInput: GetObjectCommandInput = {
      Bucket: bucket,
      Key: key
    };
    const output = await this.client.send(new GetObjectCommand(commandInput));
    return objectBodyToBuffer(output.Body);
  }

  async statObject(bucket: string, key: string): Promise<ObjectStat> {
    const commandInput: HeadObjectCommandInput = {
      Bucket: bucket,
      Key: key
    };
    const output = await this.client.send(new HeadObjectCommand(commandInput));
    return {
      bucket,
      key,
      sizeBytes: output.ContentLength ?? 0,
      contentType: output.ContentType ?? "application/octet-stream",
      updatedAt: output.LastModified ?? new Date(0),
      metadata: output.Metadata ?? {}
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const commandInput: DeleteObjectCommandInput = {
      Bucket: bucket,
      Key: key
    };
    await this.client.send(new DeleteObjectCommand(commandInput));
  }

  async createSignedUrl(bucket: string, key: string, options: SignedUrlOptions): Promise<string> {
    const commandInput: GetObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: options.downloadName ? contentDisposition(options.downloadName) : undefined
    };
    return this.presign(this.client, new GetObjectCommand(commandInput), {
      expiresIn: Math.max(1, Math.floor(options.expiresInSeconds))
    });
  }
}

async function objectBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) throw new Error("S3 object body is empty.");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);

  const transformToByteArray = method(body, "transformToByteArray");
  if (transformToByteArray) {
    const bytes = await transformToByteArray.call(body);
    return Buffer.from(bytes as Uint8Array);
  }

  if (body instanceof Readable || isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 object body type.");
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/["\\\r\n]+/gu, "_") || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function method(value: unknown, name: string): ((...args: never[]) => unknown) | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as (...args: never[]) => unknown) : undefined;
}
