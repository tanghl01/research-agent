# 算子能力包开发 Spec

_本文遵循根目录 `AGENTS.md` 和 `docs/DEVELOPMENT_STANDARD.md`。目标是把 skill、workflow、agent、tool 等能力的注册、安装、配置、部署、启用收束到统一的核心控制面，而不是继续在各类能力里各自维护一套生命周期。_

---

## 结论

统一安装流程是 Operator 核心能力，不作为普通用户 workflow。它可以在后台通过 BullMQ job 执行，也可以提供 CLI 和 Admin API。未来如果需要在管理后台展示可暂停、可审批、可回放的安装过程，可以提供一个系统级 Mastra workflow 包装器，但该 workflow 只能调用核心安装服务，不能重新定义安装状态、校验规则或 receipt。

算子能力包的成熟工具取舍：

- 包元数据和所有权管理参考 Backstage Catalog，但 MVP 不引入 Backstage 平台本体。
- 组件、部署 trait、scope 的分离参考 Open Application Model，但 Operator 自定义 agent/skill/workflow 的产品语义。
- Manifest 校验使用 JSON Schema 和 Zod，不自研 schema validator。
- 配置完整性是上架前硬 gate；能力声明依赖的大模型 API key、外部服务 token、模型名、base URL 等必须配置完整。
- Python 依赖优先使用 uv；兼容普通 `venv + pip`；共享 `PIP_CACHE_DIR`。
- Node 依赖使用 pnpm/npm/yarn/bun 的项目原生命令，不自写包管理器。
- Mastra 原生能力通过 Mastra adapter 接入；LangGraph 项目通过 LangGraph adapter 接入；外部 coding agent 通过 ACP adapter 接入；tool/resource/prompt 类能力优先通过 MCP adapter 接入。
- GitHub 仓库是 MVP 的外部来源；OCI Artifact、Cosign/Sigstore、SBOM、签名验证作为社区分发和生产准入增强项分阶段引入。

Operator 必须自研的是薄产品契约和控制面：

- `operator.capability.json` manifest 语义。
- 能力包分类、注册、安装计划、安装 receipt、启用 gate。
- 把 Mastra、LangGraph、ACP、MCP、普通开源项目映射成 Operator scope 的 adapter。
- 用户、租户、权限、审计、配额、产物契约和可用性投影。

## 名词

### 算子能力包

算子能力包是可被 Operator 注册和启用的一组能力定义。它可以来自本仓库，也可以来自 GitHub 仓库。

能力包不是某一种 runtime，也不是某一种框架。它是一层产品控制面契约，描述：

- 能力来源和版本
- 能力类型
- 框架或协议适配方式
- 依赖和安装步骤
- 配置和 secret 引用
- smoke test 和健康检查
- 输出产物契约
- 用户或租户启用规则

### 能力类型

第一版支持以下 `kind`：

| kind | 含义 | 首选成熟能力 |
|---|---|---|
| `skill` | 给主智能体读取和执行的技能说明、脚本、模板、工具环境 | Mastra Workspace Skills、现有 Agent Skill 约定 |
| `workflow` | 确定性多步骤流程 | Mastra workflows；未来可接 LangGraph |
| `agent` | 可被平台调度的智能体 runtime | ACP、Mastra agent、LangGraph agent |
| `tool` | 可被 agent 调用的工具、资源、prompt | MCP、Mastra tools |
| `package` | 组合包，包含多个 skill/workflow/agent/tool | Operator manifest + adapter |

`kind` 是产品分类，`adapter` 是接入方式。二者不能混淆。例如一个 GitHub 仓库可以是 `kind=workflow`，但 `adapter=langgraph`。

### 来源类型

第一版只区分两类来源：

| 来源 | 说明 | 管理方式 |
|---|---|---|
| `bundled` | Operator 仓库内置能力，由内部团队维护，随主仓库发布 | 代码和 manifest 在本仓库；安装仍要经过统一流程 |
| `imported` | 外部 GitHub 仓库引入能力，包括通用开源项目和社区开发的 Operator 兼容项目 | 通过 URL、ref、commit 锁定；缓存到 runtime/cache 或 vendored 目录；必须写 install receipt |

`imported` 再按兼容程度分类：

| 兼容级别 | 判定依据 | 处理方式 |
|---|---|---|
| `operator-native` | 仓库含 `operator.capability.json`，且 schema 版本兼容 | 直接按 manifest 安装 |
| `operator-compatible` | 仓库含 Mastra、LangGraph、ACP、MCP、Agent Skill 等可识别结构，但无完整 Operator manifest | 自动生成安装计划草案，要求平台侧 manifest 补齐产品语义 |
| `generic-open-source` | 普通开源项目，无明确 agent/skill/workflow 边界 | 不自动启用；只能作为依赖或通过人工 adapter 包装 |

## 成熟工具调查和取舍

| 能力需求 | 成熟工具或标准 | 采用方式 | 不自研的部分 | Operator 自研边界 |
|---|---|---|---|---|
| 软件目录、所有权、元数据 | Backstage Software Catalog | 参考其 `catalog-info.yaml` 思路，MVP 不部署 Backstage | 不自建大型开发者门户 | 能力包 registry、owner、scope、tenant enablement |
| 组件/trait/scope 模型 | Open Application Model | 参考 component/trait/scope 分离 | 不自研通用云原生应用模型 | 针对 agent/skill/workflow/tool 的产品语义 |
| Manifest 校验 | JSON Schema 2020-12、Zod | `operator.capability.json` 发布 JSON Schema；TS 侧用 Zod | 不写手工字段校验分支 | Operator 字段命名、兼容策略、错误码 |
| Python 安装 | uv、pip、venv | 优先 `uv sync`；无 uv 项目时用隔离 venv + pip；共享下载缓存 | 不自写依赖解析器 | runtime cache key、receipt、smoke gate |
| Node 安装 | pnpm/npm/yarn/bun | 按 lockfile 自动识别包管理器 | 不自写 Node 包管理器 | 选择策略、缓存目录、安装超时、receipt |
| 开发环境描述 | Dev Container spec | 仅作为可选 hints 和未来隔离执行输入 | 不把 devcontainer 当 Operator manifest | 提取 runtime prerequisites 和安全提示 |
| 包分发 | GitHub、后续 OCI Artifacts | MVP 用 GitHub URL/ref/commit；生产社区分发可加 OCI | 不自研 artifact registry | import policy、cache、pinning、approval |
| 签名和来源验证 | Sigstore/Cosign、SLSA/SBOM | MVP 记录来源和 commit；社区发布阶段加签名验证 | 不自研签名系统 | 信任策略、准入 gate、审计 |
| 原生 agent/workflow/skill | Mastra | Mastra adapter 注册和调用 | 不复制 Mastra runtime/workflow engine | scope 映射、可用性 gate、错误标准化 |
| Graph workflow/agent | LangGraph | 识别 `langgraph.json`，按 LangGraph CLI/SDK 部署或调用 | 不重写 LangGraph graph runtime | Operator manifest、部署健康检查、产物契约 |
| 外部 coding agent | ACP | Codex CLI、Claude Code、OpenHands 统一通过 ACP | 不保留 endpoint-only 私有 proxy | ACP config、preflight、用户任务映射 |
| 工具/资源/prompt | MCP | MCP server 能力通过 adapter 注册 | 不自研 tool discovery 协议 | 权限、tenant enablement、审计、输出约束 |
| 后台安装任务 | BullMQ/Redis | 安装、校验、reconcile 用后台 job | 不把长任务塞进 API route | job payload、状态投影、重试策略 |
| API 契约 | OpenAPI/AsyncAPI | 管理 API、事件流、job payload 生成契约 | 不手写散落接口文档 | Operator 资源模型和权限 |

## 核心设计

### 目录建议

第一版不强制一次性搬迁所有已有 skill 源码，但新增能力包控制面目录：

```text
capabilities/
  manifests/
    *.capability.json
  bundled/
    ...
  adapters/
    ...

packages/core/src/capabilities/
  manifest.ts
  registry.ts
  classifier.ts
  source-resolver.ts
  installer.ts
  receipts.ts
  runtime-cache.ts
  adapters/
    skill-adapter.ts
    mastra-workflow-adapter.ts
    langgraph-adapter.ts
    acp-agent-adapter.ts
    mcp-tool-adapter.ts
    generic-github-adapter.ts
```

现有 skill 仓库和 manifest 继续保留为能力包输入：

```text
skills/manifests/*.skill.json
skills/vendored/*
skills/local/*
```

`capabilities:sync --kind skill` 是 skill 安装、配置、smoke test、capability test、
注册、部署、启用和 receipt 的单一事实来源。不得维护独立 skill 安装状态、版本哈希、
CLI 或回执格式。

### Manifest

Operator 原生能力包使用 `operator.capability.json`：

```json
{
  "$schema": "https://operator.local/schemas/operator-capability.v1.json",
  "apiVersion": "operator.dev/v1",
  "kind": "skill",
  "id": "ppt-master",
  "displayName": "PPT Master",
  "description": "SVG-first deck generation, validation, and PPTX export.",
  "source": {
    "type": "imported",
    "provider": "github",
    "repo": "https://github.com/example/ppt-master.git",
    "ref": "main",
    "commit": "0000000000000000000000000000000000000000"
  },
  "adapter": {
    "type": "agent-skill",
    "entrypoints": {
      "skill": "SKILL.md"
    }
  },
  "runtime": {
    "type": "python",
    "manager": "uv-or-venv",
    "cacheKeyFiles": [
      "pyproject.toml",
      "uv.lock",
      "requirements.txt"
    ],
    "commands": {
      "image_gen": "env IMAGE_BACKEND=openai OPENAI_API_KEY=\"$OPERATOR_PACKY_IMAGE_API_KEY\" OPENAI_BASE_URL=\"${OPERATOR_PACKY_IMAGE_BASE_URL:-https://www.packyapi.com/v1}\" {python} {capability_root}/scripts/image_gen.py"
    }
  },
  "configuration": {
    "requiredEnv": [
      "OPERATOR_PACKY_IMAGE_API_KEY"
    ],
    "optionalEnv": [
      "OPERATOR_PACKY_IMAGE_BASE_URL",
      "OPERATOR_PACKY_IMAGE_MODEL"
    ],
    "providers": [
      {
        "id": "image-generation",
        "interface": "openai-compatible-image-generation",
        "required": true,
        "env": {
          "apiKey": "OPERATOR_PACKY_IMAGE_API_KEY",
          "baseUrl": "OPERATOR_PACKY_IMAGE_BASE_URL",
          "model": "OPERATOR_PACKY_IMAGE_MODEL"
        },
        "compatibleProviders": ["packy", "openai-compatible"]
      }
    ],
    "secrets": []
  },
  "validation": {
    "requiredPaths": [
      "SKILL.md"
    ],
    "smokeTests": [
      {
        "name": "image-gen-help",
        "command": "{python} {capability_root}/scripts/image_gen.py --help",
        "timeoutMs": 30000,
        "required": true
      }
    ],
    "capabilityTests": [
      {
        "name": "golden-example-image-generation",
        "type": "golden-example",
        "source": "upstream-example-or-operator-curated-example",
        "command": "{runtime.commands.image_gen} --prompt \"A clean test slide cover illustration\" --out {workspace}/example.png",
        "expectedArtifacts": [
          {
            "path": "example.png",
            "type": "image",
            "minBytes": 1024
          }
        ],
        "required": true,
        "timeoutMs": 120000
      }
    ]
  },
  "exposure": {
    "scopes": [
      {
        "id": "ppt-master",
        "surface": "chat",
        "enabledByDefault": false
      }
    ],
    "artifacts": [
      {
        "type": "presentation",
        "formats": ["pptx", "html", "png"]
      }
    ]
  },
  "security": {
    "network": "default",
    "filesystem": "workspace-only",
    "review": "maintainer-approved"
  },
  "license": {
    "spdx": "MIT",
    "notice": "Follow upstream license and attribution requirements."
  }
}
```

Manifest 规则：

- `id` 全局唯一，不能依赖展示名。
- `source.commit` 对 imported 能力包在生产和内测环境必须锁定；开发环境允许只用 `ref`。
- `configuration` 只能声明 env/secret 引用，不能写 secret 值。
- `configuration.requiredEnv`、`configuration.providers[required=true]` 是上架前硬 gate。能力声明中依赖的大模型 API、图片生成 API、搜索 API、数据库、模型名或 base URL 必须配置完整；兼容 provider 可以替代原 provider，但必须通过 adapter 明确声明其接口兼容性。
- `configuration.optionalEnv` 只能用于非核心增强项或有安全默认值的配置。只要某项能力被写进 `description`、`features`、`exposure` 或前端销售/展示文案，就不得把其必要配置标成 optional。
- `runtime.commands` 可以做 provider 局部映射，例如把 `OPERATOR_PACKY_IMAGE_*` 映射成子进程需要的 `OPENAI_*`，但映射范围必须只限该子进程。
- `validation.smokeTests` 是安装完整性 gate，失败则能力不可用。
- `validation.capabilityTests` 是能力真实性 gate，必须验证项目声称的核心能力。优先复现上游最佳示例；没有上游示例时，由 Operator 维护一个最小 golden example，并检查输出产物、关键内容、格式和错误边界。
- `exposure.scopes` 是 Operator 产品面，不等于 Mastra/LangGraph/ACP 内部注册对象。

## 生命周期

统一生命周期：

```text
discovered -> resolved -> planned -> installed -> configured -> validated -> enabled
```

失败和维护状态：

```text
failed
disabled
stale
deprecated
removed
```

状态含义：

| 状态 | 含义 | 写入者 |
|---|---|---|
| `discovered` | 找到 manifest 或识别到仓库特征 | classifier |
| `resolved` | 源码、版本、commit、根目录已确定 | source resolver |
| `planned` | adapter 已生成安装计划 | installer |
| `installed` | 依赖、runtime cache、源码准备完成 | installer |
| `configured` | required env、secret、provider、模型和外部服务配置完整 | config validator |
| `validated` | required paths、schema、smoke tests、核心能力复现测试通过 | validator |
| `enabled` | 对目标用户、租户或环境开放 | enablement service |
| `stale` | manifest/source/runtime 变化，receipt 过期 | reconciler |
| `failed` | 任一步骤失败，保留错误和日志摘要 | installer |

所有状态写入必须有 receipt。可用性判断必须基于当前 manifest/source/runtime 的最新 receipt，不能只看文件是否存在。
Mastra、LangGraph、ACP、MCP 的框架注册和 runtime binding 是 adapter/框架层行为，
不得在核心安装生命周期里写没有实际动作的 `registered` 或 `deployed` 空壳 gate。

## 全流程

### 1. 统一注册

输入：

- 本仓库 `capabilities/manifests/*.capability.json`
- 兼容期 `skills/manifests/*.skill.json`
- 管理后台提交的 GitHub URL/ref/commit

步骤：

1. 读取显式 manifest。
2. 如果无 Operator manifest，则按特征自动分类：
   - `operator.capability.json`
   - `mastra.config.*`、Mastra workflow/agent/tool 导出
   - `langgraph.json`
   - ACP server/agent command 配置
   - MCP server 配置或 `mcp.json`
   - `SKILL.md`
   - `pyproject.toml`、`package.json`、`.devcontainer/devcontainer.json`
3. 生成 `CapabilityDescriptor`。
4. 对 `generic-open-source` 标记为未包装，禁止直接启用。
5. 写 registry draft，等待 install。

### 2. 统一安装

安装器是核心服务，接口是框架无关的：

```ts
export type CapabilityInstallRequest = {
  capabilityId: string;
  source?: CapabilitySourceRef;
  force?: boolean;
  environment: "development" | "internal" | "production";
  actor: {
    type: "system" | "admin" | "developer";
    id: string;
  };
};

export type CapabilityInstallResult = {
  capabilityId: string;
  versionKey: string;
  status: "installed" | "failed";
  receiptPath?: string;
  checks: CapabilityCheckResult[];
  error?: OperatorCapabilityError;
};
```

安装步骤：

1. resolve source：clone/fetch GitHub 仓库，checkout ref/commit。
2. resolve root：识别能力根目录和子能力根目录。
3. compute install key：manifest sha、source commit、adapter type、runtime cache key、关键依赖文件 hash。
4. prepare runtime：
   - Python：优先 `uv sync`；否则 venv + pip；共享 `OPERATOR_PIP_CACHE_DIR`。
   - Node：按 lockfile 选择 pnpm/npm/yarn/bun。
   - Container：只在明确声明和安全策略允许时使用。
   - External：只做 command/env/preflight，不安装 provider SDK 到主进程。
5. validate required paths。
6. run smoke tests。
7. write receipt。

安装只证明源码和依赖准备完成，不证明能力已经可以上架。依赖大模型、图片生成、搜索、数据库或其他外部服务的能力，必须继续通过配置完整性和核心能力验证。

### 3. 统一配置

配置分三层：

| 层级 | 内容 | 存放 |
|---|---|---|
| package config | manifest 中的能力声明、默认 runtime、entrypoint、artifact contract | Git 或 registry |
| environment config | API key 名称、base URL、模型名、cache root、storage provider | `.env`、secret manager、deployment config |
| tenant/user config | 对哪些租户启用、额度、权限、默认模型策略 | DB |

规则：

- manifest 不得包含 secret 值。
- provider key 必须使用 Operator 命名空间，例如 `OPERATOR_PACKY_IMAGE_API_KEY`，只有 adapter 或子进程命令可映射成上游工具需要的变量名。
- 配置缺失时能力应保持 `installed`，不能进入 `configured`、`validated` 或 `enabled`。
- 能力声称依赖的大模型 API key、图片生成 API key、搜索 API key、模型名、base URL、数据库连接、云存储桶、浏览器服务、GPU 服务等都必须在配置完整性检查中覆盖。
- 兼容 provider 可以替代原始 provider，例如 OpenAI-compatible、Anthropic-compatible 或 S3-compatible，但 manifest 必须声明兼容接口，adapter 必须做最小握手或真实调用验证。
- 不允许为了让能力上架而把核心 provider 标成 optional。optional 只用于不影响核心能力的增强项、调试项或已有安全默认值的配置。
- 配置检查必须输出 `CapabilityConfigurationReceipt`，记录已验证的 env/secret 引用名、provider 接口、模型名和检查时间，但不得记录 secret 值。

### 3.1 核心能力验证

核心能力验证发生在安装和配置之后、注册和启用之前。它不是简单 `--help` 检查，而是验证项目实际能力与 manifest、README、上游示例、前端展示文案中的声明一致。

验证优先级：

1. 上游项目提供的官方最佳示例、demo、examples、README quickstart。
2. 社区能力包提供的 `operator.capability.json` 中声明的 golden example。
3. Operator 维护的最小复现案例。

验证要求：

- 每个能力包至少有一个 required `capabilityTest` 覆盖核心能力。
- 如果能力包含多个核心功能，例如 PPT 生成和图片生成，则每个对用户展示的核心功能都要有验证项。
- 验证必须检查结果，而不只检查命令退出码。检查项可以包括产物存在、大小、MIME、schema、页数、关键文本、图片尺寸、文件可打开、agent 是否完成握手、workflow 是否产生声明的输出。
- 验证失败时能力可以保留为 `installed` 或 `configured`，但不得 `validated` 或 `enabled`。
- 验证样例应尽量小，避免高成本和长时间，但必须能代表项目声称的核心能力。

### 4. 框架映射和启用

核心 lifecycle 不定义独立的空壳部署阶段。能力验证通过后，adapter 把能力映射到对应成熟框架；
真正的注册、runtime binding、worker、命令或服务启动由 Mastra、LangGraph、ACP、MCP 等框架或运行设施完成。

| adapter | 部署动作 |
|---|---|
| `agent-skill` | 暴露给 Mastra Workspace Skill Source；运行时要求当前 install receipt |
| `mastra-workflow` | 注册到 Mastra workflow registry；校验 input/output schema |
| `langgraph` | 识别 `langgraph.json`，准备 Python 环境，生成调用或服务启动配置 |
| `acp-agent` | 校验 command、cwd、env、handshake；登记 agent runtime |
| `mcp-tool` | 校验 MCP server command/transport/tools list；登记 tool/resource/prompt |
| `generic-github` | 只缓存和记录，不进入用户可用 scope |

部署动作必须幂等。重复部署同一 `versionKey` 不应重装依赖，除非 `force=true`。

### 5. 统一启用

启用是产品动作，不是安装动作。

启用条件：

- 当前能力有 `configured` 和 `validated` receipt。
- `source.commit`、manifest hash、runtime cache key 与 receipt 一致。
- 所需环境变量、secret 引用、provider、模型名和 base URL 完整且最近一次配置检查通过。
- required `capabilityTests` 全部通过，且测试覆盖当前要上架展示的核心能力。
- 对应 adapter 健康检查通过。
- license/security policy 未阻止。
- 目标 tenant/user 有权限。

启用结果写入：

```text
capability_enablements
  capability_id
  version_key
  environment
  tenant_id
  user_id
  status
  enabled_at
  enabled_by
```

产品目录、前端 scope、Mastra skill source、agent fallback candidate 只能读取已启用能力。

## Adapter 接口

每个 adapter 只能做框架映射，不允许定义独立产品生命周期。

```ts
export interface CapabilityAdapter {
  readonly type: CapabilityAdapterType;

  detect(input: CapabilityDetectInput): Promise<CapabilityDetectResult>;
  plan(input: CapabilityPlanInput): Promise<CapabilityInstallPlan>;
  install(input: CapabilityInstallInput): Promise<CapabilityInstallStepResult[]>;
  configure(input: CapabilityConfigureInput): Promise<CapabilityConfigurationResult>;
  validate(input: CapabilityValidateInput): Promise<CapabilityCheckResult[]>;
  health(input: CapabilityHealthInput): Promise<CapabilityHealthResult>;
}
```

Adapter 规则：

- `detect` 可以基于文件特征做分类，但不能把 generic 仓库自动变成可启用能力。
- `plan` 输出依赖安装和 smoke test 计划。
- `install` 不直接写 enablement。
- `configure` 验证 required env、secret 引用、兼容 provider、模型名和 base URL 是否完整，不读取或记录 secret 明文。
- `validate` 必须执行 required smoke tests 和 capability tests，证明核心能力与项目声明一致。
- 框架注册和 runtime binding 必须调用对应成熟框架的标准能力，不得在 Operator 核心层伪造空状态。
- `health` 用于 enablement gate 和后台 reconcile。

## 现有 GitHub Skill 安装流程并入方案

当前 skill 安装能力已迁入 `packages/core/src/capabilities/skills.ts`：

- 读取 `skills/manifests/*.skill.json`
- clone/fetch GitHub 源码
- 支持 `agent_skill`、`agent_skill_collection`
- 解析 root/subskill/entrypoints/required paths
- 准备 runtime cache
- Python venv 安装和共享 pip cache
- smoke test
- 写 capability install receipt
- `requireEnabledCapability` / `requireInstalledCapability` 作为运行时 gating

这些代码不应保留在独立 `skills.ts` 状态机中。对 skill 而言，
`packages/core/src/capabilities/skills.ts` 是安装状态、配置校验、capability test、注册/部署 gate 和 receipt 的单一事实来源；
`packages/core/src/skills.ts` 已删除；所有 skill 管理 API 必须位于 `packages/core/src/capabilities/*`。

迁移步骤：

1. 新增 `packages/core/src/capabilities/*`，定义通用 manifest、source、runtime、receipt、adapter 接口。
2. 把原 `skills.ts` 的 skill source/runtime/install/test 能力迁入 `packages/core/src/capabilities/skills.ts`。
3. capability installer 遇到 `legacySkillId` 时必须调用 capability skill adapter，直接生成 `operator.capability.install.v1` receipt；`receipt_path` 必须位于 `OPERATOR_CAPABILITY_INSTALL_STATE_ROOT`。
4. 新增 `pnpm capabilities:sync`：
   - `pnpm capabilities:sync ppt-master`
   - `pnpm capabilities:sync --kind skill --all`
   - `pnpm capabilities:sync --source https://github.com/... --ref main`
5. 删除旧 skill 同步 CLI；唯一 CLI 入口是 `pnpm capabilities:sync <id> --kind skill` 或 `pnpm capabilities:sync --all --kind skill`。
6. 旧 skill manifest 中如果声明了大模型、图片生成、搜索等核心能力，迁移时必须把对应 env/provider 和 golden example 补齐。
7. `apps/mastra/src/skills/registry.ts` 从 `requireInstalledSkill` 迁到 `requireEnabledCapability` 或 `requireInstalledCapability`。
8. `skills/manifests/*.skill.json` 分批迁到 `capabilities/manifests/*.capability.json`；迁移完成前由 `legacy-skill-manifest-adapter` 自动转换。

验收：

- 现有 skill manifest 均可通过 `pnpm capabilities:sync --all --kind skill` 安装。
- 任意新增 GitHub skill 不能跳过 unified installer。
- skill 源码存在但 receipt 缺失、失败或 stale 时，前端和 Mastra 都不可见。
- skill 所需大模型/API/provider 未配置完整时，不得进入前端 scope 或 Mastra skill source。
- skill 的核心能力必须通过上游示例或 Operator golden example 复现，不能只以安装成功作为上架依据。
- `ppt-master` 的 Packy 生图 key 映射仍只发生在 `image_gen` 子进程。

## Workflow 包装评估

决策：

- MVP 不把能力包安装器实现为普通 Mastra workflow。
- MVP 使用核心 service + CLI + BullMQ job。
- 后续可以增加 `system.capability.install` 管理型 workflow，但它只是编排 UI 和审批，不拥有业务状态机。

原因：

- 安装器是平台控制面，负责注册、依赖安装、安全 gate 和启用，不应出现在终端用户可选 workflow scope 中。
- 安装器必须能在 Web、CLI、部署脚本、后台 reconciler 中复用；如果首先做成 workflow，会把核心生命周期绑定到 Mastra 实现。
- BullMQ 已足够承载 MVP 的长安装任务、重试和日志投影。
- Mastra workflow 适合后续表达“提交 GitHub URL -> 自动分析 -> 管理员确认 -> 调用核心 installer -> 发布”的管理流程。

约束：

- `system.capability.install` 如果实现，必须调用 `CapabilityInstaller`。
- 该 workflow 不得定义新状态名。
- 该 workflow 不得直接写 scope catalog。
- 该 workflow 不得绕过 receipt 和 enablement gate。

## 数据模型

建议新增或映射以下表：

```text
capability_packages
  id
  kind
  display_name
  description
  source_type
  adapter_type
  compatibility_level
  owner
  status
  created_at
  updated_at

capability_versions
  id
  capability_id
  version_key
  source_repo
  source_ref
  source_commit
  manifest_sha256
  runtime_key
  created_at

capability_install_receipts
  id
  capability_id
  version_key
  status
  receipt_json
  receipt_path
  installed_at
  installed_by

capability_registrations
  id
  capability_id
  version_key
  adapter_type
  registration_json
  status
  registered_at

capability_enablements
  id
  capability_id
  version_key
  environment
  tenant_id
  user_id
  status
  enabled_at
  enabled_by
```

本地开发和内测可以先使用文件 receipt；生产应把 receipt 事实写入 DB，同时保留 JSON receipt 方便排查。

## CLI 和 API

CLI：

```text
pnpm capabilities:list
pnpm capabilities:inspect <id>
pnpm capabilities:sync <id>
pnpm capabilities:sync --all
pnpm capabilities:sync --kind skill --all
pnpm capabilities:import https://github.com/org/repo --ref main
pnpm capabilities:validate <id>
pnpm capabilities:enable <id> --tenant <tenant-id>
pnpm capabilities:disable <id> --tenant <tenant-id>

```

Admin API：

```text
GET    /api/operator/capabilities
POST   /api/operator/capabilities/import
POST   /api/operator/capabilities/:id/install
POST   /api/operator/capabilities/:id/validate
POST   /api/operator/capabilities/:id/enable
POST   /api/operator/capabilities/:id/disable
GET    /api/operator/capabilities/:id/receipts
GET    /api/operator/capabilities/:id/health
```

API 必须通过 OpenAPI 描述。安装和验证这类长任务返回 job id，job payload 和事件用 AsyncAPI 描述。

## 安全和准入

安全规则：

- imported GitHub 仓库必须锁定 commit 才能在 internal/production 启用。
- generic-open-source 不得自动启用。
- manifest 不能存 secret 值。
- 安装日志、receipt、smoke output 不得输出完整 secret。
- capability test 日志不得泄漏 prompt 中的敏感输入、provider 返回的密钥片段或完整外部响应；需要保留审计时只存摘要、hash、产物元数据和错误码。
- 能力包默认只允许访问任务 workspace；需要额外文件系统、网络、GPU、浏览器、Docker 权限时必须声明。
- MCP/ACP/外部 command 需要命令白名单或管理员批准。
- 生产阶段逐步加入 license scan、SBOM、Cosign/Sigstore 验证。

准入等级：

| 等级 | 允许场景 | 要求 |
|---|---|---|
| `local-dev` | 开发者本机实验 | 可用 ref；允许手动 force install；核心配置缺失时只能本地 draft，不得对内测用户启用 |
| `internal` | 内测用户 | GitHub commit pin；配置完整；smoke test 和核心能力复现测试必须通过；管理员启用 |
| `production` | 正式生产 | commit pin、receipt DB 落库、配置完整、核心能力复现测试、健康检查、license/security gate、回滚能力 |

## 和 Operator 产品契约的关系

能力包控制面不替代 `@operator/contracts`。二者关系：

| 层 | 负责 |
|---|---|
| `@operator/contracts` | 用户任务、run lifecycle、message、artifact、scope、error 的产品语义 |
| `capabilities` core | 能力包来源、安装、配置、部署、启用生命周期 |
| framework adapters | Mastra、LangGraph、ACP、MCP、uv/pnpm/OCI 等成熟工具映射 |
| Web/Admin | 管理交互、状态展示、权限校验 |

能力包启用后，只能通过 `ScopeContract` 进入终端用户产品面。前端不能直接扫描能力包目录生成用户按钮。

## 迁移计划

### 第 0 阶段：文档和边界冻结

- 本 spec 成为能力包开发依据。
- `skills/README.md` 保留 skill 使用规则，并注明安装和 receipt 由 capability lifecycle 统一管理。
- 不新增绕过 `pnpm capabilities:sync` 的安装路径。

### 第 1 阶段：抽出 capability core

- 新增 `packages/core/src/capabilities/*`。
- 定义 `CapabilityManifest`、`CapabilityAdapter`、`CapabilityInstallReceipt`。
- 把已有 skill installer 迁入 capability skill adapter；删除 `skills.ts` facade，不能保留独立 skill 安装模块。

### 第 2 阶段：Skill 兼容迁移

- `pnpm capabilities:sync --kind skill --all` 可安装所有当前 skill。
- `pnpm capabilities:sync --kind skill` 调用 capability lifecycle，并引用 `_capability-installs` receipt。
- 旧 `.skill.json` 通过 legacy adapter 转换为 capability descriptor。
- 对现有 skill 补齐 required provider、API key、模型、base URL 和 capabilityTests；例如 PPT/生图类 skill 必须验证文本生成、图片生成或 PPTX/HTML 导出等对外声明的核心能力。
- `apps/mastra/src/skills/registry.ts` 改用 capability receipt gating。

### 第 3 阶段：Agent 安装和 preflight

- ACP agent 配置由 `packages/core/src/capabilities/acp-agents.ts` 统一解析，并动态登记为 `kind=agent, adapter=acp-agent` capability descriptor；Mastra runtime 不再维护平行 agent 注册表。
- 安装阶段执行 command、cwd、env 引用和 command existence preflight；后续可在同一 adapter 内增强 ACP handshake，不另建生命周期。
- agent fallback 和 agent scope 只读取已 enabled 的 agent capability receipt。

### 第 4 阶段：Workflow 安装和验证

- Bundled Mastra workflow 也进入 capability registry。
- 每个 workflow 必须声明 input/output schema、artifact contract、required provider、smoke test 和核心能力复现测试。
- 引入 LangGraph adapter：识别 `langgraph.json`，安装 Python 依赖，执行 graph health check。

### 第 5 阶段：Tool/MCP 和社区引入

- 增加 `mcp-tool` adapter。
- 支持 GitHub URL import、自动分类、人工补 manifest、管理员启用。
- generic-open-source 默认只进入 draft，不启用。

### 第 6 阶段：生产准入增强

- receipt 写入 DB。
- 引入 SBOM、license scan、Cosign/Sigstore 验证。
- 评估 OCI Artifact 作为能力包分发格式。

## 验收标准

必须满足：

- 所有 skill、workflow、agent、tool 的可用性判断都经过能力包 receipt 和 enablement gate。
- 现有 GitHub skill 安装流程迁入 capability skill adapter；不得继续维护独立 skill 生命周期或 `_skill-installs` receipt。
- 新增能力包时，不能只把源码放进目录就对用户可见。
- 安装失败、配置缺失、smoke test 失败、核心能力复现测试失败、receipt stale 时，能力不可启用。
- 所有对用户展示的核心能力都必须有 required configuration 和 required capability test；缺少大模型/API key/provider 的能力不能以降级形态上架。
- 兼容 provider 可以使用，但必须声明接口兼容性并通过真实握手或最小真实调用验证。
- Bundled 能力也必须有 manifest 和验证，不享有绕过流程特权。
- imported 能力在 internal/production 必须锁定 commit。
- Mastra/LangGraph/ACP/MCP/uv/pnpm 等成熟工具只在 adapter 层被调用，产品核心不耦合这些框架内部类型。
- 前端 scope 只展示 enabled 能力，不从文件系统或框架 registry 临时推断。

## 非目标

第一版不做：

- 通用应用商店或付费 marketplace。
- 自建 GitHub 替代品、包管理器、签名系统、依赖解析器。
- 自研 workflow engine、agent runtime、MCP/ACP 协议实现。
- 自动信任任意 GitHub 仓库。
- 把 Backstage、Temporal、OpenFGA、Langfuse 平台本体嵌入 MVP。

## 参考资料

- Backstage Software Catalog: https://backstage.io/docs/features/software-catalog/
- Backstage Catalog descriptor format: https://backstage.io/docs/features/software-catalog/descriptor-format/
- Open Application Model: https://oam.dev/
- Open Application Model spec: https://github.com/oam-dev/spec
- OCI Image and Distribution Specs v1.1: https://opencontainers.org/posts/blog/2024-03-13-image-and-distribution-1-1/
- Sigstore Cosign quickstart: https://docs.sigstore.dev/quickstart/quickstart-cosign/
- Dev Container metadata reference: https://devcontainers.github.io/implementors/json_reference/
- uv documentation: https://docs.astral.sh/uv/
- JSON Schema 2020-12: https://json-schema.org/draft/2020-12
- OpenAPI Specification: https://swagger.io/specification/
- Mastra agents overview: https://mastra.ai/docs/agents/overview
- Mastra workflows overview: https://mastra.ai/docs/workflows/overview
- LangGraph application structure: https://docs.langchain.com/oss/python/langgraph/application-structure
- Agent Client Protocol introduction: https://agentclientprotocol.com/get-started/introduction
- Model Context Protocol introduction: https://modelcontextprotocol.io/docs/getting-started/intro
