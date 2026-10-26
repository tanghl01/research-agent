# Claude Code Source Reuse Assessment

Generated: 2026-06-14

Source folders inspected:

- `/home/biostar/work/forks/claude-code-source-code`
- `/home/biostar/work/forks/claude-code-source-code-gateway`

## Finding

The folder contains a decompiled/reconstructed Claude Code 2.1.88 source tree. It is useful as an architecture reference, but it should not be directly copied into Operator.

Reasons:

- The repository README states the code is Anthropic intellectual property, for research/education only, and commercial use is prohibited.
- The source is incomplete. Its README says 108 feature-gated internal modules are missing.
- It depends heavily on Anthropic SDK message schemas, Bun compile-time intrinsics (`feature`, `MACRO`, `bun:bundle`), internal feature flags, generated types, telemetry, GrowthBook, and Claude-specific provider behavior.
- The SDK-facing type entrypoint has multiple `throw new Error('not implemented')` functions, so the tree is not a clean reusable SDK package.

## What Can Be Reused Safely

### 1. Process-level reuse

Use official `claude` CLI as an external runtime process and parse `--output-format stream-json` or `json`.

This is the safest route. Operator should treat Claude Code as one `AgentRuntime` adapter, not import its internal files.

### 2. Gateway pattern

The `claude-code-source-code-gateway` fork adds:

- `ops/gateway/litellm.anthropic-compat.yaml`
- `scripts/start-litellm-openai-gateway.sh`
- `scripts/run-claude-via-openai-gateway.sh`
- `docs/en/06-openai-gateway-route.md`

The documented stable path is: keep Claude Code unchanged, point `ANTHROPIC_BASE_URL` to an Anthropic-compatible gateway, and translate backend requests.

This is directly relevant to Operator if we want `Claude Code + CCR/LiteLLM + Agnes/OpenAI-compatible model`.

### 3. Architecture patterns

Use these as design references, not copied code:

- `QueryEngine`: persistent conversation lifecycle and stream event normalization.
- `query.ts`: core loop around model response, tool use, compaction, retry, and final result.
- `Tool.ts`: tool schema, permission context, result mapping, progress, and concurrency metadata.
- `tools.ts`: central tool registry and preset filtering.
- `services/tools/toolOrchestration.ts`: partitions tool calls into concurrent read-only batches and serial mutation batches.
- `entrypoints/sdk/controlSchemas.ts`: control protocol shape for permissions, MCP status, interrupt, model switch, context usage.
- `remote/sdkMessageAdapter.ts`: maps SDK messages into UI/renderable message types.

## What Should Not Be Directly Reused

### WebSearchTool

`WebSearchTool` uses Anthropic's server-side `web_search_20250305` beta tool through the Anthropic Messages API. It is not a generic search implementation.

Implication: when Claude Code is routed through CCR/Agnes/OpenAI-compatible providers, the original WebSearch feature does not automatically transfer. This matches our runtime test result: Claude+CCR can execute shell/file/download tasks, but does not become Codex-like for hard open web search.

### WebFetchTool

`WebFetchTool` is closer to a reusable pattern, but not directly reusable:

- It uses Anthropic domain preflight (`https://api.anthropic.com/api/web/domain_info`).
- It calls a secondary Claude model to summarize markdown.
- It uses internal storage, settings, telemetry, and permission code.

Operator should reimplement this feature with a clean adapter:

- `fetchUrlToMarkdown`
- `saveBinaryArtifact`
- `summarizePage`
- `domainAllow/Deny policy`
- `artifact manifest`

### Bash/File Tools

The Bash and file tools are valuable references for behavior:

- command descriptions;
- read/search/list classification;
- read-only concurrency;
- silent command handling;
- sandbox and destructive-command validation.

But the implementation is too coupled to Claude Code state, UI, telemetry, permission hooks, sandbox adapter, and file history. Rebuild the subset Operator needs.

## Recommended Operator Direction

Build Operator's own runtime abstraction:

```text
AgentRuntime
  run(task, workspace, options) -> AsyncIterable<AgentEvent>
  cancel(runId)
  health()
  artifacts(runId)
```

Adapters:

```text
codex-cli
gemini-cli
claude-code-cli
openhands-agent-server
```

Common events:

```text
thought | action | observation | tool_progress | artifact | final | error
```

Common built-in tools for non-Codex runtimes:

```text
search_web
fetch_url
download_file
browser_snapshot
run_shell
read_file
write_file
edit_file
task_tracker
```

## Practical Conclusion

Direct reuse level:

- Copy source files into Operator: no.
- Import as a library: no.
- Run official Claude Code CLI as a subprocess: yes.
- Reuse gateway route and env pattern: yes.
- Reimplement clean-room versions of WebFetch/download/event concepts: yes.
- Use this tree to understand why Codex/Claude Code feel complete: yes.

For the current Operator objective, this folder supports the earlier conclusion: a Codex-like experience should be implemented as a Operator-controlled runtime layer with multiple adapters, not by trying to transplant OpenHands or Claude Code internals.
