# ADR 0001: Observability Boundary

## Status

Accepted

## Context

Operator 需要记录 LLM/runtime 的 latency、错误、provider 调用和调试线索，但 MVP 不应自研 trace backend，也不应把 Langfuse 平台本体嵌入主仓库。

## Decision

MVP 第一批只接入 OpenTelemetry API 和 Mastra tracing adapter 边界。Langfuse 只能作为外部 backend 或 exporter 目标，通过部署配置接入。

`ProductEvent` 只用于产品审计、前端过程展示和用户可见摘要，不替代 observability backend。

## Consequences

- 应用代码可以创建 OpenTelemetry span。
- 不在 Web route、DB helper 或 contracts 中自研 trace 存储平台。
- 如需 Langfuse，使用云端或独立自部署服务，并通过 exporter/adapter 对接。
