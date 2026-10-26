import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDirs,
  hasEnv,
  redactEnvPresence,
  repoRoot,
  runCommand,
  runsDir,
  summarizeOutput,
  writeJson
} from "./lib.mjs";

const envPresence = redactEnvPresence([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "BRAVE_API_KEY",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "BROWSERBASE_API_KEY"
]);

const cliChecks = [
  { name: "codex", command: "codex", args: ["--version"] },
  { name: "gemini-cli", command: "npx", args: ["-y", "@google/gemini-cli", "--version"], timeoutMs: 90_000 },
  { name: "cline", command: "npx", args: ["-y", "cline", "--version"], timeoutMs: 90_000 },
  { name: "opencode-ai", command: "npx", args: ["-y", "opencode-ai", "--version"], timeoutMs: 90_000 },
  { name: "opencode", command: "npx", args: ["-y", "opencode", "--version"], timeoutMs: 90_000 },
  { name: "aider", command: "uvx", args: ["--from", "aider-chat", "aider", "--version"], timeoutMs: 120_000 },
  { name: "mini-swe-agent", command: "uvx", args: ["--from", "mini-swe-agent", "mini", "--help"], timeoutMs: 120_000 },
  { name: "browser-use", command: "uvx", args: ["--from", "browser-use", "browser-use", "--help"], timeoutMs: 180_000 },
  { name: "crawl4ai", command: "uvx", args: ["--from", "crawl4ai", "crwl", "--help"], timeoutMs: 180_000 },
  { name: "gpt-researcher", command: "uvx", args: ["--from", "gpt-researcher", "python", "-c", "import gpt_researcher; print('gpt-researcher import ok')"], timeoutMs: 180_000 },
  { name: "terminal-bench", command: "uvx", args: ["--from", "terminal-bench", "tb", "--help"], timeoutMs: 180_000 },
  { name: "deepagents-cli", command: "uvx", args: ["--from", "deepagents-cli", "deepagents", "--help"], timeoutMs: 180_000 }
];

async function runCliChecks() {
  const results = [];
  for (const check of cliChecks) {
    console.log(`CLI smoke: ${check.name}`);
    const result = await runCommand(check.command, check.args, {
      cwd: repoRoot,
      timeoutMs: check.timeoutMs || 60_000
    });
    results.push({
      name: check.name,
      command: [check.command, ...check.args].join(" "),
      ...summarizeOutput(result)
    });
  }
  return results;
}

async function runCodexBaseline() {
  const workdir = path.join(runsDir, "codex-baseline");
  await mkdir(workdir, { recursive: true });
  const prompt = [
    "You are running a smoke test for an agent runtime.",
    "Create a file named agent-smoke.txt in the current directory.",
    "The file must contain exactly this line:",
    "runtime-ok",
    "Then reply with a short JSON object: {\"done\":true}."
  ].join("\n");

  const result = await runCommand(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      workdir,
      prompt
    ],
    {
      cwd: workdir,
      timeoutMs: 240_000,
      maxOutput: 120_000
    }
  );

  let fileContent = null;
  try {
    fileContent = await readFile(path.join(workdir, "agent-smoke.txt"), "utf8");
  } catch {
    fileContent = null;
  }

  return {
    name: "codex-baseline-file-task",
    workdir,
    expectedFileCreated: fileContent === "runtime-ok\n" || fileContent === "runtime-ok",
    fileContent,
    command: summarizeOutput(result, 12_000)
  };
}

async function runCodexWebBaseline() {
  const workdir = path.join(runsDir, "codex-web-baseline");
  await mkdir(workdir, { recursive: true });
  const prompt = [
    "Find the current GitHub repository URL for Microsoft Playwright MCP.",
    "Use available tools as needed.",
    "Create web-smoke.md with exactly two lines:",
    "url: <repo-url>",
    "summary: <one concise sentence>",
    "Then reply done."
  ].join("\n");

  const result = await runCommand(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      workdir,
      prompt
    ],
    {
      cwd: workdir,
      timeoutMs: 300_000,
      maxOutput: 160_000
    }
  );

  let fileContent = null;
  try {
    fileContent = await readFile(path.join(workdir, "web-smoke.md"), "utf8");
  } catch {
    fileContent = null;
  }

  const containsExpectedUrl = Boolean(fileContent?.includes("github.com/microsoft/playwright-mcp"));
  return {
    name: "codex-baseline-web-task",
    workdir,
    expectedFileCreated: containsExpectedUrl,
    fileContent,
    command: summarizeOutput(result, 16_000)
  };
}

async function writeSmallBenchmarkManifest() {
  const manifest = {
    name: "operator-micro-agent-runtime-bench",
    generatedAt: new Date().toISOString(),
    purpose: "Fast smoke tasks for comparing agent runtimes before running a larger benchmark such as Terminal-Bench.",
    tasks: [
      {
        id: "file-create-exact",
        taskArea: "filesystem",
        prompt: "Create agent-smoke.txt containing exactly runtime-ok.",
        verifier: "File exists and content equals runtime-ok."
      },
      {
        id: "web-current-source",
        taskArea: "web/search/fetch",
        prompt: "Find the current GitHub repository URL for Microsoft Playwright MCP and write it to web-smoke.md.",
        verifier: "File exists and contains github.com/microsoft/playwright-mcp."
      },
      {
        id: "download-known-url",
        taskArea: "download/artifact",
        prompt: "Download https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf and report size/sha256.",
        verifier: "PDF exists, nonzero size, sha256 matches expected baseline."
      }
    ],
    largerBenchmarkCandidate: {
      name: "Terminal-Bench",
      repo: "https://github.com/harbor-framework/terminal-bench",
      reason: "Terminal-based end-to-end agent tasks map well to Operator's coding/runtime requirements."
    }
  };
  await writeFile(path.join("results", "micro-benchmark-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

await ensureDirs();
await writeSmallBenchmarkManifest();

const cli = await runCliChecks();
const codexFile = await runCodexBaseline();
const codexWeb = await runCodexWebBaseline();

await writeJson("runtime-smoke.json", {
  generatedAt: new Date().toISOString(),
  envPresence,
  notes: [
    "Credentialed runtime tests are intentionally limited in this first pass.",
    "Codex baseline is run because a local codex CLI is available.",
    "Other runtimes are checked for installability/help/version unless credentials and non-interactive config are present."
  ],
  cli,
  codex: [codexFile, codexWeb],
  credentialHints: {
    geminiRunnable: hasEnv("GEMINI_API_KEY") || hasEnv("GOOGLE_API_KEY"),
    clineRunnable: hasEnv("ANTHROPIC_API_KEY") || hasEnv("OPENAI_API_KEY"),
    opencodeRunnable: hasEnv("ANTHROPIC_API_KEY") || hasEnv("OPENAI_API_KEY"),
    webSearchRunnable: hasEnv("TAVILY_API_KEY") || hasEnv("EXA_API_KEY") || hasEnv("BRAVE_API_KEY") || hasEnv("FIRECRAWL_API_KEY")
  }
});

console.log("Wrote results/runtime-smoke.json");
