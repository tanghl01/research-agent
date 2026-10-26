import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsStorageAdapter } from "../src/local-fs-adapter.js";
import { safeFilename, safeObjectKey } from "../src/pathing.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "operator-storage-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("LocalFsStorageAdapter", () => {
  it("stores, stats, reads, and deletes objects", async () => {
    const storage = new LocalFsStorageAdapter(tempRoot);

    await storage.putObject({
      bucket: "artifacts",
      key: "project-1/result.txt",
      body: "hello",
      contentType: "text/plain",
      metadata: { source: "test" }
    });

    await expect(storage.getObject("artifacts", "project-1/result.txt")).resolves.toEqual(Buffer.from("hello"));
    await expect(storage.statObject("artifacts", "project-1/result.txt")).resolves.toMatchObject({
      bucket: "artifacts",
      key: "project-1/result.txt",
      sizeBytes: 5,
      contentType: "text/plain",
      metadata: { source: "test" }
    });

    await storage.deleteObject("artifacts", "project-1/result.txt");
    await expect(storage.getObject("artifacts", "project-1/result.txt")).rejects.toThrow();
  });

  it("normalizes object keys and filenames", () => {
    expect(safeObjectKey(" team ", "draft/report?.md")).toBe("team/draft/report_.md");
    expect(safeFilename("../bad/name?.txt")).toBe("name_.txt");
  });
});
