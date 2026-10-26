# 算子平台开发标准

## 目标

本标准用于约束算子平台的所有开发、修复、重构和提交。目标是让每次改动都从全局架构和标准化边界出发，避免临时补丁、硬编码、重复造轮子和跨层深耦合。

根目录 `AGENTS.md` 是 Codex 的强制入口；根目录 `CLAUDE.md` 是 Claude Code 的强制入口。本文件是详细版。

## 一句话原则

成熟框架能做的事情，使用成熟框架；算子必须自研的产品语义，保持框架无关、自包含、可迁移，并通过 adapter 对接外部框架。

## 能力归属

### 算子平台自研

算子自研部分是产品语义和业务控制面：

- 用户任务、conversation、message、agent run、run event。
- scope catalog：用户可选的 skill、workflow、agent、tool 产品目录和输出契约。
- artifact contract：产物清单、预览、下载、校验、保留策略。
- 用户、租户、权限、审计、计费、配额。
- 前端工作台的信息架构、任务历史、过程框恢复、产物体验。
- 框架无关的 run lifecycle：状态机、事件模型、错误码、终态规则、stale run 修复策略。

这些语义不能直接依赖 Mastra、ACP SDK、AG-UI 或 Next.js route 的内部类型。需要对接框架时，使用 adapter。

### 外部框架和成熟工具

以下能力优先使用成熟实现：

- Mastra：agents、workflows、tools、workspace、Workspace Skills、runtime 注册、框架级 tracing/observability/storage 能力。
- Agent Client Protocol：外部 agent runtime 的协议边界。
- Next.js/React：Web/API、routing、server/client rendering、前端交互。
- Postgres/Drizzle：数据库 schema、迁移、事务、查询。
- S3-compatible storage：正式生产对象存储；本地文件系统仅作为开发和单机内测 adapter。
- BullMQ/Redis：生产后台任务队列。
- AG-UI：前端可消费的 agent stream/event 协议。
- assistant-ui、Vercel AI SDK：前端 thread/runtime、AI stream 和模型 provider 抽象。
- Zod、CloudEvents、OpenAPI、AsyncAPI：schema validation、事件 envelope、REST/event/job 契约表达。
- OpenTelemetry、Mastra tracing：标准观测接入；Langfuse 平台本体只能作为外挂 backend 或 exporter 目标。
- OIDC/JWT/JWS、Auth.js、jose、opaque DB session：标准身份和 token/session 边界。
- 标准库和维护良好的第三方库：cookie、rate limit、文件类型处理等。

### MVP 工具取舍

当前 MVP 第一批只引入轻量库、SDK、协议和必要基础设施，不一次性引入大型运行平台。

| 类别 | 工具 | 要求 |
|---|---|---|
| 仓库内依赖 | Zod、CloudEvents-compatible event helper、OpenAPI/AsyncAPI 生成工具、AG-UI SDK、assistant-ui、Vercel AI SDK、jose、Auth.js 或现有认证 adapter、OpenTelemetry SDK | 可以进入 `package.json`，通过 contracts、adapter、测试和生成脚本接入 |
| 应用依赖加外挂基础设施 | BullMQ + Redis | BullMQ producer/worker 代码进入仓库；Redis 作为本地 Docker、托管 Redis 或独立 Redis 服务运行 |
| 按复杂度延迟引入 | XState、Casbin | lifecycle 第一版可以先保持 XState-compatible statechart；权限超过简单 owner/admin/member 后再评估 Casbin |
| 暂缓的大型平台 | Temporal、Inngest、OpenFGA、Langfuse 平台本体 | 不进入 MVP 第一批；只保留 adapter 边界和 ADR 触发条件 |

禁止自研 durable workflow、细粒度授权引擎、trace backend、stream protocol 或 JWT/JWS 格式来替代这些成熟工具。

## 分层规则

### 产品核心层

产品核心层定义算子自己的语义，例如 run lifecycle、artifact contract、scope contract。它必须是框架无关的。

要求：

- 不 import Mastra 类型。
- 不 import Next.js Request/Response。
- 不 import React 或 AG-UI 组件。
- 不直接访问数据库。
- 不依赖环境变量作为业务分支。

### 持久化层

持久化层负责把产品语义写入 Postgres/Drizzle。

要求：

- 使用 Drizzle 和共享 DB helper。
- 关键状态写入必须可验证、可重试、幂等。
- 不允许吞掉 `markSucceeded/markFailed` 这类关键错误后继续表现为成功。
- routine CRUD 不写裸 SQL，除非 Drizzle 无法安全表达。

### Runtime adapter 层

Runtime adapter 负责把 Mastra/ACP/其他 agent runtime 的结果转换成算子产品语义。

要求：

- adapter 可以依赖 Mastra/ACP 类型。
- adapter 输出必须是算子生命周期定义的中立结果。
- 不把 Mastra/ACP 错误原样扩散到产品核心；必须标准化错误码和错误消息。

### Web/API 层

Web/API 层负责请求校验、安全控制、stream 输出和调用应用服务。

要求：

- 使用共享 schema validation、same-origin/CSRF、rate limit helper。
- 不在 route 文件里堆业务状态机。
- 不在 route 文件里写跨层补丁。
- 前端 stream 断开不能破坏后台 run 终态写入。

### 前端层

前端层负责展示产品状态，而不是推断产品状态。

要求：

- 过程框、任务详情、历史消息必须从统一 lifecycle/event 模型恢复。
- 不用“历史里有没有 assistant 消息”这类宽泛条件判断当前 run 是否完成。
- 多轮 conversation 必须以最新 user turn 和 run id 为边界。

## Agent 生命周期标准

### 状态

标准状态：

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> cancelled
```

可选状态：

```text
paused
waiting
skipped
```

终态：

```text
succeeded
failed
cancelled
skipped
```

### 终态写入顺序

runtime 返回 `succeeded/failed/cancelled` 后，必须按这个顺序处理：

1. 标准化结果和错误码。
2. 写 `agent_runs.status`、`finished_at`、`output/error`。
3. 追加 terminal event：`RUN_FINISHED`、`RUN_ERROR` 或 `RUN_CANCELLED`。
4. 发布 task status event。
5. 追加 assistant message。
6. 注册 artifact、改写链接、写 artifact finalization event。

第 5、6 步失败不能让 run 回到 running，也不能阻塞终态。

### Artifact finalization

artifact 注册是终态后的后置步骤，不是 run 是否完成的判据。

要求：

- 必须有超时。
- 失败时写 `operator.artifact_registration_error`。
- 不能阻止 `agent_runs.status` 进入终态。
- 后续可以由 reconciler 或后台 job 重试。

### Stale run 修复

任何 running run 如果长时间没有事件，必须可被 reconciler 修复。

修复来源优先级：

1. 数据库 terminal event。
2. 本地或对象存储中的 `chat_result.json`。
3. 本地或对象存储中的 `chat_plan.json`。
4. runtime 超时或连接断开推断。

修复必须幂等，不能覆盖已有终态。

## Bug 修复流程

每个 bug 修复必须遵循：

1. 定位用户、task、run、事件、日志、产物文件。
2. 判断问题层级：前端恢复、API stream、runtime adapter、Mastra/ACP、DB 持久化、artifact、配置、队列、存储。
3. 找到根因，不只处理表象。
4. 设计覆盖同类问题的修复。
5. 补测试或 smoke check。
6. 如有临时数据修复，明确标注为数据处置，并补代码级修复。

禁止模式：

- 一个 bug 一个 if 特判。
- 用 taskId、手机号、runId 写死逻辑。
- 数据修了但代码不修。
- 捕获异常后静默忽略关键失败。
- 为了让前端好看而伪造成功状态。

## Mastra 使用标准

Mastra 是应用框架和 runtime/workflow/skill/tool/workspace 中心。使用原则：

- Workspace Skills 使用 Mastra workspace skill source 暴露，不复制上游 skill 逻辑到应用代码。
- 确定性流程使用 Mastra workflows，不用自定义 mini workflow engine。
- 外部执行 agent 通过 ACP runtime 注册，不再引入 endpoint-only 私有 proxy。
- Operator product scope catalog 只描述用户产品面和输出契约，不替代 Mastra 注册。
- Mastra 适配代码可以存在，但产品核心语义不能依赖 Mastra 内部类型。

## 配置标准

配置必须表达能力，不表达业务补丁。

要求：

- runtime fallback chain 通过配置注册，例如 `OPERATOR_AGENT_FALLBACK_ORDER`。
- 没有配置的 fallback 不应被假定存在。
- 正式生产存储用 S3-compatible adapter；本地文件系统仅开发和单机内测使用。
- 生产后台任务用 BullMQ/Redis；禁用队列仅开发/测试使用。
- 敏感 secret 不写入文档、日志、测试 snapshot。

## 测试标准

涉及生命周期、runtime、artifact、消息、任务恢复的改动，至少覆盖相关同类场景：

- ACP connection closed。
- runtime timeout。
- artifact registration timeout。
- terminal DB write idempotency。
- stale running run reconciliation。
- 多轮 conversation 的当前 run 判定。
- 前端刷新后的过程框恢复。
- fallback runtime 配置缺失时的失败表达。

常用命令：

```bash
pnpm --filter @operator/web test
pnpm --filter @operator/web typecheck
pnpm --filter @operator/web lint
pnpm --filter @operator/mastra-app test
pnpm --filter @operator/mastra-app typecheck
```

## 提交标准

提交前必须确认：

- 改动范围和问题根因一致。
- 没有混入无关格式化、临时脚本、调试输出。
- 没有回滚用户或他人已有改动。
- 文档和测试与架构边界一致。
- 如有本地数据修复，最终说明中区分“数据处置”和“代码修复”。
