# Operator 专业智能体平台技术开发 Spec v1

> 状态说明：本文是 Operator 后期平台化/生产化演进参考文档，从历史版本恢复保留。当前仓库代码的 MVP 实现以 `docs/system/Operator_Mastra_First_MVP_Positioning.md` 为准；若两者冲突，先按 Mastra-first MVP 文档执行。

状态：Draft v1
日期：2026-06-04
来源：`Operator_Architecture_Design_v1.md` 及后续架构讨论
内核基准：`Operator_TaskOrchestrator_Workflow_Runtime_Architecture.md`

---

## 1. 文档目标

本文档用于指导 Operator 的 MVP 到平台化阶段开发，重点把原始架构中的概念落成可开发、可测试、可扩展的技术规范。

本文档回答以下问题：

- Operator MVP 要先做什么，不做什么。
- Workflow Engine 如何保证流程稳定。
- Skill Package、Tool Package、Industry Agent Package 如何定义。
- OpenHands 在系统中承担什么角色。
- 金融包、法律包、设计包等行业包如何接入平台。
- 数据库、API、Artifact、计费、安全、日志如何设计。
- 后续如何平滑接入 LangGraph、Temporal、更多模型和更多执行引擎。

---

## 2. 产品定位

Operator 是面向专业工作者的行业智能体平台，目标用户包括：

- 科研人员
- 教师
- 律师
- 会计师
- 投行分析师
- 设计师
- 企业运营人员

Operator 不是普通聊天机器人，也不是单纯的代码助手。Operator 的核心定位是：

```text
专业行业工作流平台
+
智能体执行系统
+
行业包市场
+
Artifact 交付系统
```

核心架构原则：

```text
用户
→ Workspace
→ Task Orchestrator
→ Workflow / Workflow Chain
→ Agent Runtime
→ Skill
→ Tool
→ Artifact
```

平台最终目标：

```text
让专业任务以 workspace + orchestrator + workflow + runtime + skill + tool + artifact 的形式被标准化、执行、复用、审计和交易。
```

---

## 3. 与 Codex、Claude Cowork、CodeBuddy 的差异

Operator 不应直接竞争“通用聊天”或“通用代码生成”。差异化应建立在行业包和交付物质量上。

| 产品 | 主定位 | Operator 的差异 |
|---|---|---|
| Codex | 软件工程智能体 | Operator 面向多行业专业工作，不以代码仓库为唯一工作对象 |
| Claude Cowork | 通用知识工作桌面代理 | Operator 更强调行业 workflow、可审计执行、Artifact 管理和行业包市场 |
| CodeBuddy | 研发全流程助手 | Operator 不限于研发，强调法律、金融、教育、科研、设计等行业任务 |

Operator 的核心差异：

- 行业包，而不是通用助手。
- 明确 workflow，而不是自由对话。
- Artifact 交付，而不是只输出文本。
- 开源工具封装，而不是直接运行不受控仓库。
- 多模型路由，而不是绑定单一模型。
- 可审计执行轨迹，而不是黑箱 agent 行为。
- 人工审核节点，适配法律、金融、教育等高风险场景。

---

## 4. 总体架构

```text
User
 ↓
Operator Web / WeChat / Enterprise Portal
 ↓
Operator API
 ↓
Task Service
 ↓
Workspace Context
 ↓
Task Orchestrator
 ↓
Workflow Engine / Workflow Chain Runner
 ↓
Agent Runtime Adapter / LLM Adapter / Tool Runner / Human Review
 ↓
Artifact Service
 ↓
Storage / Database / Billing / Logs
```

MVP 技术栈建议：

```text
Frontend: React / TypeScript
Backend: FastAPI / Python
Database: PostgreSQL
Queue: Redis Queue / Celery / RQ / Dramatiq 任选其一
Object Storage: MinIO, 后续兼容 S3
Runtime: Docker Sandbox
Execution: Agent Runtime Adapter（MVP 首选 OpenHands）
Model Gateway: OpenAI / Claude / Qwen / DeepSeek / Gemini 统一接口
```

MVP 不拆微服务。所有核心业务先放在一个 API 服务内，通过模块边界保持可拆分性。

---

## 5. 核心职责边界

### 5.1 Operator 负责

- 用户、Workspace、Project、Task。
- Workspace 作用域、可用执行范围目录、状态和 UI。
- Task Orchestrator 的路由、规划、组合、策略和状态管理。
- Workflow 定义、运行、状态管理。
- Workflow Chain 编排。
- Skill Package 和 Tool Package 注册。
- Industry Agent Package 管理。
- Agent Runtime 任务构造和结果接收。
- Artifact 元数据、存储、下载、预览。
- 模型路由和成本统计。
- 权限、审计、计费、日志。
- Marketplace 和包版本管理。

### 5.2 Workspace 负责

- 提供 Scope：限定当前任务行业、项目、数据和权限边界。
- 提供 Registry：限定可选 Workflow、Skill、Tool、模板和知识库。
- 提供 State：保存用户、项目、任务和历史上下文。
- 提供 UI：承载行业工作台入口。

Workspace 不是 Agent，不负责推理、规划或执行。

### 5.3 Task Orchestrator 负责

- 理解用户需求和当前 workspace 上下文。
- 判断是否需要追问。
- 根据 intent、workspace 和 policy 选择 workflow。
- 组合多个 workflow 形成 workflow chain。
- 判断哪些 step 需要进入 Agent Runtime。
- 管理任务执行边界、风险策略和人工审核触发条件。

Task Orchestrator 是受约束的智能编排器。内部可以使用 LLM，但 LLM 仅用于分类、规划、路由和组合，不负责执行代码、浏览器操作或文件修改。

### 5.4 Workflow Engine 负责

- 决定下一步执行哪个 step。
- 执行 Task Orchestrator 已选定的 workflow 或 workflow chain。
- 记录每个 step 的输入、输出、状态、错误和耗时。
- 调用对应 step adapter。
- 执行校验、重试、失败终止、人工审核暂停。

Workflow Engine 不负责自由推理，不负责“自己想下一步”，也不负责业务任务路由。它是确定性流程控制器。

### 5.5 Agent Runtime 负责

- 在单个 workflow step 的边界内执行复杂任务。
- 使用 LLM、Tool Calling、Memory、Planner、Executor 和 Feedback Loop。
- 调用 Skill 和 Tool。
- 在 sandbox 中完成文件处理、Python、Shell、浏览器、Office 等动作。
- 返回日志、状态、输出和 artifact manifest。

Agent Runtime 可以由 OpenHands、Claude Runtime、OpenAI Runtime 或后续自研 Runtime 实现。Runtime 不负责选择业务 workflow，也不负责行业任务路由。

### 5.6 Skill Package 负责

- 描述某一步怎么做。
- 提供 prompt、脚本、模板、规则、参考知识。
- 声明输入 schema、输出 schema、产物类型、质量检查。

Skill 不应该决定整个任务流程，也不应该决定下一步去哪。

### 5.7 Tool Package 负责

- 提供底层动作能力，例如 Python、Browser、Shell、PowerPoint、Word、数据库或第三方 API connector。
- 声明权限、输入输出 schema、运行时、资源限制和 license。
- 接受安全审查和版本管理。

Tool 不决定业务流程，也不直接暴露给用户自由调用。

### 5.8 OpenHands 负责

- 在沙箱中执行文件处理、Python、Shell、浏览器、工具调用。
- 根据 Operator 给定的结构化任务生成文件产物。
- 返回日志、状态、artifact manifest。

OpenHands 是 Agent Runtime 的一个实现，不负责选择业务 workflow，也不负责行业任务路由。

### 5.9 LLM 负责

- 文本生成。
- 局部判断。
- 总结、解释、分类。
- 在 Task Orchestrator 中进行受约束的 intent 分类、规划、路由和 workflow 组合。
- 在受控 step 内完成需要语言能力的任务。

LLM 不应该作为流程稳定性的来源。

---

## 6. MVP 范围

### 6.1 MVP 必须完成

- 用户上传文件。
- 创建 task。
- 根据 workspace 和 task_type 进入 Task Orchestrator。
- Task Orchestrator 支持规则路由版：选择单个 workflow，必要时生成 workflow chain。
- 按 workflow step 顺序执行。
- 支持 `llm_step`、`tool_step`、`openhands_step`、`validation_step`。
- 支持 Agent Runtime Adapter 抽象，MVP 首选 OpenHands Runtime。
- 每一步记录状态、输入、输出、错误、耗时。
- 生成 artifact 并保存元数据。
- 支持基础模型调用和 token/cost 记录。
- 支持失败重试和任务终止。
- 支持最少一个行业 Agent 包的完整闭环。

建议 MVP 首选行业：

```text
教师成绩分析 Agent
或
科研文献/论文辅助 Agent
```

原因：边界较清楚，产物明确，合规风险低于金融和法律。

### 6.2 MVP 可以延后

- LangGraph。
- Temporal。
- Kubernetes。
- 微服务。
- 可视化 workflow 编排器。
- 复杂 DAG。
- 多 Agent 自主协作。
- 完整 Marketplace。
- 复杂审批流。
- 企业级 SSO。

### 6.3 MVP 关键验收标准

一个用户可以完成：

```text
上传输入文件
 ↓
选择行业 Agent 和任务类型
 ↓
进入对应 Workspace
 ↓
Task Orchestrator 选择 workflow 或 workflow chain
 ↓
系统自动创建 workflow_run
 ↓
按步骤执行
 ↓
生成报告、表格、PPT 或其他 artifact
 ↓
用户下载或预览产物
 ↓
后台可查看每步日志、成本、耗时和失败原因
```

---

## 7. Workflow Engine 设计

### 7.1 三层内核中的位置

```text
Task Orchestrator
  负责选择 workflow / 组合 workflow chain / 管理边界
Workflow Engine
  负责确定性执行已选定的 workflow
Agent Runtime
  负责在 step 内决定怎么做
```

Workflow Engine 不是任务编排器，也不是 Agent Runtime。它不理解用户原始意图，不做 workflow 搜索和组合，不在 step 内自由推理。

### 7.2 核心原则

工作流采用：

```text
主干写死
分支可配置
局部自主
```

含义：

- 主流程必须由 workflow 定义显式声明。
- 分支只能基于明确条件和 validator 结果。
- LLM、OpenHands 或其他 Agent Runtime 只能在当前 step 内自主处理局部问题。

错误做法：

```text
把完整流程写进 Skill markdown，然后让 OpenHands 自己理解并自由执行。
```

正确做法：

```text
Task Orchestrator 决定选择或组合哪些 Workflow
Workflow Engine 执行已选定 Workflow 的步骤
Skill 提供方法
Agent Runtime / OpenHands 执行受限步骤
Validator 检查结果
```

### 7.3 Step 类型

MVP 支持以下 step：

| Step 类型 | 用途 |
|---|---|
| `llm_step` | 调用模型生成、总结、分类、判断 |
| `tool_step` | 调用确定性脚本或内部工具 |
| `runtime_step` | 交给 Agent Runtime 在沙箱或受控运行时中处理复杂执行，后续标准化 |
| `openhands_step` | `runtime_step` 的 MVP 具体实现，交给 OpenHands 在沙箱中处理复杂执行 |
| `validation_step` | 校验文件、schema、格式、内容质量 |
| `human_review_step` | 人工确认，MVP 可选 |

后续扩展：

| Step 类型 | 用途 |
|---|---|
| `langgraph_step` | 复杂 Agent loop、多分支、checkpoint |
| `temporal_step` | 长任务可靠执行、复杂重试和恢复 |
| `external_api_step` | 调用第三方 SaaS API |
| `subworkflow_step` | 调用另一个 workflow |

### 7.4 Workflow 定义格式

建议使用 YAML。

```yaml
id: teacher_grade_analysis
version: 1.0.0
title: 教师成绩分析
description: 上传成绩表，生成统计分析、图表和分析报告。

inputs:
  type: object
  required: [score_file]
  properties:
    score_file:
      type: file
      accept: [.xlsx, .csv]
    course_name:
      type: string
    class_name:
      type: string

defaults:
  timeout_seconds: 900
  max_retry: 1

steps:
  - id: parse_scores
    type: tool_step
    skill: teacher.parse_excel@1.0.0
    input:
      file: "{{ inputs.score_file }}"
    output:
      parsed_scores: parsed_scores.json
    timeout_seconds: 60

  - id: compute_statistics
    type: tool_step
    skill: teacher.score_statistics@1.0.0
    input:
      parsed_scores: "{{ steps.parse_scores.output.parsed_scores }}"
    output:
      statistics: statistics.json
    timeout_seconds: 60

  - id: generate_charts
    type: openhands_step
    skill: teacher.generate_charts@1.0.0
    input:
      statistics: "{{ steps.compute_statistics.output.statistics }}"
    output:
      charts: charts/
    timeout_seconds: 180

  - id: write_analysis
    type: llm_step
    skill: teacher.attainment_analysis@1.0.0
    input:
      statistics: "{{ steps.compute_statistics.output.statistics }}"
    output:
      analysis: analysis.md
    model_policy:
      preferred: gpt-5.3
      fallback: [claude-opus, qwen-max]

  - id: generate_report
    type: openhands_step
    skill: teacher.generate_docx@1.0.0
    input:
      statistics: "{{ steps.compute_statistics.output.statistics }}"
      analysis: "{{ steps.write_analysis.output.analysis }}"
      charts: "{{ steps.generate_charts.output.charts }}"
    output:
      report: report.docx
    timeout_seconds: 300

  - id: validate_report
    type: validation_step
    checks:
      - type: file_exists
        path: "{{ steps.generate_report.output.report }}"
      - type: min_file_size
        path: "{{ steps.generate_report.output.report }}"
        min_bytes: 50000
      - type: artifact_manifest_contains
        artifact_type: docx
```

### 7.5 Workflow Chain

Workflow Chain 是 Task Orchestrator 组合多个 workflow 后形成的执行计划。

示例：

```text
paper_summary
 ↓
research_defense_ppt
 ↓
speech_script
```

MVP 可以先把 workflow chain 表示为顺序数组：

```json
{
  "chain_id": "wfc_123",
  "task_id": "task_123",
  "workflows": [
    {"id": "research.paper_summary", "version": "1.0.0"},
    {"id": "research.defense_ppt", "version": "1.0.0"},
    {"id": "research.speech_script", "version": "1.0.0"}
  ]
}
```

执行规则：

- Chain 中每个 workflow 仍然由 Workflow Engine 确定性执行。
- 上一个 workflow 的 artifact 和 selected outputs 可以进入下一个 workflow 的 inputs。
- Chain 的选择、顺序和边界由 Task Orchestrator 决定。
- Workflow Engine 不在运行中自行新增 workflow。

### 7.6 Workflow Run 状态机

```text
created
 ↓
queued
 ↓
running
 ↓
waiting_for_human 可选
 ↓
succeeded
```

失败状态：

```text
failed
cancelled
timeout
```

Step Run 状态机：

```text
pending
 ↓
running
 ↓
succeeded
```

失败状态：

```text
failed
skipped
timeout
retrying
```

### 7.7 Workflow Engine 伪代码

```python
def run_workflow(workflow_run_id: str):
    run = load_workflow_run(workflow_run_id)
    definition = load_workflow_definition(run.workflow_id, run.workflow_version)

    for step in definition.steps:
        if should_skip(step, run.context):
            mark_step_skipped(step)
            continue

        step_run = create_step_run(run.id, step.id)

        try:
            resolved_input = resolve_step_input(step.input, run.context)
            result = execute_step(step, resolved_input)
            validate_step_output(step, result)
            persist_artifacts(step_run.id, result.artifacts)
            update_context(run.id, step.id, result.outputs)
            mark_step_succeeded(step_run.id)
        except RetryableError:
            retry_or_fail(step_run.id)
        except Exception as error:
            mark_step_failed(step_run.id, error)
            mark_workflow_failed(run.id, error)
            return

    mark_workflow_succeeded(run.id)
```

### 7.8 Task Orchestrator 伪代码

```python
def orchestrate_task(task_id: str):
    task = load_task(task_id)
    workspace = load_workspace(task.workspace_id)
    registry = load_workspace_registry(workspace.id)

    intent = analyze_intent(task.input, workspace)
    if intent.needs_clarification:
        request_clarification(task.id, intent.questions)
        return

    plan = route_or_compose_workflows(
        intent=intent,
        registry=registry,
        policy=workspace.policy,
    )
    validate_plan_against_policy(plan, workspace.policy)
    persist_orchestration_plan(task.id, plan)

    for workflow_ref in plan.workflows:
        create_and_queue_workflow_run(
            task_id=task.id,
            workflow_id=workflow_ref.id,
            workflow_version=workflow_ref.version,
            inputs=resolve_chain_inputs(task.id, workflow_ref),
        )
```

---

## 8. Skill Package 设计

### 8.1 Skill 的定位

Skill 是单个步骤的方法包，不是完整行业 Agent。

Skill 包含：

- `skill.yaml`
- `SKILL.md`
- prompt 模板
- 脚本
- 模板文件
- 参考文档
- 输入输出 schema
- 校验规则
- 测试样例

### 8.2 Skill 目录结构

```text
skills/
  teacher/
    parse_excel/
      skill.yaml
      SKILL.md
      scripts/
        parse_excel.py
      schemas/
        input.schema.json
        output.schema.json
      evals/
        cases/
          basic_scores.xlsx
        expected/
          basic_scores.output.json

    score_statistics/
      skill.yaml
      SKILL.md
      scripts/
      schemas/
      evals/

    generate_docx/
      skill.yaml
      SKILL.md
      templates/
        report_template.docx
      scripts/
      schemas/
      evals/
```

### 8.3 Skill Manifest

```yaml
id: teacher.parse_excel
version: 1.0.0
title: 成绩表解析
description: 将 Excel 或 CSV 成绩表解析为标准 JSON。

runtime:
  type: python
  entrypoint: scripts/parse_excel.py
  requirements: requirements.txt

input_schema: schemas/input.schema.json
output_schema: schemas/output.schema.json

allowed_tools:
  - filesystem.read
  - filesystem.write

permissions:
  network: false
  shell: false
  browser: false

limits:
  timeout_seconds: 60
  max_input_file_mb: 20
  max_output_file_mb: 20

artifacts:
  outputs:
    - name: parsed_scores
      type: json
      path: parsed_scores.json

validators:
  - type: json_schema
    schema: schemas/output.schema.json

evals:
  - name: basic_scores
    input: evals/cases/basic_scores.xlsx
    expected: evals/expected/basic_scores.output.json
```

### 8.4 Skill 版本规则

Skill 必须版本化。

```text
major.minor.patch
```

规则：

- 修改输入输出 schema，升 major。
- 修改行为但保持接口兼容，升 minor。
- 修 bug 或改 prompt，升 patch。

Workflow 必须引用具体版本：

```yaml
skill: teacher.parse_excel@1.0.0
```

禁止生产 workflow 引用 `latest`。

---

## 9. Industry Agent Package 设计

### 9.1 定义

行业智能体不是单个 prompt，而是一组 workflow、skill、tool、知识库、模板和质量检查规则。

```text
Industry Agent Package
=
Workflows
+
Skills
+
Tool Packages
+
Knowledge
+
Templates
+
Validators
+
Evals
+
Security Policy
```

### 9.2 行业包目录结构

```text
agent-packages/
  legal/
    package.yaml
    workflows/
      contract_review.yaml
      legal_research.yaml
      litigation_timeline.yaml
    skills/
      clause_extraction/
      citation_check/
      risk_scoring/
    tools/
      law_search/
      pdf_parser/
    knowledge/
      contract_clause_library.md
      risk_checklists/
    templates/
      contract_review_report.docx
      legal_memo.docx
    evals/
      contract_review_cases/
    policies/
      sandbox.yaml
      human_review.yaml

  finance/
    package.yaml
    workflows/
      pitch_book.yaml
      earnings_review.yaml
      dcf_review.yaml
    skills/
    tools/
    templates/
    evals/

  design/
    package.yaml
    workflows/
      ui_review.yaml
      brand_brief.yaml
      figma_to_prototype.yaml
    skills/
    tools/
    templates/
    evals/
```

### 9.3 Package Manifest

```yaml
id: legal
version: 1.0.0
title: 法律智能体包
description: 合同审查、法律检索、案件事实整理和法律文书生成。

supported_locales:
  - zh-CN
  - en-US

workflows:
  - id: legal.contract_review
    version: 1.0.0
    path: workflows/contract_review.yaml
  - id: legal.legal_research
    version: 1.0.0
    path: workflows/legal_research.yaml

skills:
  - path: skills/clause_extraction
  - path: skills/risk_scoring
  - path: skills/citation_check

tools:
  - path: tools/pdf_parser
  - path: tools/law_search

security:
  default_human_review_required: true
  allow_external_network: false
  pii_handling: strict

billing:
  default_pricing_unit: task
  estimated_cost_level: medium
```

### 9.4 法律包示例工作流

法律智能体应包含多个任务型 workflow，而不是一个万能 workflow。

初始建议：

- 合同审查。
- 法律检索摘要。
- 案件事实时间线整理。

合同审查 workflow 主干：

```text
上传合同
 ↓
解析合同结构
 ↓
识别合同类型和管辖地
 ↓
抽取关键条款
 ↓
检查缺失条款
 ↓
风险评分
 ↓
生成修改建议
 ↓
生成审查报告
 ↓
人工律师审核
```

### 9.5 金融包示例工作流

参考 Anthropic financial-services 仓库的结构时，应提取其 agent、skill、connector 和安全隔离思想，但不要只复制 markdown workflow。

金融包可包含：

- Pitch Book Workflow。
- Earnings Review Workflow。
- GL Reconciliation Workflow。
- DCF / LBO / Comps Skill。
- Excel / PPT 模板。
- 数据源 connector。
- Deck QC / Model Audit validator。

金融包 workflow 必须显式定义 step、输入输出、权限、校验和人工审核节点。

---

## 10. Tool Package 与开源项目集成

### 10.1 原则

GitHub 上的开源项目不能直接下载后无限制执行。必须封装为受控 Tool Package。

```text
开源项目
 ↓
安全审查
 ↓
Docker 化
 ↓
声明入口函数
 ↓
声明输入输出 schema
 ↓
声明权限和资源限制
 ↓
接入 Tool Registry
```

### 10.2 Tool Manifest

```yaml
id: finance.openbb
version: 1.0.0
title: OpenBB 金融数据工具
source:
  type: github
  url: https://github.com/OpenBB-finance/OpenBB
  commit: abc123
  license: AGPL-3.0

runtime:
  type: docker
  image: operator/tools/openbb:1.0.0

entrypoints:
  - name: fetch_market_data
    command: python -m operator_tool.fetch_market_data
    input_schema: schemas/fetch_market_data.input.json
    output_schema: schemas/fetch_market_data.output.json

permissions:
  network:
    enabled: true
    allowlist:
      - api.example.com
  filesystem:
    read: input/
    write: output/
  shell: false

limits:
  timeout_seconds: 300
  memory_mb: 1024
  cpu: 1

artifacts:
  outputs:
    - type: csv
    - type: json
    - type: md

security_review:
  status: pending
  reviewed_by: null
  notes: []
```

### 10.3 License 风险

接入开源项目时必须记录 license。AGPL、GPL、商业限制类项目不能直接用于商业 SaaS，除非完成合规确认。

Tool Registry 中必须保存：

- 仓库 URL。
- commit hash。
- license。
- 安全审查状态。
- Docker image digest。
- 依赖列表。

---

## 11. Agent Runtime Adapter 设计

### 11.1 设计原则

Operator 不应把自然语言大任务直接丢给任何 Agent Runtime。

错误示例：

```text
请完成一次教师成绩分析并生成报告。
```

正确示例：

```json
{
  "task_id": "task_123",
  "step_id": "generate_charts",
  "task_type": "teacher_grade_analysis",
  "instruction": "根据 statistics.json 生成成绩分布图、均值对比图和达成度图。",
  "input_files": [
    "input/statistics.json"
  ],
  "output_contract": {
    "required_files": [
      "output/charts/score_distribution.png",
      "output/charts/attainment.png"
    ],
    "artifact_manifest": "output/artifact_manifest.json"
  },
  "allowed_tools": [
    "python",
    "filesystem"
  ],
  "forbidden_tools": [
    "network",
    "browser"
  ],
  "timeout_seconds": 180
}
```

Agent Runtime Adapter 是 Workflow Engine 和具体 Runtime 之间的边界。Workflow Engine 只传入当前 step 的结构化任务，不暴露完整业务路由权。

### 11.2 Runtime Task Contract

每个 runtime step 必须包含：

- `task_id`
- `workflow_run_id`
- `step_run_id`
- `runtime_provider`
- `instruction`
- `input_files`
- `output_contract`
- `skill_refs`
- `allowed_tools`
- `forbidden_tools`
- `sandbox_policy`
- `timeout_seconds`
- `cost_limit`

### 11.3 Runtime 返回格式

```json
{
  "status": "succeeded",
  "logs": [
    {
      "ts": "2026-06-04T12:00:00Z",
      "type": "tool_call",
      "message": "python generated charts"
    }
  ],
  "outputs": {
    "charts": [
      "output/charts/score_distribution.png",
      "output/charts/attainment.png"
    ]
  },
  "artifact_manifest": {
    "artifacts": [
      {
        "name": "score_distribution",
        "type": "png",
        "path": "output/charts/score_distribution.png",
        "size_bytes": 123456,
        "sha256": "..."
      }
    ]
  },
  "usage": {
    "runtime_seconds": 42,
    "tool_calls": 3,
    "tokens": 0
  }
}
```

### 11.4 OpenHands Runtime

OpenHands 是 MVP 的首选 Agent Runtime 实现。

职责：

- 接收 Operator 构造的 runtime task。
- 在 sandbox 中调用文件系统、Python、Shell、浏览器和工具。
- 根据 Skill 和 output_contract 生成产物。
- 返回 logs、outputs、artifact_manifest 和 usage。

OpenHands 不负责：

- 选择 workflow。
- 组合 workflow chain。
- 修改 Task Orchestrator 的执行计划。
- 突破 step 的 allowed_tools、forbidden_tools 和 sandbox_policy。

### 11.5 Sandbox 要求

每个 runtime step 使用独立 sandbox。

最低要求：

- 独立工作目录。
- 输入只读挂载。
- 输出目录可写。
- 默认禁用网络。
- 超时强制终止。
- 限制 CPU、内存、磁盘。
- 不向 sandbox 注入用户或系统 secret。
- 执行日志可追踪。

---

## 12. Artifact 系统

### 12.1 支持类型

MVP 支持：

```text
pdf
docx
pptx
xlsx
csv
json
png
md
zip
```

### 12.2 Artifact Manifest

每个执行 step 返回 artifact 时必须生成 manifest。

```json
{
  "version": "1.0",
  "workflow_run_id": "wr_123",
  "step_run_id": "sr_456",
  "artifacts": [
    {
      "artifact_id": "art_789",
      "name": "grade_analysis_report",
      "type": "docx",
      "path": "output/report.docx",
      "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "size_bytes": 238000,
      "sha256": "...",
      "metadata": {
        "pages": 8,
        "source": "generate_report"
      }
    }
  ]
}
```

### 12.3 Artifact 生命周期

```text
created
 ↓
stored
 ↓
available
```

失败状态：

```text
missing
corrupt
deleted
expired
```

### 12.4 存储策略

MVP：

- MinIO 存文件。
- PostgreSQL 存元数据。

后续：

- S3。
- CDN。
- 企业私有对象存储。

---

## 13. 数据库设计

### 13.1 核心表

MVP 最少需要：

```text
users
workspaces
projects
tasks
task_orchestration_plans
workflow_definitions
workflow_chains
workflow_runs
workflow_step_runs
skills
tool_packages
agent_packages
files
artifacts
runtime_invocations
model_invocations
billing_records
task_events
audit_logs
```

### 13.2 tasks

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID,
  user_id UUID NOT NULL,
  agent_package_id TEXT,
  workflow_id TEXT,
  workflow_version TEXT,
  orchestration_plan_id UUID,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 13.3 task_orchestration_plans

```sql
CREATE TABLE task_orchestration_plans (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id),
  workspace_id UUID NOT NULL,
  intent JSONB NOT NULL DEFAULT '{}',
  selected_workflows JSONB NOT NULL DEFAULT '[]',
  policy_decisions JSONB NOT NULL DEFAULT '{}',
  clarification_questions JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 13.4 workflow_chains

```sql
CREATE TABLE workflow_chains (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id),
  orchestration_plan_id UUID REFERENCES task_orchestration_plans(id),
  status TEXT NOT NULL,
  workflow_refs JSONB NOT NULL DEFAULT '[]',
  context JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 13.5 workflow_runs

```sql
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id),
  workflow_chain_id UUID REFERENCES workflow_chains(id),
  chain_index INT,
  workflow_id TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  status TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 13.6 workflow_step_runs

```sql
CREATE TABLE workflow_step_runs (
  id UUID PRIMARY KEY,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id),
  step_id TEXT NOT NULL,
  step_type TEXT NOT NULL,
  skill_id TEXT,
  skill_version TEXT,
  status TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  error JSONB,
  retry_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

### 13.7 artifacts

```sql
CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES tasks(id),
  workflow_run_id UUID REFERENCES workflow_runs(id),
  step_run_id UUID REFERENCES workflow_step_runs(id),
  name TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  mime_type TEXT,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT,
  sha256 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);
```

### 13.8 runtime_invocations

```sql
CREATE TABLE runtime_invocations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  task_id UUID,
  workflow_run_id UUID,
  step_run_id UUID,
  runtime_provider TEXT NOT NULL,
  runtime_task JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  usage JSONB NOT NULL DEFAULT '{}',
  error JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
```

### 13.9 model_invocations

```sql
CREATE TABLE model_invocations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  task_id UUID,
  workflow_run_id UUID,
  step_run_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6),
  latency_ms INT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
```

---

## 14. API 设计

### 14.1 Task API

```text
POST   /api/tasks
GET    /api/tasks/{task_id}
GET    /api/tasks/{task_id}/events
POST   /api/tasks/{task_id}/cancel
POST   /api/tasks/{task_id}/retry
```

创建 task：

```json
{
  "workspace_id": "ws_123",
  "project_id": "prj_123",
  "agent_package_id": "teacher",
  "workflow_id": "teacher.grade_analysis",
  "input": {
    "score_file_id": "file_123",
    "course_name": "Biology",
    "class_name": "Class 1"
  }
}
```

### 14.2 Task Orchestrator API

```text
POST   /api/tasks/{task_id}/orchestrate
GET    /api/tasks/{task_id}/orchestration-plan
POST   /api/tasks/{task_id}/clarifications
POST   /api/orchestrator/preview
```

`/api/orchestrator/preview` 用于在不执行任务的情况下返回 intent、候选 workflow、workflow chain 和 policy decisions，便于 UI 展示和人工确认。

### 14.3 Workflow API

```text
GET    /api/workflows
GET    /api/workflows/{workflow_id}
POST   /api/workflows/{workflow_id}/validate
GET    /api/workflow-chains/{chain_id}
POST   /api/workflow-runs
GET    /api/workflow-runs/{run_id}
GET    /api/workflow-runs/{run_id}/steps
```

### 14.4 Package API

```text
GET    /api/agent-packages
GET    /api/agent-packages/{package_id}
GET    /api/skills
GET    /api/tools
POST   /api/admin/packages/import
POST   /api/admin/packages/validate
```

### 14.5 Runtime API

```text
GET    /api/runtime-providers
GET    /api/runtime-invocations/{invocation_id}
POST   /api/admin/runtime-providers/{provider_id}/validate
```

Runtime API 只暴露配置、观测和管理员验证能力，不允许用户绕过 Workflow Engine 直接提交任意 runtime task。

### 14.6 Artifact API

```text
POST   /api/files/upload
GET    /api/artifacts/{artifact_id}
GET    /api/artifacts/{artifact_id}/download
GET    /api/tasks/{task_id}/artifacts
```

### 14.7 Billing API

```text
GET    /api/billing/usage
GET    /api/billing/tasks/{task_id}
GET    /api/admin/billing/costs
```

---

## 15. Model Gateway

### 15.1 目标

业务层不能直接调用厂商 SDK。所有模型调用必须经过 Model Gateway。

统一接口：

```python
class ModelGateway:
    def generate(self, request: ModelRequest) -> ModelResponse:
        ...
```

### 15.2 ModelRequest

```json
{
  "task_id": "task_123",
  "step_run_id": "step_123",
  "model_policy": {
    "preferred": "gpt-5.3",
    "fallback": ["claude-opus", "qwen-max"]
  },
  "messages": [],
  "temperature": 0.2,
  "max_output_tokens": 4000,
  "cost_limit_usd": 1.0
}
```

### 15.3 路由策略

MVP 支持：

- 指定模型。
- fallback 模型。
- 记录 token 和成本。

后续支持：

- 按任务类型路由。
- 按成本路由。
- 按延迟路由。
- 按质量评分路由。
- 企业自带模型。

---

## 16. 计费系统

### 16.1 MVP 必须记录

每个 task 和 step 必须记录：

- 用户。
- Workspace。
- 任务。
- Workflow。
- 模型。
- 输入 token。
- 输出 token。
- 执行耗时。
- 工具调用次数。
- Sandbox runtime。
- 成本估算。

### 16.2 计费粒度

MVP 支持：

- 免费额度。
- 按任务计费。
- 按 token 计费。
- 管理后台查看成本。

后续支持：

- 套餐订阅。
- 行业包单独定价。
- Skill Marketplace 分成。
- Tool Marketplace 分成。

---

## 17. 安全与权限

### 17.1 基础安全要求

- Workspace 隔离。
- Project 隔离。
- Task 独立执行目录。
- 文件访问权限校验。
- Artifact 下载鉴权。
- 管理接口独立权限。
- 所有执行日志可审计。

### 17.2 Sandbox 安全

默认策略：

```yaml
network: false
shell: false
browser: false
filesystem:
  input: read_only
  output: read_write
secrets:
  inject: false
limits:
  timeout_seconds: 300
  memory_mb: 1024
  disk_mb: 2048
```

只有 workflow step 明确声明时才能开启网络、浏览器或 shell。

### 17.3 高风险行业策略

法律、金融、医疗等行业默认启用：

- 人工审核节点。
- 引用来源要求。
- 禁止自动提交外部系统。
- 禁止自动发送邮件。
- 禁止自动执行交易、记账、签署、审批。
- 输出标记为待专业人士确认。

---

## 18. Human Review

MVP 可以先实现简单状态：

```text
waiting_for_human
approved
rejected
needs_revision
```

Human Review step 示例：

```yaml
- id: lawyer_review
  type: human_review_step
  title: 律师审核
  input:
    report: "{{ steps.generate_report.output.report }}"
  actions:
    - approve
    - reject
    - request_revision
```

对于法律和金融包，最终关键产物必须经过人工审核。

---

## 19. Observability 与审计

### 19.1 Task Events

所有任务事件写入 `task_events`。

事件类型：

```text
task.created
task.queued
workflow.started
step.started
step.succeeded
step.failed
artifact.created
model.called
human_review.requested
human_review.approved
workflow.succeeded
workflow.failed
```

### 19.2 日志要求

每个 step 应记录：

- 输入摘要。
- 输出摘要。
- 调用工具。
- 模型名称。
- token。
- 耗时。
- 错误。
- artifact 列表。

敏感数据不能直接写入明文日志。

### 19.3 审计日志

审计日志记录：

- 用户上传文件。
- 下载 artifact。
- 启动任务。
- 取消任务。
- 人工审核。
- 管理员导入 package。
- 修改模型和价格配置。

---

## 20. 测试与评测

### 20.1 单元测试

必须覆盖：

- Workspace registry 过滤。
- Task Orchestrator intent 解析和规则路由。
- Workflow Chain 计划生成。
- Workflow YAML 解析。
- Step input 解析。
- Skill manifest 解析。
- JSON schema 校验。
- Artifact manifest 校验。
- Model Gateway fallback。
- Billing 记录。

### 20.2 集成测试

必须覆盖：

- 创建 task 到 orchestration plan 生成。
- 单 workflow task 到 workflow 完成。
- workflow chain 中多个 workflow 顺序完成。
- tool_step 成功和失败。
- runtime_step / openhands_step mock 成功和失败。
- artifact 存储。
- step retry。
- task cancel。

### 20.3 行业包 Evals

每个行业包必须有 eval cases。

示例：

```text
teacher.grade_analysis
  - 正常成绩表
  - 缺失字段成绩表
  - 异常分数
  - 大文件

legal.contract_review
  - 标准 NDA
  - 缺失保密期限
  - 管辖地不明
  - 高风险赔偿条款
```

评测指标：

- 是否完成。
- 是否生成必需 artifact。
- schema 是否通过。
- 关键内容是否存在。
- 引用是否完整。
- 人工评分。

---

## 21. 推荐仓库结构

```text
operator/
  apps/
    web/
    api/

  packages/
    task-orchestrator/
    workflow-engine/
    runtime-adapter/
    model-gateway/
    artifact-service/
    openhands-adapter/
    package-registry/
    shared/

  agent-packages/
    teacher/
    research/
    legal/
    finance/
    design/

  tool-packages/
    pdf-parser/
    office-export/
    chart-generator/

  infra/
    docker-compose.yml
    nginx/
    minio/

  docs/
    specs/
    architecture/
    runbooks/
```

如果沿用当前 FastAPI + React 项目，可先采用：

```text
backend/operator_backend/
  task_orchestrator/
  workflow_engine/
  runtime_adapters/
  skill_registry/
  tool_registry/
  package_registry/
  openhands_adapter/
  artifact_service/
  model_gateway/
  billing/

frontend/src/
  pages/
  components/
  agentPackages/
  taskRuns/

docs/specs/
  operator_technical_development_spec_v1.zh.md
```

---

## 22. 开发里程碑

### M0：基础工程整理

目标：

- 明确目录结构。
- 明确配置方式。
- 建立本地 docker-compose。
- 建立数据库迁移。

验收：

- 本地可启动 API、Web、PostgreSQL、Redis、MinIO。
- 健康检查通过。

### M1：Task、File、Artifact 基础能力

目标：

- 用户上传文件。
- 创建 task。
- 存储 artifact。
- 查询 task 和 artifact。

验收：

- 上传文件后可创建 task。
- task 可关联输入文件。
- artifact 可下载。

### M2：极简 Workflow Engine

目标：

- 支持 YAML workflow。
- 支持 `tool_step`、`llm_step`、`validation_step`。
- 支持 step 状态和日志。

验收：

- 一个教师成绩分析 workflow 可执行到完成。
- 每一步状态可在 API 查询。

### M3：Task Orchestrator 与 Workflow Chain

目标：

- 实现 Workspace registry 过滤。
- 实现规则版 Task Orchestrator。
- 支持 intent 到 workflow 的路由。
- 支持简单顺序 Workflow Chain。
- 持久化 task_orchestration_plans。

验收：

- 用户创建 task 后，系统能生成 orchestration plan。
- 单任务可被路由到一个 workflow。
- 论文转答辩 PPT 加演讲稿一类任务可生成多个 workflow 的 chain。

### M4：Skill Registry

目标：

- 解析 `skill.yaml`。
- 校验输入输出 schema。
- 执行确定性脚本 skill。

验收：

- `teacher.parse_excel` 和 `teacher.score_statistics` 可作为 skill 注册并运行。

### M5：Agent Runtime Adapter 与 OpenHands Runtime

目标：

- 定义统一 runtime task contract。
- 构造结构化 OpenHands runtime task。
- 接收 artifact manifest。
- 写入 artifact service。
- 记录 runtime_invocations。

验收：

- OpenHands 可生成图表或 docx。
- 失败时可记录错误并终止 workflow。
- 不改 Workflow Engine 即可替换或新增 Runtime Adapter。

### M6：第一个完整行业包

目标：

- 完成 Teacher Agent 或 Research Agent。
- 至少 2 个 workflow。
- 至少 5 个 skill。
- 至少 5 个 eval case。

验收：

- 用户通过 Web 完成一个完整专业任务。
- 生成可下载 artifact。
- 后台可查看成本、日志、步骤状态。

### M7：计费、权限和审计

目标：

- 记录 token 和成本。
- Workspace 权限隔离。
- 基础 audit log。

验收：

- 可按 task 查看成本。
- 非授权用户不能访问其他 workspace artifact。

### M8：行业包扩展

目标：

- 接入第二个行业包。
- 建立 package import 和 validate。
- 建立 Marketplace 雏形。

验收：

- 不改核心代码即可注册新 agent package。

---

## 23. 后续演进

### 23.1 引入 LangGraph 的条件

出现以下需求时引入：

- 单个 step 内需要多轮循环推理。
- 多分支流程频繁变化。
- 多 Agent 协作。
- Human-in-the-loop checkpoint 复杂。
- 需要保存和恢复 agent state。

接入方式：

```yaml
- id: complex_legal_reasoning
  type: langgraph_step
  graph: legal.contract_reasoning_graph@1.0.0
```

LangGraph 可作为 Agent Runtime 或 step adapter，不替代 Task Orchestrator，也不替代 Operator 外层 workflow。

### 23.2 引入 Temporal 的条件

出现以下需求时引入：

- 任务运行数小时或数天。
- 需要强一致重试和恢复。
- 需要复杂定时器。
- 需要跨系统补偿。
- Queue + Worker 已不足够。

Temporal 作为可靠执行层，不替代行业 workflow 定义。

### 23.3 平台化阶段

目标：

- Agent Marketplace。
- Skill Marketplace。
- Tool Marketplace。
- 企业私有行业包。
- 第三方开发者生态。
- 行业包质量评分。
- 付费分成。

---

## 24. 非目标

MVP 明确不做：

- 通用 AGI Agent。
- 让 Agent 自己自由规划所有流程。
- 让 Agent Runtime 自己选择或组合业务 workflow。
- 直接执行未知 GitHub 仓库。
- 自动法律意见签署。
- 自动投资建议。
- 自动交易。
- 自动记账过账。
- 自动发送外部邮件。
- 复杂可视化流程编辑器。
- 微服务架构。

---

## 25. 开发原则总结

Operator 开发中必须坚持：

```text
Workspace 限定范围
Task Orchestrator 负责规划、路由、组合和边界
Workflow 决定步骤顺序、输入输出和依赖
Agent Runtime 决定 step 内怎么执行
Skill 描述能力和方法
Tool 提供底层动作
LLM 负责受约束的分类、规划、局部判断与表达
Validator 负责质量门禁
Artifact 承载最终交付和审计
Human Review 承接高风险决策
```

平台价值不在于“模型会聊天”，而在于：

```text
把行业专业工作变成可执行、可复用、可验证、可审计、可计费的智能体工作流。
```
