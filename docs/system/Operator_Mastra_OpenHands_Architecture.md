# Operator 基于 Mastra + OpenHands 的架构设计总结

> 状态说明：本文是 Mastra/OpenHands 架构讨论的历史总结，从历史版本恢复保留。当前仓库代码的 MVP 实现以 `Operator_Mastra_First_MVP_Positioning.md` 为准；本文用于后续生产化设计回看。

## 当前结论

MVP 阶段推荐把 Operator 定位为：

```text
Mastra-powered vertical agent platform
```

也就是：

```text
Operator Platform
  -> Mastra App / Mastra Runtime
    -> OpenHands Runtime
```

更直白地说：

- Operator 在 MVP 阶段可以先看成一个深度定制的 Mastra 实例。
- Mastra 承担编排运行时、工作流执行、Agent/Tool/MCP/Memory/Eval/Observability 基础设施。
- OpenHands 承担复杂文件、代码、Shell、浏览器和沙箱执行。
- Operator 保留账户、计费、Workspace、Artifact、Marketplace、行业 Workflow Pack、Skill Pack 和质量策略等平台语义。

因此，MVP 阶段不应优先自研完整 Workflow Engine，也不应 Fork OpenHands 做平台底座。

推荐原则：

```text
执行层 Mastra-native
平台层 Operator-owned
复杂执行 OpenHands-backed
```

---

## 总体分层

```text
User
  -> Operator Web / API
  -> Account / Billing / Project / Artifact / Marketplace
  -> Workspace
  -> Mastra Workflow / Agent / Tool / MCP
  -> OpenHands Adapter
  -> OpenHands Runtime
  -> Artifact Store
```

三者职责：

| 层 | 核心定位 | 负责什么 |
| --- | --- | --- |
| Operator | 平台层 | 用户、项目、Workspace、计费、权限、Artifact、Marketplace、行业能力包 |
| Mastra | 编排运行时 | Workflow graph、Agent、Tool、MCP、Memory、Eval、Observability、API 化 |
| OpenHands | 执行运行时 | LLM loop、tool calling、Shell、Browser、File System、Sandbox、复杂产物生成 |

---

## 为什么 MVP 阶段应尽量融入 Mastra

Operator 想要的很多底层逻辑，Mastra 已经提供了工程化实现：

- Workflow graph：顺序、并行、分支、循环、嵌套 workflow。
- Agent primitive：模型、指令、工具、上下文和状态管理。
- Tool primitive：typed tool schema、executor、集成能力。
- MCP：连接外部工具和服务的标准接口。
- Memory / RAG：长期记忆、会话上下文、检索能力。
- Eval / Scorer：模型评分、规则评分、质量评估。
- Observability：trace、log、token usage、latency、tool call 记录。
- Suspend / Resume / Snapshot：长任务、人审、暂停恢复、失败续跑。
- Deployment：把 agent 和 workflow 暴露为服务端 API。

这些能力如果由 Operator 从零实现，会消耗大量 MVP 时间，而且短期内很难比 Mastra 更完整。

因此，MVP 阶段 Operator 应该优先做：

- 选择高价值行业场景。
- 把业务流程表达成 Mastra workflow。
- 把开源项目、脚本、MCP server、prompt、模板封装成 Mastra tools / workflows。
- 把 OpenHands 接入为一个可控执行 runtime。
- 在外围补齐账户、计费、Artifact、权限和交付体验。

---

## Operator 仍然必须自有的部分

Mastra 不应该吞掉 Operator 的平台语义。

Operator 自有对象包括：

- User / Account
- Organization / Team
- Project
- Workspace
- Task
- Workflow Pack
- Skill Pack
- Tool Pack
- Artifact
- Billing Ledger
- Permission / Policy
- Marketplace Listing
- Source / License / Security Metadata

这些对象决定 Operator 是一个专业智能体平台，而不只是一个 Mastra demo。

推荐做法：

```text
Mastra Workflow
  + Operator metadata
```

Operator metadata 至少包括：

- industry
- workspace
- task_type
- required_inputs
- output_artifacts
- pricing_unit
- permission_scope
- quality_checks
- runtime_requirements
- source_repository
- license
- security_review_status

这样可以做到：

- 执行时使用 Mastra 原生能力。
- 平台治理仍由 Operator 控制。
- 后续即使替换或扩展 runtime，也不会丢失 Operator 的核心资产模型。

---

## Mastra 的定位

Mastra 是 Operator MVP 的编排运行时和 AI primitive 基础设施。

适合承担：

- Workflow Engine
- Workflow Graph Runtime
- Agent Runtime Wrapper
- Tool Runtime
- MCP Integration
- Memory / RAG Layer
- Eval / Scorer Layer
- Observability Layer
- Workflow API Server

在 Operator 中，Mastra 应主要负责：

- 执行 workflow graph。
- 管理 step 输入输出。
- 处理分支、并行、循环和嵌套 workflow。
- 提供 suspend/resume/snapshot。
- 调用 agent、tool、MCP server。
- 记录 trace、log、token、latency 和 tool call。
- 运行 eval/scorer。
- 将 workflow/agent 作为 API 暴露给 Operator API 或前端。

Mastra 不应负责：

- 定义 Operator 的账户体系。
- 定义计费规则。
- 定义 Artifact 权限和下载策略。
- 定义 Marketplace 商品模型。
- 决定行业 workflow 的商业包装。
- 接管 Operator 的长期平台数据模型。

---

## OpenHands 的定位

OpenHands 是 Operator 的复杂执行运行时。

它不是平台层，也不是业务 workflow 编排器。

OpenHands 负责：

- 在受控 workspace 中执行复杂 step。
- 通过 LLM loop 完成思考、行动、观察、修正。
- 调用 Shell、Python、文件编辑器、浏览器等工具。
- 处理复杂文件生成和修改。
- 运行开源项目、脚本、CLI 工具。
- 在沙箱或隔离环境中执行不确定任务。
- 按 output contract 生成最终文件。
- 返回日志、usage、状态和 artifact manifest。

OpenHands 不负责：

- 选择用户应该跑哪个 workflow。
- 组合多个 workflow chain。
- 管理用户、项目、计费和权限。
- 决定 Artifact 的平台级生命周期。
- 决定行业能力包如何售卖。
- 充当 Operator 的平台底座。

在 Operator 中，OpenHands 的标准调用边界应是：

```text
Mastra workflow step
  -> OpenHands Adapter
    -> OpenHands Runtime
      -> required output files
      -> artifact manifest
      -> logs / usage / status
```

OpenHands Adapter 需要提供统一接口：

- run()
- pause()
- resume()
- cancel()
- collect_artifacts()
- get_logs()
- get_usage()

Adapter 输入：

- workspace
- instruction
- inputs
- output_contract
- allowed_tools
- forbidden_tools
- timeout
- model_config
- metadata

Adapter 输出：

- status
- outputs
- artifacts
- logs
- usage
- error

---

## GordenPPTSkill 的固化接入方式

GordenPPTSkill 原始形态是“AI 读取 `SKILL.md` / `references/workflow.md` 后按规则执行”的技能包。
其中真正确定性的部分是 `scripts/build_pptx.py`：

- 输入 `template.pptx`
- 输入 `detail.json`
- 输入 `edits.json`
- 按 `selected_slides` 选页
- 按 `slot_id` / `address` 替换文字
- 使用 `max_chars` / `chars_per_line` / `max_lines` 做出框校验
- 保留模板原排版、颜色、字号、图片和动画

Operator 不应依赖 agent 每次临场复刻这套文字流程。
MVP 中 Gorden 应作为本地 vendored skill source 接入，并把文字工作流固化为 Mastra steps。
该 skill source 是外部原始项目的 checkout，应放在 `skills/vendored/GordenPPTSkill/` 并由 Git 忽略。
Operator 代码只提交 `skills/manifests/GordenPPTSkill.skill.json`，由 skill registry 解析真实路径：

```text
normalize brief
  -> prepare_gorden_skill
    -> 通过 skill registry 解析 GordenPPTSkill
    -> 校验本地 GordenPPTSkill 源码、build_pptx.py、19 套模板
  -> plan_gorden_workflow
    -> 读取 templates/INDEX.md、intro.md、detail.json
    -> 生成 template candidates
    -> 确定 template_slug
    -> 按 page_roles / skip_pages / use_for 选页
  -> compose_gorden_edits
    -> 遍历 selected slides 的 editable slots
    -> 生成完整 edits.json
    -> 校验 slot coverage
  -> render_gorden_deck
    -> 调用 manifest entrypoint scripts/build_pptx.py --strict
  -> validate delivery
```

需要模型判断的部分分级处理：

- 简单判断：模板匹配、候选排序、短文案归纳，可以调用裸 LLM，输出结构化 JSON。
- 复杂判断：用户自带模板、复杂数据图表、长篇页面规划、需要查看渲染图的任务，交给 OpenHands runtime。
- 确定性执行：选页结果、`edits.json`、`build_pptx.py --strict`、artifact manifest 和校验必须由代码强制。

这样 Gorden 的模板能力从“agent 行为约定”升级成“Operator 可审计 workflow”。

---

## 为什么不直接 Fork OpenHands

Operator 的核心价值不在底层 agent runtime。

Operator 的核心价值在：

- 行业 workflow pack。
- skill / tool marketplace。
- artifact 交付和审计。
- workspace 产品体验。
- 专业任务的质量门禁。
- 用户、项目、权限和计费。

OpenHands 是非常好的 execution runtime，但不是专业智能体平台的全部。

直接 Fork OpenHands 会带来几个问题：

- 平台边界容易被 runtime 绑死。
- 行业 workflow 和 artifact 资产难以独立沉淀。
- 后续接 Claude Runtime、OpenAI Runtime、自研 Runtime 会变重。
- 很多精力会耗在维护 upstream runtime 差异上。

更好的做法是：

```text
OpenHands as external runtime
```

通过 adapter 接入，不改造为 Operator 的主平台。

---

## Task Orchestrator 的调整

原始设想中，Task Orchestrator 是 Operator 自研的受约束智能编排器。

在 Mastra-first MVP 中，Task Orchestrator 应拆成两层：

### Operator Task Layer

负责平台语义：

- 接收用户任务。
- 识别 workspace / task_type。
- 校验账户、权限、额度。
- 选择候选 workflow pack。
- 应用成本、风险和质量策略。
- 创建 task/run/artifact 记录。

### Mastra Orchestration Layer

负责执行语义：

- 执行 workflow graph。
- 调用 agent/tool/MCP/OpenHands。
- 管理 step 状态。
- 记录 trace/log。
- 支持 suspend/resume。
- 运行 eval/scorer。

这样可以避免 Operator 重复实现 Mastra 已经做好的执行编排，又保留 Operator 对业务和平台资产的控制权。

---

## Workflow 与 Skill 的 Mastra 化

MVP 阶段，Operator 的 workflow 和 skill 应尽量转换成 Mastra 语义。

### Workflow Pack

Operator Workflow Pack 可以映射为：

```text
Mastra Workflow
+ Operator workflow metadata
+ Artifact contract
+ Pricing policy
+ Permission policy
+ Quality checks
```

### Skill Pack

Operator Skill Pack 可以映射为：

```text
Mastra Agent
or Mastra Tool
or MCP Server
or nested Mastra Workflow
+ Operator skill metadata
```

### Tool Pack

Operator Tool Pack 可以映射为：

```text
Mastra Tool
or MCP Tool
or OpenHands-executable script/project
```

---

## 开源 Skill / Workflow 的适配路线

Operator 可以利用 GitHub 上大量开源项目、脚本、模板和 workflow。

推荐适配流程：

```text
Discover
  -> License Review
  -> Security Review
  -> Scope Classification
  -> Wrap as Mastra Tool / MCP / Workflow
  -> Add Operator Metadata
  -> Add Artifact Contract
  -> Add Eval / Quality Checks
  -> Publish to Operator Marketplace
```

适配目标不是简单收集开源项目，而是把它们转成可复用、可计费、可审计、可组合的 Operator 能力包。

每个开源能力包必须记录：

- source_url
- license
- maintainer
- version
- security_review_status
- runtime_requirements
- allowed_tools
- forbidden_tools
- expected_artifacts
- quality_checks

---

## Execution Graph

长期目标不是只支持线性 workflow。

长期目标是 Execution Graph：

- Workflow Node
- Agent Node
- Skill Node
- Tool Node
- Human Node
- Artifact Node
- Runtime Node
- Eval Node

Mastra 适合承载这个 graph 的执行部分。

Operator 负责给 graph 加上平台语义：

- 谁能运行。
- 运行要花多少钱。
- 产物归谁。
- 产物如何下载和审计。
- 哪些行业包可见。
- 哪些步骤需要人工审核。

---

## Workflow Chain

多个 workflow 可以组合成 workflow chain。

例如：

```text
paper_summary
  -> research_defense_ppt
  -> speech_script
```

在 MVP 中，Workflow Chain 可以先由 Operator Task Layer 选择和串联。

中长期可以逐步交给 Mastra nested workflow / graph 执行。

---

## MVP 阶段策略

MVP 不做复杂自研动态图引擎。

采用：

```text
Mastra-first Workflow First
```

流程：

```text
User Request
  -> Operator Task Layer
  -> Workspace / Task Type Routing
  -> Mastra Workflow
  -> Mastra Step / Tool / Agent
  -> OpenHands Step when complex execution is needed
  -> Artifact Contract Validation
  -> Operator Artifact Store
```

MVP 优先目标：

- 快速上线可用 workflow。
- 快速封装行业场景。
- 快速连接 OpenHands。
- 快速生成可交付 artifact。
- 快速验证付费和复用价值。

MVP 不优先做：

- 自研完整 workflow runtime。
- 自研通用 agent runtime。
- Fork OpenHands。
- 大而全的 marketplace。
- 复杂动态图编辑器。

---

## 推荐技术栈

Frontend:

- Next.js

Backend:

- Operator API
- Mastra
- NestJS 或 Hono / Express

Database:

- PostgreSQL

Cache / Queue:

- Redis

Storage:

- MinIO / S3

Runtime:

- Mastra for orchestration
- OpenHands for execution

Container:

- Docker

Observability:

- Mastra traces
- OpenTelemetry-compatible backend
- Operator billing / artifact ledger

---

## MVP 路线

### 阶段 1：Mastra 化第一个闭环

- PPT Workspace
- PPT generation workflow
- Agnes / OpenAI-compatible LLM
- OpenHands runtime adapter
- Artifact manifest
- Downloadable PPTX / MD / JSON
- Basic validation

### 阶段 2：扩展 Workspace

- Teacher Workspace
- Research Workspace
- More workflow packs
- Skill / Tool wrapping pipeline
- Basic eval/scorer

### 阶段 3：平台化

- Workflow Registry
- Skill Registry
- Artifact Store
- Billing Ledger
- Permission Policy
- Marketplace Listing

### 阶段 4：规模化

- Workflow Marketplace
- Skill Marketplace
- Human review
- Multi-runtime support
- Runtime cost optimization
- Enterprise workspace

---

## 最终判断

Operator 应在 MVP 阶段深度采用 Mastra。

但准确说法不是：

```text
Operator = Mastra
```

而是：

```text
Operator = Mastra-powered vertical agent platform
```

Mastra 是 Operator 的编排运行时和 AI primitive 基础设施。

OpenHands 是 Operator 的复杂执行运行时。

Operator 是面向行业任务、artifact 交付、计费、权限和 marketplace 的平台层。

最终边界：

```text
Mastra runs workflows.
OpenHands executes complex steps.
Operator owns platform semantics.
```
