import type { Readable } from "node:stream";

export type ObjectBody = Buffer | Uint8Array | string | Readable;

export type PutObjectInput = {
  bucket: string;
  key: string;
  body: ObjectBody;
  contentType: string;
  metadata?: Record<string, string>;
};

export type ObjectStat = {
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: string;
  updatedAt: Date;
  metadata: Record<string, string>;
};

export type SignedUrlOptions = {
  expiresInSeconds: number;
  downloadName?: string;
};

export type ObjectStorageAdapter = {
  readonly provider: string;
  putObject(input: PutObjectInput): Promise<void>;
  getObject(bucket: string, key: string): Promise<Buffer>;
  statObject(bucket: string, key: string): Promise<ObjectStat>;
  deleteObject(bucket: string, key: string): Promise<void>;
  createSignedUrl(bucket: string, key: string, options: SignedUrlOptions): Promise<string>;
};
