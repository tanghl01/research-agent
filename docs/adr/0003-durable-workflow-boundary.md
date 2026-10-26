# ADR 0003: Durable Workflow Boundary

## Status

Accepted

## Context

Operator 需要后台任务、stale run reconciler、artifact retry 和维护任务。当前 MVP 尚未出现必须由 durable workflow 平台处理的跨天暂停、人审恢复、补偿事务或复杂重试图。

## Decision

MVP 第一批使用 BullMQ/Redis 作为生产后台任务队列。Temporal 或 Inngest 不进入第一批依赖，只保留 adapter 边界和触发条件。

当任务具备跨天暂停、人审恢复、补偿事务或复杂重试时，必须重新做 ADR 评估，不允许自研 durable workflow。

## Consequences

- reconciler、artifact retry、scope sync 和维护任务通过 BullMQ job 执行。
- 不在 route 内运行长修复任务。
- 不实现自研 durable workflow engine。
