# 算子平台开发规范

本文件是 Codex 在本仓库执行任何开发、修复、重构、提交前必须读取并遵守的强制入口规范。详细版见 `docs/DEVELOPMENT_STANDARD.md`。

## 总原则

算子平台不是通用框架的替代品。凡是 Mastra、Next.js、React、Postgres/Drizzle、S3-compatible storage、BullMQ、AG-UI、assistant-ui、Vercel AI SDK、Agent Client Protocol、Zod、OpenAPI、AsyncAPI、OpenTelemetry、OIDC/JWT/JWS 等成熟框架、协议或标准工具已经提供的能力，优先使用标准实现，不重复发明。

算子平台只自研产品语义和业务控制面：任务、会话、用户/租户、scope catalog、artifact contract、审计、计费、权限、前端工作台体验、以及框架无关的 run lifecycle。自研代码必须自包含、边界清晰、可迁移，不能把产品语义深耦合到某个框架内部类型。

## 必须区分的边界

- Mastra 负责：agents、workflows、tools、workspace、Workspace Skills、runtime 注册、标准执行能力、框架级 tracing/observability/storage 能力。
- ACP 负责：外部 agent runtime 的协议边界，例如 Codex CLI、Claude Code、DeepSeek-backed runtime 等。
- Next.js/React 负责：Web/API、UI、routing、server/client rendering。
- Postgres/Drizzle 负责：持久化模型、迁移、查询和事务。
- S3-compatible storage 负责：生产文件对象存储；本地文件系统仅作为开发 adapter。
- BullMQ/Redis 负责：生产级后台任务队列。
- AG-UI 负责：前端可消费的 agent stream/event 表达。
- assistant-ui、Vercel AI SDK 负责：前端 thread/runtime、AI stream 和模型 provider 抽象。
- Zod、CloudEvents、OpenAPI、AsyncAPI 负责：schema 校验、事件 envelope、REST/event/job 契约表达。
- OpenTelemetry 和 Mastra tracing 负责：标准观测接入；Langfuse 只能作为外挂 backend 或 exporter 目标，不内嵌平台本体。
- OIDC/JWT/JWS、Auth.js、jose 或 opaque DB session 负责：标准身份和 token/session 边界。
- 算子自研负责：产品级 task/run/message/artifact/audit/billing/scope 语义，以及这些语义到上述框架的适配。

## MVP 工具取舍

当前 MVP 第一批只引入轻量库、SDK、协议和必要基础设施，不一次性引入大型运行平台。

- 可以直接进入仓库依赖：Zod、CloudEvents-compatible event helper、OpenAPI/AsyncAPI 生成工具、AG-UI SDK、assistant-ui、Vercel AI SDK、jose、Auth.js 或现有认证 adapter、OpenTelemetry SDK。
- BullMQ 代码可以进入仓库；Redis 必须作为本地 Docker、托管 Redis 或独立 Redis 服务外挂运行。
- XState、Casbin 只在复杂度明确后引入；第一版 lifecycle 可以先保持 XState-compatible statechart。
- Temporal、Inngest、OpenFGA、Langfuse 平台本体不进入 MVP 第一批；只有出现跨天 durable workflow、人审暂停、复杂补偿、复杂多租户关系授权或明确观测 backend 需求后，才通过 ADR 评估。
- 禁止用自研 durable workflow、细粒度授权引擎、trace backend、stream protocol 或 JWT/JWS 格式替代成熟工具。

## 开发前检查

每次改动前必须先判断：

1. 这是产品语义问题，还是框架/配置/集成问题。
2. 成熟框架是否已有标准能力可用。
3. 当前代码是否存在重复实现、硬编码、临时补丁或跨层耦合。
4. 修复是否能覆盖同类问题，而不是只处理当前一个样例。
5. 需要补哪些测试来证明根因已解决。

## 禁止事项

- 禁止用临时脚本、硬编码 taskId、手机号、runId、路径、状态值来作为代码级修复。
- 禁止在 Web route 中堆叠业务状态机、artifact 注册、runtime 解释、前端事件拼装等跨层逻辑。
- 禁止吞掉关键持久化错误后继续表现为成功或 running。
- 禁止让 artifact 注册、链接改写、消息补充等后置步骤阻塞 run 终态写入。
- 禁止把 Mastra 类型、ACP SDK 类型直接扩散到算子产品生命周期核心模块。
- 禁止为了快速通过单个 bug 而绕开已有标准库、框架能力或本仓库共享 helper。

## Agent 生命周期要求

算子产品级 run lifecycle 必须是框架无关的核心语义，再由 adapter 映射到 Mastra/ACP。

最低要求：

- 状态必须有明确流转：`queued -> running -> succeeded | failed | cancelled`，需要时允许 `paused/waiting/skipped`。
- 终态必须幂等，重复写入不能破坏已有终态。
- 一旦 runtime 产生 succeeded/failed/cancelled，必须先写 `agent_runs.status`、`finished_at` 和 terminal event，再执行 artifact 注册、assistant message、链接改写等后置步骤。
- 每个失败必须有标准错误码和可读错误消息。
- 长时间无事件的 running run 必须能被 reconciler 从持久化结果或 runtime 事件中修复。
- 前端过程框和任务详情必须从统一 lifecycle/event 模型恢复，不依赖零散历史消息猜测。

## Bug 修复标准

每个 bug 必须定位到根因，并从全局角度修复：

- 先复现或用数据证明问题发生在哪一层。
- 再确认是否是配置、框架使用、产品语义缺失、持久化顺序、并发/超时、或 UI 恢复问题。
- 修复必须落在正确层级，并补覆盖同类情况的测试。
- 如必须临时修复数据，必须同时说明它只是数据处置，并继续做代码级标准修复。

## 文档和测试

涉及架构边界、生命周期、存储、队列、认证、scope、artifact 的改动，必须同步更新相关文档或 runbook。

常用验证：

```bash
pnpm --filter @operator/web test
pnpm --filter @operator/web typecheck
pnpm --filter @operator/web lint
pnpm --filter @operator/mastra-app test
pnpm --filter @operator/mastra-app typecheck
```

按改动范围选择验证命令；不能运行时必须说明原因。
