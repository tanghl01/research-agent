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

const baseEnv = {
  ...process.env,
  BRAVE_API_KEY: process.env.BRAVE_API_KEY || "operator_dummy_key",
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || "operator_dummy_key",
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || "operator_dummy_key",
  EXA_API_KEY: process.env.EXA_API_KEY || "operator_dummy_key",
  BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY || "operator_dummy_key",
  BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID || "operator_dummy_project"
};

const servers = [
  {
    name: "playwright-mcp",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--headless"]
  },
  {
    name: "mcp-fetch",
    command: "uvx",
    args: ["mcp-server-fetch"]
  },
  {
    name: "tavily-mcp",
    command: "npx",
    args: ["-y", "tavily-mcp@latest"],
    env: baseEnv
  },
  {
    name: "exa-mcp",
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    env: baseEnv
  },
  {
    name: "brave-search-mcp",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"],
    env: baseEnv
  },
  {
    name: "firecrawl-mcp",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: baseEnv
  },
  {
    name: "browserbase-mcp",
    command: "npx",
    args: ["-y", "@browserbasehq/mcp"],
    env: baseEnv
  }
];

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

async function discover(server) {
  const startedAt = Date.now();
  const client = new Client(
    {
      name: "operator-agent-runtime-lab",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: server.env || process.env
  });

  try {
    await withTimeout(client.connect(transport), 90_000, `${server.name} connect`);
    const tools = await withTimeout(client.listTools(), 45_000, `${server.name} listTools`);
    await client.close();
    return {
      name: server.name,
      ok: true,
      durationMs: Date.now() - startedAt,
      tools: (tools.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors after failed startup.
    }
    return {
      name: server.name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error.message
    };
  }
}

await ensureDirs();

const results = [];
for (const server of servers) {
  console.log(`Discovering ${server.name}...`);
  results.push(await discover(server));
}

await writeJson("mcp-tool-discovery.json", {
  generatedAt: new Date().toISOString(),
  results
});

console.log("Wrote results/mcp-tool-discovery.json");
