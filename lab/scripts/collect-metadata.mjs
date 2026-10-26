import { ensureDirs, fetchJson, runCommand, summarizeOutput, writeJson } from "./lib.mjs";

const githubRepos = [
  "openai/codex",
  "google-gemini/gemini-cli",
  "cline/cline",
  "opencode-ai/opencode",
  "OpenHands/OpenHands",
  "Aider-AI/aider",
  "SWE-agent/mini-swe-agent",
  "langchain-ai/deepagents",
  "tavily-ai/tavily-mcp",
  "exa-labs/exa-mcp-server",
  "brave/brave-search-mcp-server",
  "firecrawl/firecrawl-mcp-server",
  "unclecode/crawl4ai",
  "microsoft/playwright-mcp",
  "browser-use/browser-use",
  "browserbase/stagehand",
  "browserbase/mcp-server-browserbase",
  "assafelovic/gpt-researcher",
  "langchain-ai/open_deep_research",
  "harbor-framework/terminal-bench"
];

const npmPackages = [
  "@google/gemini-cli",
  "cline",
  "opencode-ai",
  "opencode",
  "@playwright/mcp",
  "tavily-mcp",
  "exa-mcp-server",
  "@brave/brave-search-mcp-server",
  "firecrawl-mcp",
  "@browserbasehq/mcp",
  "@browserbasehq/stagehand"
];

const pythonPackages = [
  "aider-chat",
  "browser-use",
  "crawl4ai",
  "gpt-researcher",
  "terminal-bench",
  "mini-swe-agent",
  "deepagents-cli",
  "mcp-server-fetch"
];

async function githubMetadata(repo) {
  try {
    const data = await fetchJson(`https://api.github.com/repos/${repo}`);
    return {
      repo,
      ok: true,
      fullName: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      license: data.license?.spdx_id ?? null,
      updatedAt: data.updated_at,
      url: data.html_url
    };
  } catch (error) {
    return { repo, ok: false, error: error.message };
  }
}

async function npmMetadata(pkg) {
  const result = await runCommand(
    "npm",
    ["view", pkg, "name", "version", "description", "license", "homepage", "repository", "--json"],
    { timeoutMs: 45_000 }
  );
  if (!result.ok) return { package: pkg, ok: false, command: summarizeOutput(result) };
  try {
    const data = JSON.parse(result.stdout);
    return {
      package: pkg,
      ok: true,
      version: data.version,
      description: data.description,
      license: data.license,
      homepage: data.homepage,
      repository: data.repository?.url ?? data.repository ?? null
    };
  } catch (error) {
    return { package: pkg, ok: false, error: error.message, command: summarizeOutput(result) };
  }
}

async function pypiMetadata(pkg) {
  try {
    const data = await fetchJson(`https://pypi.org/pypi/${pkg}/json`);
    return {
      package: pkg,
      ok: true,
      version: data.info.version,
      summary: data.info.summary,
      license: data.info.license_expression || data.info.license || null,
      homePage: data.info.home_page,
      projectUrls: data.info.project_urls
    };
  } catch (error) {
    return { package: pkg, ok: false, error: error.message };
  }
}

await ensureDirs();

const [github, npm, pypi] = await Promise.all([
  Promise.all(githubRepos.map(githubMetadata)),
  Promise.all(npmPackages.map(npmMetadata)),
  Promise.all(pythonPackages.map(pypiMetadata))
]);

await writeJson("tool-metadata.json", {
  generatedAt: new Date().toISOString(),
  github,
  npm,
  pypi
});

console.log("Wrote results/tool-metadata.json");
