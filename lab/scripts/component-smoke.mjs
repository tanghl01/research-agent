import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDirs, labRoot, writeJson } from "./lib.mjs";

const sdkClientDir = path.join(
  labRoot,
  "vendor",
  "mcp-client",
  "node_modules",
  "@modelcontextprotocol",
  "sdk",
  "dist",
  "esm",
  "client"
);
const { Client } = await import(pathToFileURL(path.join(sdkClientDir, "index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdkClientDir, "stdio.js")).href);

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function contentText(result) {
  const chunks = result?.content || [];
  return chunks
    .map((chunk) => {
      if (chunk.type === "text") return chunk.text;
      if (chunk.type === "image") return `[image:${chunk.mimeType || "unknown"}]`;
      return JSON.stringify(chunk);
    })
    .join("\n")
    .slice(0, 8_000);
}

async function runMcpSequence(name, server, calls, timeoutMs = 180_000) {
  const startedAt = Date.now();
  const client = new Client({ name: "operator-component-smoke", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport(server);
  const callResults = [];
  try {
    await withTimeout(client.connect(transport), timeoutMs, `${name} connect`);
    for (const call of calls) {
      const callStartedAt = Date.now();
      const result = await withTimeout(
        client.callTool({ name: call.name, arguments: call.arguments || {} }),
        call.timeoutMs || timeoutMs,
        `${name} ${call.name}`
      );
      callResults.push({
        name: call.name,
        ok: true,
        durationMs: Date.now() - callStartedAt,
        textExcerpt: contentText(result)
      });
    }
    await client.close();
    return { name, ok: true, durationMs: Date.now() - startedAt, calls: callResults };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors after failed startup.
    }
    return { name, ok: false, durationMs: Date.now() - startedAt, calls: callResults, error: error.message };
  }
}

await ensureDirs();

const results = [];

results.push(
  await runMcpSequence(
    "mcp-fetch-example",
    {
      command: "uvx",
      args: ["mcp-server-fetch"]
    },
    [
      {
        name: "fetch",
        arguments: {
          url: "https://example.com",
          max_length: 2000
        }
      }
    ],
    90_000
  )
);

results.push(
  await runMcpSequence(
    "playwright-mcp-example",
    {
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--headless"]
    },
    [
      {
        name: "browser_navigate",
        arguments: {
          url: "https://example.com"
        },
        timeoutMs: 120_000
      },
      {
        name: "browser_snapshot",
        arguments: {
          depth: 3
        },
        timeoutMs: 120_000
      }
    ],
    180_000
  )
);

await writeJson("component-smoke.json", {
  generatedAt: new Date().toISOString(),
  results
});

console.log("Wrote results/component-smoke.json");
