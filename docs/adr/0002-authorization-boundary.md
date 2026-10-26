# ADR 0002: Authorization Boundary

## Status

Accepted

## Context

Operator 当前 MVP 权限主要是 owner/admin/member、用户任务、项目、产物和后台管理入口。直接引入 OpenFGA 会增加部署、建模和运维复杂度。

## Decision

MVP 保持简单产品权限模型，不默认引入 OpenFGA。权限超过简单 owner/admin/member 后，先评估 Casbin；出现复杂多租户关系授权、跨组织共享和关系图策略后，再评估 OpenFGA。

## Consequences

- Web route 和 DB helper 不应硬编码复杂权限矩阵。
- 产品层只定义资源、动作和策略语义。
- 引入 Casbin 或 OpenFGA 前必须补充新的 ADR。
