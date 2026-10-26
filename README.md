# Operator（算子）

中文 | [English](README.en.md)

Operator 是一个基于 Mastra 的 Web/API 平台，用于运行外部 Agent
runtime、暴露可复用的 Workspace Skills，并承载少量平台自有的确定性
workflow。

当前聊天路径刻意保持很薄：Operator 不再在执行器前保留一个额外的路由
Agent，也没有硬编码的窄任务处理器。用户消息从 Next.js Web/API 层进入
Mastra app，然后交给配置好的主执行 runtime。Mastra 负责 scope 元数据、
Workspace Skill 上下文、确定性 workflow、工作区初始化、产物捕获，以及可选
的账号后端。

```text
用户聊天
  -> Operator Next.js Web/API 层
  -> @operator/mastra-app
  -> 主执行 Agent，默认 codex-acp
  -> 可选 fallback runtime
  -> 选中的 Workspace Skill 或确定性 workflow 上下文
  -> 任务工作区
  -> artifacts + manifest + chat result
```

## 当前源码结构

```text
apps/mastra/
  src/chat.ts                主聊天 harness
  src/agents/runtime.ts      主/备用 Agent runtime 注册
  src/product-scopes/        用户可选执行范围、输出契约和路由元数据
  src/workspace.ts           Mastra workspace 和 Workspace SkillSource 初始化
  src/skills/                Operator skill 目录与 source resolver
  src/tools/                 web search/fetch/download tools
  src/workflows/             system、industrial、research 确定性 workflows
  tests/                     runtime、scope、workflow、tool 测试

apps/web/
  app/api/operator/          chat、tasks、artifacts、scopes 等 Next.js API
  app/api/admin/             admin、session、user 相关 API
  components/                workbench、chat thread、drive/admin/task preview UI
  lib/                       backend、AG-UI、artifact、task、scope helpers
  e2e/                       Playwright UI smoke tests

packages/operator-contracts/ 框架无关的产品契约：run/task/artifact/scope schema
packages/core/               env、workspace、skill manifest、artifact、validation helpers
packages/db/                 Drizzle schema、migrations、seed helpers
packages/identity/           OIDC/session helpers
packages/storage/            本地文件系统和 S3-compatible storage adapters
packages/queue/              Redis/BullMQ queue adapter

skills/
  manifests/                 已提交的 skill manifests
  adapters/                  Operator 自有 adapter guidance
  local/                     已提交的轻量级 Operator 本地 skills
  vendored/                  被 git 忽略的本地上游 skill checkouts

deploy/                      ECS 部署文件
docs/                        specs、runbooks、架构说明、路演材料
lab/                         本地研究、评估脚本与结果
```

`apps/mastra/src/product-scopes/` 是用户可选执行范围目录。它保存产品目录、
输出契约和路由策略，不是第二套执行框架。

## Runtime Agents

当前默认主执行 runtime 是 `codex-acp`。它通过 Agent Client Protocol 启动宿主
机本地 Codex CLI，并使用服务用户的 `CODEX_HOME`。所有外部执行 agent 都通过
Mastra ACP agent runtime 注册和调度。

生产配置里的默认 runtime 顺序：

```text
OPERATOR_DEFAULT_AGENT_SCOPE=codex-acp
OPERATOR_AGENT_FALLBACK_ORDER=codex-acp,codex-acp-packycode,claude-code-acp-packycode,claude-code-acp,openhands-acp
OPERATOR_CODEX_ACP_COMMAND=codex-acp
OPERATOR_CODEX_ACP_CWD=/opt/operator
```

ACP runtime 可以用前缀变量注册：

```text
OPERATOR_CODEX_ACP_COMMAND=...
OPERATOR_CODEX_ACP_ARGS=...
OPERATOR_CODEX_ACP_CWD=...
OPERATOR_CODEX_ACP_ENV=...
```

多个 runtime 也可以用 JSON 注册：

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

这些 env 只是 agent 能力声明。运行时 fallback 只会使用已通过统一能力生命周期的
agent；配置或变更后执行：

```bash
pnpm capabilities:sync --all --kind agent
```

当前支持的便捷前缀：

- `OPERATOR_CODEX_ACP_*`
- `OPERATOR_CODEX_ACP_PACKYCODE_*`
- `OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_*`
- `OPERATOR_CLAUDE_CODE_ACP_*`
- `OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_*`
- `OPERATOR_OPENHANDS_ACP_*`

本仓库当前用到的 ACP wrapper 包括
`@agentclientprotocol/codex-acp` 和 `@agentclientprotocol/claude-agent-acp`。
`codex-acp-packycode` 使用独立 `CODEX_HOME` 接入 PackyCode 的 OpenAI-compatible
Responses API，`claude-code-acp-packycode` 复用 Claude Code ACP wrapper 接入
PackyCode 的 Anthropic-compatible `/v1/messages`。建议只在
`OPERATOR_PACKY_API_KEY` 已配置时启用，并分别放在 `codex-acp` 之后作为第二、
第三候选。
`claude-code-acp-deepseek` 是可选兜底，只应在 `OPERATOR_DEEPSEEK_API_KEY`
和 `OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_COMMAND` 都配置后加入 fallback。
`claude-code-acp` 和 `openhands-acp` 的当前约定模型是 Agnes
`agnes-2.0-flash`；其中 OpenHands 仍需要实际提供 ACP-compatible command 才会注册。
OpenHands 只有在存在 ACP-compatible runtime command 时才应该注册；
普通交互式 CLI 不能直接用于这条路径。

完整环境变量说明见
[`docs/runbooks/Operator_Environment_Variables.md`](docs/runbooks/Operator_Environment_Variables.md)。

## 用户可选执行范围

Web 端 scope 选择器是“执行范围”选择器，不是原始 runtime 开关。Agent runtime
选项和 Mastra web tools 不直接暴露到用户标签面板。

当前用户可选执行范围数据来自 `listUserScopeSelectionCatalog()`：

- Skills 会作为用户可选 scope 返回。
- API catalog 会返回 `industrial.*` 和 `research.*` workflow 的 scope 元数据。
- 当前 composer 会把 skills 和 `industrial.*` workflows 展开成可选标签。

用户不选择 scope 时，聊天走通用主执行 Agent，不注入完整 Operator skill catalog。
用户选择 skill 时，Operator 只向主执行 Agent 暴露该单个 skill package 和执行
guidance。用户选择确定性 workflow 时，Mastra 会直接运行对应 workflow。

## Skills

当前注册的 Workspace Skill scopes：

- `gorden-ppt-skill`：上游 `GordenPPTSkill`，用于生成可编辑 PPTX。
- `guizang-ppt-skill`：上游 `guizang-ppt-skill`，用于生成单文件 HTML deck。
- `ppt-master`：`hugohe3/ppt-master`，用于 SVG-first PPTX 生成研究。
- `scientific-agent-skills`：`K-Dense-AI/scientific-agent-skills`，科研技能集合。
- `text-to-cad`：`earthtojake/text-to-cad`，CAD、设计、制造技能集合。
- `claude-for-legal`：`anthropics/claude-for-legal`，法律工作流技能集合。
- `qinyan-academic-skills`：`LeonChaoX/qinyan-academic-skills`，学术检索、论文分析、引文格式、选题分析等科研技能集合。
- `industrial-leak-detection`：Operator 自有本地 skill，用于工业泄漏和视觉异常复核。
- `industrial-meter-reading`：Operator 自有本地 skill，用于工业指针表/数显表读数。

已提交的 skill metadata 和本地 source：

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

`Biomni.skill.json` 目前是外部 agent package 的 manifest。它还没有作为
Workspace Skill 暴露到当前 Mastra skill catalog。

完整上游 skill 仓库是 runtime 输入，不应该提交。被 git 忽略的本地 checkout
放在 `skills/vendored/`。需要时同步：

```bash
pnpm capabilities:sync GordenPPTSkill
pnpm capabilities:sync --all --kind skill
```

`pnpm capabilities:sync` 是统一能力包生命周期入口，会执行安装、配置完整性检查、
核心能力验证、注册、部署和启用，并写入 capability receipt。
`pnpm capabilities:sync --all --kind skill` 会自动发现所有带 Git source 的 `agent_skill` 和
`agent_skill_collection` manifests 并同步。ECS 部署也使用这个自动发现流程，
新增 GitHub skill 时不再需要手工维护部署脚本里的 skill 白名单；外部 agent
package 如 `Biomni` 默认不会被 `--all` 同步，除非显式传
`--include-external`。

`apps/mastra/src/skills/operator-skill-source.ts` 向 Mastra 暴露一个虚拟
`skills/mastra` 根目录。集合型仓库可以获得虚拟 `SKILL.md` wrapper，不需要复制
或修改上游源码。

## Workflows

确定性 Mastra workflows 只用于输出契约稳定的平台自有流程。

- `system.skill2workflow`：把文本型 skill 转成生成的 Mastra workflow pack。它是 developer/system workflow。
- `industrial.daily-monitoring-report`：把工业泄漏发现和仪表读数汇总为 LaTeX/PDF 日常监测报告。
- `research.paper-from-results`：验证 result bundle，并通过原生 TypeScript research pipeline 生成 claim-backed manuscript handoff。

## 可选后端

Operator 可以只用本地 task/workspace 文件运行，也可以启用 self-hosted backend。

后端包覆盖：

- PostgreSQL schema、migrations、tasks、conversations、users、credits、drive metadata。
- OIDC/session helpers、手机号验证码登录和安全邮箱绑定。
- 本地文件系统和 S3-compatible object storage。
- Redis/BullMQ queue integration 和生产限流。
- Admin pages 和 API routes。

后端模式由 `OPERATOR_BACKEND_ENABLED`、`DATABASE_URL`、身份配置、存储配置和可选
`REDIS_URL` 控制。不要假设某个部署一定启用了后端；先检查运行中的
`/api/operator/backend/status`。

## 本地运行

安装依赖：

```bash
pnpm install
```

在 `.env` 中至少配置一个主执行 runtime，然后运行一次聊天请求：

```bash
pnpm chat --workspace tmp/runs/operator-chat-example --prompt '请生成一份可编辑 PPTX 和一份 HTML 网页 PPT'
```

运行 skill-to-workflow converter：

```bash
pnpm workflow:skill2workflow \
  --workspace tmp/runs/skill2workflow-example \
  --input-json '{"topic":"转换一个 GitHub skill","output_format":"workflow_pack","skill_root":"apps/mastra/tests/fixtures/text-skill","target_workflow_id":"example.converted_skill","codex_mode":"disabled"}'
```

启动 Web app：

```bash
pnpm --filter @operator/web dev
```

## 验证

```bash
pnpm typecheck
pnpm test
```

可选 UI smoke tests：

```bash
pnpm --filter @operator/web test:e2e
```

`apps/mastra/tests/operator-chat.test.ts` 会在没有主 Agent 配置时如实失败。PPT
integration tests 默认跳过，需要显式开启：

```text
OPERATOR_RUN_PPT_INTEGRATION=1
```

这些测试还要求已经配置真实 ACP agent，并且该 agent 能读取 Mastra Workspace
Skills、写入 artifacts。

## 部署说明

ECS 部署文件在 `deploy/ecs/`。当前 ECS baseline 使用 `codex-acp`，通过 ACP
调用宿主机本地 Codex CLI；如果部署 secret 提供 `OPERATOR_PACKY_API_KEY`，
安装脚本会自动启用 `codex-acp-packycode` 作为第二候选。

在把某个 host 或域名当成 Operator 部署前，先检查实际服务：

```bash
curl -fsS http://47.84.225.120/healthz
curl -fsS http://47.84.225.120/api/operator/scopes
curl -fsS http://47.84.225.120/api/operator/backend/status
```

公网域名可以独立于 Operator 服务迁移。优先以 health endpoint 和部署 runbook
为准，不要假设固定 hostname。
