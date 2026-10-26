# Codex-like Agent Runtime Follow-up Results

Generated: 2026-06-14

## Test Goal

Find an agent/runtime combination that approaches Codex desktop/cloud behavior for Operator's default open-ended agent:

- answer normal chat requests;
- call tools without manual tag selection;
- write and read local files;
- download binary artifacts correctly;
- perform open web/search tasks;
- terminate with a useful final response or a useful failure report.

## Summary

| Runtime / config | File task | Known PDF download | Open web download | Notes |
| --- | --- | --- | --- | --- |
| Codex CLI baseline | Pass | Pass | Pass | Best current baseline. Found and downloaded `2026上海高考数学.pdf` from `deekur/gaokaomath`. |
| Gemini CLI, `gemini-2.5-flash` | Pass | Pass | Partial | Has native `google_web_search` and `web_fetch`, but failed to find the GitHub PDF source that Codex found. It produced a structured `download_report.md` instead of hanging. |
| Claude Code + CCR + Agnes | Pass | Pass | Pass for easy repo lookup; not proven for hard open search | Solid shell/file/download execution once auth is isolated. No native WebSearch through CCR in these tests. |
| Claude Code + CCR + MCP fetch/playwright | Fail / unstable | Not run | Not run | MCP servers appeared as pending; model did not call MCP tools and instead tried to inspect config / run `mcp-server-fetch` as a CLI. Not suitable as default without adapter work. |
| OpenCode + Gemini isolated HOME | Pass | Fail | Partial | Global config is unsafe; isolated config avoids skill pollution. Binary download was corrupted by writing PDF through webfetch. |
| OpenHands Agent Server | Previously pass | Previously pass | Fail / timeout | Current `127.0.0.1:8005` service is not running. Historical benchmark shows simple answer, file, known PDF passed, but open web download timed out after 240s. |

## New Runs

### Codex CLI baseline

Prompt: find and download a directly downloadable 2026 Shanghai gaokao math PDF.

Result:

- Status: pass.
- Local artifact: `lab/runs/codex-open-web-download/2026上海高考数学.pdf`
- Size: `284951` bytes.
- SHA256: `4a231e51492921d0f7981e682decaa418f7da0986dc55aa314c4e14d8ed5641b`
- Source: `https://raw.githubusercontent.com/deekur/gaokaomath/main/%E6%99%AE%E9%80%9A%E9%AB%98%E8%80%83/2026/2026%E4%B8%8A%E6%B5%B7.pdf`

Observed behavior: Codex searched, inspected GitHub repository file listings, selected a raw PDF URL, downloaded it with `curl`, verified the PDF type, and returned a useful final response.

### Gemini CLI

Prompt: same 2026 Shanghai gaokao math PDF task.

Result:

- Status: partial.
- Local artifact: `lab/runs/gemini-open-web-download/download_report.md`
- Used tools: `google_web_search`, `web_fetch`, `write_file`.
- It searched web sources but did not find the GitHub `deekur/gaokaomath` repository.
- It terminated cleanly with a structured report instead of an empty final response or timeout.

Interpretation: Gemini CLI is much closer to Codex than OpenHands for default chat/agent UX because it has native search and a stable CLI loop. Its search recall is weaker than Codex on this task.

### Claude Code + CCR + Agnes

Config:

- CCR endpoint: `http://127.0.0.1:3457`
- Isolated Claude env: clean `HOME`, local CCR token in both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
- Claude flags: `--bare --no-session-persistence --setting-sources project --tools default --dangerously-skip-permissions`.

Results:

- File task: pass in about 5s.
- Known PDF download: pass, downloaded `dummy.pdf`, size `13264`, SHA256 `3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4`.
- Easy web repo lookup: pass, produced `github.com/microsoft/playwright-mcp`.
- MCP fetch/playwright attempt: fail/unstable. MCP servers remained pending and the model did not reliably use MCP tools.

Interpretation: Claude Code + CCR + Agnes is a good execution harness for shell/file/download tasks, but not yet a Codex-equivalent web/search agent unless a real search tool is exposed through a stable adapter.

### OpenHands

Current state:

- `OPERATOR_OPENHANDS_AGENT_SERVER_URL=http://127.0.0.1:8005`
- `GET /server_info`: connection refused.
- Current service is not available, so direct live tests cannot run.

Historical benchmark found in `tmp/agent-runtime-benchmark/summary-openhands-and-claude-default.json`:

- `simple_answer`: pass.
- `file_tool`: pass.
- `known_download`: pass.
- `open_web_download`: fail, timeout after `240000ms`.

Interpretation: OpenHands can execute known shell/file tasks when the Agent Server is running, but it is not currently configured as a Codex-like default runtime with reliable open web/search behavior.

## Recommendation

Best immediate default runtime for Operator:

1. Codex CLI adapter if licensing/deployment permits.
2. Gemini CLI adapter as the best currently tested non-Codex fallback.
3. Claude Code + CCR + Agnes as a strong execution backend for coding/file/download tasks, but pair it with a real first-class search/download adapter before making it default.

Do not use current OpenHands Agent Server as the sole default runtime for open-ended user tasks. It should remain optional until it has:

- a reliable one-command service bootstrap;
- guaranteed tool list including terminal, file editor, browser, task tracker;
- a first-class search tool, not only browser/shell;
- binary-safe download behavior;
- final-response enforcement and timeout recovery;
- isolated per-task workspace and no accidental user/global config reads.

## Operator Runtime Shape To Build

Recommended runtime abstraction:

```text
Operator task
  -> AgentRuntime adapter
       -> Codex CLI | Gemini CLI | Claude+CCR | OpenHands
       -> standardized events: thought/action/observation/artifact/final/error
       -> standardized workspace and artifact manifest
       -> timeout + cancellation + resume
       -> binary-safe download verification
```

Practical default order:

```text
defaultAgentRuntime = codex-cli if available
                   else gemini-cli if GOOGLE/GEMINI key is available
                   else claude-code-ccr if CCR is healthy
                   else openhands only if Agent Server /server_info is healthy
```

For OpenHands specifically, the next fix is not another prompt rule. It needs runtime bootstrap and tool provisioning, plus a true web/search component comparable to Codex `web_search`.
