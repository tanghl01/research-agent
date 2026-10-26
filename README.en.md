# Operator

English | [中文](README.md)

Operator is a Mastra-based web/API platform for running external agent
runtimes, exposing reusable Workspace Skills, and shipping selected
platform-owned workflows.

The current chat path is intentionally shallow: Operator does not keep a
separate routing agent or a hardcoded task handler in front of the executor.
User chat is passed from the Next.js web/API layer into the Mastra app, then to
the configured main execution runtime. Mastra owns scope metadata,
Workspace Skill context, deterministic workflows, workspace setup, artifact
capture, and the optional account-backed backend.

```text
User chat
  -> Operator Next.js web/API layer
  -> @operator/mastra-app
  -> main execution agent, codex-acp by default
  -> optional fallback runtimes
  -> selected Workspace Skill or deterministic workflow context
  -> task workspace
  -> artifacts + manifest + chat result
```

## Current Source Layout

```text
apps/mastra/
  src/chat.ts                main chat harness
  src/agents/runtime.ts      main/fallback agent runtime registration
  src/product-scopes/        user-selectable execution scopes, contracts, and routing metadata
  src/workspace.ts           Mastra workspace and Workspace SkillSource setup
  src/skills/                Operator skill catalog and source resolver
  src/tools/                 web search/fetch/download tools
  src/workflows/             deterministic system, industrial, and research workflows
  tests/                     runtime, scope, workflow, and tool tests

apps/web/
  app/api/operator/          Next.js API routes for chat, tasks, artifacts, scopes
  app/api/admin/             admin/session/user routes
  components/                workbench, chat thread, drive/admin/task preview UI
  lib/                       backend, AG-UI, artifact, task, and scope helpers
  e2e/                       Playwright UI smoke tests

packages/operator-contracts/ framework-agnostic product contracts: run/task/artifact/scope schemas
packages/core/               env, workspace, skill manifest, artifact, validation helpers
packages/db/                 Drizzle schema, migrations, and seed helpers
packages/identity/           OIDC/session helpers
packages/storage/            local filesystem and S3-compatible storage adapters
packages/queue/              Redis/BullMQ queue adapter

skills/
  manifests/                 committed skill manifests
  adapters/                  Operator-owned adapter guidance
  local/                     committed lightweight Operator skills
  vendored/                  ignored local upstream skill checkouts

deploy/                      ECS deployment files
docs/                        specs, runbooks, architecture notes, and pitch materials
lab/                         local research/evaluation scripts and results
```

`apps/mastra/src/product-scopes/` is the user-selectable execution scope
catalog. It stores product metadata, output contracts, and routing policy, not a
second execution framework.

## Runtime Agents

The default main execution runtime is `codex-acp`. It launches the host-local
Codex CLI through Agent Client Protocol using the service user's `CODEX_HOME`.
All external execution agents are registered and scheduled through the Mastra
ACP agent runtime.

Default runtime order in production config:

```text
OPERATOR_DEFAULT_AGENT_SCOPE=codex-acp
OPERATOR_AGENT_FALLBACK_ORDER=codex-acp,codex-acp-packycode,claude-code-acp-packycode,claude-code-acp,openhands-acp
OPERATOR_CODEX_ACP_COMMAND=codex-acp
OPERATOR_CODEX_ACP_CWD=/opt/operator
```

ACP runtimes can be registered with prefix variables:

```text
OPERATOR_CODEX_ACP_COMMAND=...
OPERATOR_CODEX_ACP_ARGS=...
OPERATOR_CODEX_ACP_CWD=...
OPERATOR_CODEX_ACP_ENV=...
```

Multiple runtimes can also be registered as JSON:

```text
OPERATOR_MASTRA_ACP_AGENTS_JSON=[
  {
    "id": "codex-acp",
    "name": "Codex ACP",
    "description": "Codex through ACP",
    "command": "npx",
    "args": ["-y", "@agentclientprotocol/codex-acp"],
    "persistSession": false
  }
]
```

These env values only declare agent capabilities. Runtime fallback only uses
agents that have passed the unified capability lifecycle. After configuring or
changing agents, run:

```bash
pnpm capabilities:sync --all --kind agent
```

Supported convenience prefixes:

- `OPERATOR_CODEX_ACP_*`
- `OPERATOR_CODEX_ACP_PACKYCODE_*`
- `OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_*`
- `OPERATOR_CLAUDE_CODE_ACP_*`
- `OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_*`
- `OPERATOR_OPENHANDS_ACP_*`

Known ACP wrappers used by this repo include
`@agentclientprotocol/codex-acp` and `@agentclientprotocol/claude-agent-acp`.
`codex-acp-packycode` uses a separate `CODEX_HOME` to reach PackyCode's
OpenAI-compatible Responses API, and `claude-code-acp-packycode` reuses the
Claude Code ACP wrapper to reach PackyCode's Anthropic-compatible
`/v1/messages`. Enable them only when `OPERATOR_PACKY_API_KEY` is configured,
placed as the second and third candidates after `codex-acp`.
`claude-code-acp-deepseek` is an optional fallback; add it only after both
`OPERATOR_DEEPSEEK_API_KEY` and `OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_COMMAND`
are configured.
The current convention is that `claude-code-acp` and `openhands-acp` use the
Agnes `agnes-2.0-flash` model. OpenHands still registers only when an
ACP-compatible runtime command is configured; a plain interactive CLI is not
enough.

The full environment variable reference is
[`docs/runbooks/Operator_Environment_Variables.md`](docs/runbooks/Operator_Environment_Variables.md).

## User-Selectable Execution Scopes

The web scope picker is a scoped execution surface, not a raw runtime
switcher. Agent runtime choices and Mastra web tools are kept out of the user
tag surface.

Current user-facing scope data comes from
`listUserScopeSelectionCatalog()`:

- Skills are returned as user-selectable scopes.
- Workflow scope metadata for `industrial.*` and `research.*` workflows is
  returned by the API catalog.
- The current composer flattens skills plus industrial-prefixed workflows into
  selectable tags.

When no scope is selected, chat uses the general main execution agent
without injecting the full Operator skill catalog. When a skill is selected,
Operator exposes that single skill package and execution guidance to the main
agent for the run. When a deterministic workflow is selected, Mastra runs that
workflow directly.

## Skills

Registered Workspace Skill scopes:

- `gorden-ppt-skill`: upstream `GordenPPTSkill`, used for editable PPTX output.
- `guizang-ppt-skill`: upstream `guizang-ppt-skill`, used for single-file HTML decks.
- `ppt-master`: `hugohe3/ppt-master`, used for SVG-first PPTX generation research.
- `scientific-agent-skills`: `K-Dense-AI/scientific-agent-skills`, exposed as a scientific skill collection.
- `text-to-cad`: `earthtojake/text-to-cad`, exposed as a CAD/design/manufacturing skill collection.
- `claude-for-legal`: `anthropics/claude-for-legal`, exposed as a legal workflow skill collection.
- `qinyan-academic-skills`: `LeonChaoX/qinyan-academic-skills`, an academic research skill collection covering paper search, paper analysis, citation formatting, and topic analysis.
- `industrial-leak-detection`: Operator-owned local skill for industrial leak and visual anomaly review.
- `industrial-meter-reading`: Operator-owned local skill for analog/digital industrial meter reading.

Committed skill metadata and local sources:

```text
skills/manifests/GordenPPTSkill.skill.json
skills/manifests/guizang-ppt-skill.skill.json
skills/manifests/ppt-master.skill.json
skills/manifests/scientific-agent-skills.skill.json
skills/manifests/text-to-cad.skill.json
skills/manifests/claude-for-legal.skill.json
skills/manifests/qinyan-academic-skills.skill.json
skills/manifests/industrial-leak-detection.skill.json
skills/manifests/industrial-meter-reading.skill.json
skills/manifests/Biomni.skill.json
skills/local/industrial-leak-detection/
skills/local/industrial-meter-reading/
skills/adapters/text-to-cad-cad.md
```

`Biomni.skill.json` is currently a manifest for an external agent package. It is
not exposed as a Workspace Skill in the current Mastra skill catalog.

Full upstream skill repositories are runtime inputs and should not be committed.
Ignored local checkouts live under `skills/vendored/`. Sync them when needed:

```bash
pnpm capabilities:sync GordenPPTSkill
pnpm capabilities:sync --all --kind skill
```

`pnpm capabilities:sync` is the unified capability package lifecycle entrypoint:
it installs, checks required configuration, validates core capability examples,
registers, deploys, enables, and writes a capability receipt.
`pnpm capabilities:sync --all --kind skill`
auto-discovers every `agent_skill` and `agent_skill_collection` manifest with a git source and syncs it. ECS
deployment uses the same auto-discovery flow, so adding a new GitHub-backed
skill no longer requires maintaining a manual skill allowlist in the deploy
script. External agent packages such as `Biomni` are skipped by `--all`
unless `--include-external` is passed explicitly.

`apps/mastra/src/skills/operator-skill-source.ts` exposes a virtual
`skills/mastra` root to Mastra. Collection-style repositories can receive a
virtual `SKILL.md` wrapper without copying or modifying upstream source.

## Workflows

Deterministic Mastra workflows are reserved for stable platform-owned flows with
fixed output contracts.

- `system.skill2workflow`: converts a text-heavy skill into a generated Mastra workflow pack. This is a developer/system workflow.
- `industrial.daily-monitoring-report`: compiles industrial leak findings and meter readings into a LaTeX/PDF daily monitoring report.
- `research.paper-from-results`: validates result bundles and produces a claim-backed manuscript handoff through the native TypeScript research pipeline.

## Optional Backend

Operator can run with only local task/workspace files, or with the self-hosted
backend enabled.

The backend packages cover:

- PostgreSQL schema, migrations, tasks, conversations, users, credits, and drive metadata.
- OIDC/session helpers, phone-code login, and safety email binding.
- Local filesystem and S3-compatible object storage.
- Redis/BullMQ queue integration and production rate limiting.
- Admin pages and API routes.

Backend mode is controlled by `OPERATOR_BACKEND_ENABLED`, `DATABASE_URL`,
identity settings, storage settings, and optional `REDIS_URL`. Check
`/api/operator/backend/status` on a running deployment before assuming backend
services are active.

## Run Locally

Install dependencies:

```bash
pnpm install
```

Configure at least one main execution runtime in `.env`, then run a chat
request:

```bash
pnpm chat --workspace tmp/runs/operator-chat-example --prompt '请生成一份可编辑 PPTX 和一份 HTML 网页 PPT'
```

Run the skill-to-workflow converter:

```bash
pnpm workflow:skill2workflow \
  --workspace tmp/runs/skill2workflow-example \
  --input-json '{"topic":"转换一个 GitHub skill","output_format":"workflow_pack","skill_root":"apps/mastra/tests/fixtures/text-skill","target_workflow_id":"example.converted_skill","codex_mode":"disabled"}'
```

Start the web app:

```bash
pnpm --filter @operator/web dev
```

## Verify

```bash
pnpm typecheck
pnpm test
```

Optional UI smoke tests:

```bash
pnpm --filter @operator/web test:e2e
```

`apps/mastra/tests/operator-chat.test.ts` fails honestly when no main agent is
configured. PPT integration tests are skipped by default and require:

```text
OPERATOR_RUN_PPT_INTEGRATION=1
```

Those tests also require a real configured ACP agent capable of reading Mastra
Workspace Skills and writing artifacts.

## Deployment Notes

ECS deployment files live under `deploy/ecs/`. The current ECS baseline uses
`codex-acp` to call the host-local Codex CLI through ACP; when the deploy
secrets provide `OPERATOR_PACKY_API_KEY`, the install script automatically
enables `codex-acp-packycode` as the second candidate.

The current ECS deployment is an internal beta: it runs `NODE_ENV=production`
for optimized Next.js behavior but `OPERATOR_DEPLOYMENT_STAGE=staging` for
product policy (for example local object storage is still allowed). Formal
production should set `OPERATOR_DEPLOYMENT_STAGE=production` and use
S3-compatible object storage.

Verify the active service before treating a host or domain as the Operator
deployment:

```bash
curl -fsS http://47.84.225.120/healthz
curl -fsS http://47.84.225.120/api/operator/scopes
curl -fsS http://47.84.225.120/api/operator/backend/status
```

The public domain can be moved independently of the Operator service. Prefer the
health endpoint and deployment runbook over assuming a fixed hostname.
