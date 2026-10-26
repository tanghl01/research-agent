import { describe, expect, it } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { S3CompatibleStorageAdapter } from "../src/s3-adapter.js";

describe("S3CompatibleStorageAdapter", () => {
  it("uses standard AWS SDK commands for object operations", async () => {
    const sent: Array<PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand> = [];
    const client = {
      async send(command: PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand): Promise<unknown> {
        sent.push(command);
        if (command instanceof GetObjectCommand) return { Body: Buffer.from("hello") };
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: 5,
            ContentType: "text/plain",
            LastModified: new Date("2026-01-01T00:00:00.000Z"),
            Metadata: { source: "test" }
          };
        }
        return {};
      }
    };
    const storage = new S3CompatibleStorageAdapter({
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
      client: client as never
    });

    await storage.putObject({
      bucket: "artifacts",
      key: "project/result.txt",
      body: "hello",
      contentType: "text/plain",
      metadata: { source: "test" }
    });
    await expect(storage.getObject("artifacts", "project/result.txt")).resolves.toEqual(Buffer.from("hello"));
    await expect(storage.statObject("artifacts", "project/result.txt")).resolves.toMatchObject({
      sizeBytes: 5,
      contentType: "text/plain",
      metadata: { source: "test" }
    });
    await storage.deleteObject("artifacts", "project/result.txt");

    expect(sent.map((command) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "HeadObjectCommand",
      "DeleteObjectCommand"
    ]);
  });

  it("delegates signed URLs to the standard presigner", async () => {
    const storage = new S3CompatibleStorageAdapter({
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
      client: {
        async send(): Promise<unknown> {
          return {};
        }
      } as never,
      async presign(_client, command, options) {
        expect(command).toBeInstanceOf(GetObjectCommand);
        expect(options.expiresIn).toBe(60);
        return "https://storage.example.test/signed";
      }
    });

    await expect(
      storage.createSignedUrl("artifacts", "project/result.txt", {
        expiresInSeconds: 60,
        downloadName: "result.txt"
      })
    ).resolves.toBe("https://storage.example.test/signed");
  });
});
