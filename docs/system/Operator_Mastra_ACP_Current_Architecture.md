# Operator Mastra + ACP Current Architecture

Status: current MVP architecture after removing the self-developed
`operator-main-agent`, the legacy OpenHands HTTP adapter, and the previous
intermediate routing agent.

## Position

Operator is a Mastra-based deployment of external agents, skills, tools, workflows,
workspace management, artifacts, and front-end task UX.

Operator does not implement its own general-purpose agent loop in the MVP. The
Singapore production default user-facing executor is `codex-acp`, which runs the
host-local Codex CLI through Agent Client Protocol. Claude Code ACP (Agnes),
OpenHands ACP (Agnes), DeepSeek-backed Claude Code ACP, or future
domain-specific ACP runtimes can be registered as ordered fallbacks.

Mastra remains the system center for framework concerns: scope metadata,
tools, workflows, Workspace Skills, workspace policy, and artifact capture.

## User-Facing Scopes

The default chat path is the general execution agent with its own native
scopes. Operator does not expose the full skill catalog, tool catalog, or
workflow catalog to the default prompt.

User-facing scope tags represent skill scopes only. When a user selects a
skill tag, Operator exposes that single skill package, its source information, and
its execution guidance to the main agent for that run.

Agent runtimes, optional tools, and developer workflows are not user-facing
tags. Future platform work can add a curated general skill package and tool
package for the main agent, but that package should be designed as an explicit
runtime surface rather than leaking the internal registry by default.

## Runtime Flow

```text
User
  -> apps/web chat UI
  -> apps/web app/api/operator/chat
  -> apps/mastra runOperatorChat()
  -> codex-acp default main execution agent
  -> fallback runtime when an earlier configured runtime is unavailable
  -> Mastra tools / workflows / Workspace Skills context
  -> workspace artifacts
  -> Operator artifact manifest + task history + UI preview
```

`OPERATOR_AGENT_FALLBACK_ORDER` controls runtime order. The default is:

```text
codex-acp,claude-code-acp,openhands-acp
```

If no candidate runtime is configured, the run fails and records the missing
configuration in `chat_plan.json` and `chat_result.json`.

## Mastra Standard Boundaries

Operator should use Mastra standard primitives wherever they exist:

- Agent runtime: `@mastra/acp` `AcpAgent` for external main/fallback runtimes.
- Skills: Mastra Workspace Skills through `Workspace.skillSource`.
- Tools: Mastra `createTool`.
- Workflows: Mastra workflows for deterministic system processes.
- Workspace: Mastra `Workspace`, `LocalFilesystem`, and `LocalSandbox`.

Custom Operator code is allowed only around product concerns that Mastra does not
own:

- skill manifests and upstream repository resolution;
- virtual SkillSource wrappers for vendored or collection-style skills;
- scope catalog metadata for UI and routing context;
- per-run workspace path policy;
- artifact manifest and preview;
- task history;
- future user accounts, billing, permissions, and audit.

## Agent Registration

The default ACP runtime and optional fallbacks are declared by environment
configuration and enabled by the Operator capability lifecycle:

```text
OPERATOR_DEFAULT_AGENT_SCOPE=codex-acp
OPERATOR_AGENT_FALLBACK_ORDER=codex-acp,claude-code-acp,openhands-acp
OPERATOR_CODEX_ACP_COMMAND=codex-acp
OPERATOR_CODEX_ACP_CWD=/opt/operator
OPERATOR_MASTRA_ACP_AGENTS_JSON=[...]
```

External agent configs must provide an ACP command. Endpoint-only HTTP agent
configs are rejected during capability registration. Runtime fallback only reads
agents with an enabled `kind=agent, adapter=acp-agent` receipt; run
`pnpm capabilities:sync --all --kind agent` after changing ACP agent config.

Convenience prefixes:

```text
OPERATOR_CODEX_ACP_*
OPERATOR_CLAUDE_CODE_ACP_*
OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_*
OPERATOR_OPENHANDS_ACP_*
```

DeepSeek is optional. Register it only after `OPERATOR_DEEPSEEK_API_KEY` and an
ACP command are configured, then append `claude-code-acp-deepseek` to the
fallback order.

Known ACP wrappers currently used by this deployment are
`@agentclientprotocol/codex-acp` and `@agentclientprotocol/claude-agent-acp`.
OpenHands should be registered only when an ACP-compatible runtime command is
available; a plain interactive CLI is not enough for this path.

Claude Code ACP (Agnes) selects `agnes-2.0-flash` through both the ACP `model`
option and Claude-compatible model environment variables. OpenHands ACP (Agnes)
uses `OPERATOR_OPENHANDS_ACP_MODEL=agnes-2.0-flash` plus OpenAI-compatible Agnes
environment variables when an OpenHands ACP command is provided.

OpenHands has no special adapter in the current architecture. If OpenHands is
used, it must expose an ACP-compatible entrypoint and be configured like every
other fallback runtime.

## Skill Registration

Operator skill manifests live under `skills/manifests`. Upstream skill repositories
are resolved into `skills/vendored` or external configured paths. Mastra sees
them through the virtual root:

```text
skills/mastra/<mastra-skill-name>/SKILL.md
```

`apps/mastra/src/skills/operator-skill-source.ts` maps that virtual root to the
actual upstream repository or subskill. This keeps Operator aligned with Mastra
Workspace Skills without copying upstream source into application code.

## Chat Semantics

`apps/mastra/src/chat.ts` is a thin harness:

1. Create a run id and workspace.
2. Record request context and available scopes.
3. Call `runOperatorAgent()` with the default or selected ACP runtime.
4. Try configured fallback runtimes in order when a runtime fails to produce a
   usable result.
5. Write `chat_plan.json`, `chat_result.json`, and `artifact_manifest.json`.
6. Collect any files the agent created in the workspace.

It does not:

- select skills with a custom Operator prompt;
- execute skills through a Operator-owned OpenHands bridge;
- synthesize fake artifacts when an agent is missing;
- implement a parallel Operator main agent loop.

## Implications

The MVP quality now depends on the configured runtime chain. Codex through ACP
is the default internal test runtime. Claude Code ACP (Agnes), OpenHands ACP
(Agnes), DeepSeek-backed Claude Code ACP, or later domain-specific agents can be
added through the same registration path.

Operator's product value is not a homegrown coding agent. Its value is the skill
catalog, industry/task scopes, workspace and artifact protocol, UI, governance,
deployment, and future billing/account system.
