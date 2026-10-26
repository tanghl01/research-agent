import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@operator/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { webDownloadTool, webFetchTool } from "../src/tools/web.js";

let server: Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  const port = 19200 + Math.floor(Math.random() * 1000);
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (req.url === "/paper.pdf") {
        const body = Buffer.from("%PDF-1.4\n% operator smoke test\n");
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="paper.pdf"',
          "content-length": body.length
        });
        res.end(body);
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Operator Test</title></head><body><main>hello web tool</main></body></html>");
    });
    server.listen(port, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
  server = undefined;
});

describe("Operator web tools", () => {
  test("fetches URL text for source verification", async () => {
    const result = await webFetchTool.execute?.({ url: baseUrl, maxChars: 200 }, undefined as never);

    expect(result).toMatchObject({
      status: 200,
      title: "Operator Test"
    });
    expect(result?.text).toContain("hello web tool");
  });

  test("downloads files into the task workspace with sha256 evidence", async () => {
    const workspace = `tmp/test-runs/web-tools-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);
    rmSync(absoluteWorkspace, { recursive: true, force: true });

    const result = await webDownloadTool.execute?.(
      {
        url: `${baseUrl}/paper.pdf`,
        workspace,
        path: "downloads/paper.pdf"
      },
      undefined as never
    );

    expect(result).toMatchObject({
      path: "downloads/paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 31
    });
    expect(result?.sha256).toHaveLength(64);
    const filePath = path.join(absoluteWorkspace, "downloads/paper.pdf");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toContain("%PDF-1.4");
  });

  test("treats extensionless output paths as download directories", async () => {
    const workspace = `tmp/test-runs/web-tools-dir-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);
    rmSync(absoluteWorkspace, { recursive: true, force: true });

    const result = await webDownloadTool.execute?.(
      {
        url: `${baseUrl}/paper.pdf`,
        workspace,
        path: "downloads"
      },
      undefined as never
    );

    expect(result?.path).toBe("downloads/paper.pdf");
    expect(existsSync(path.join(absoluteWorkspace, "downloads/paper.pdf"))).toBe(true);
  });
});
