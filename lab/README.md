# Operator Agent Runtime Lab

This lab evaluates whether Operator should keep OpenHands as the default runtime, switch to another open runtime, or compose its own runtime around mature web/search/browser components.

The tests are intentionally split into two levels:

1. Zero-secret smoke tests: installability, CLI shape, MCP tool discovery, and declared tool surface.
2. Credentialed agent tests: only run when the relevant local credentials/configuration are already available.

Candidate groups:

- Runtime candidates: Codex CLI baseline, Gemini CLI, Cline, OpenCode, Aider, OpenHands, mini-swe-agent, DeepAgents CLI.
- Search/fetch MCP: Tavily, Exa, Brave Search, Firecrawl, MCP Fetch.
- Browser automation: Playwright MCP, browser-use, Browserbase MCP, Stagehand.
- Research agents/components: GPT Researcher, Open Deep Research, Crawl4AI.
- Benchmark reference: Terminal-Bench.

Run from the repository root:

```bash
cd lab
npm install
npm run all
```

Outputs are written to `lab/results/`.
