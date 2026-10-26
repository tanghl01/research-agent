# Operator 专业智能体平台总体架构设计（MVP→平台化演进版）

> 状态说明：本文是 Operator 后期平台化/生产化演进参考文档，从历史版本恢复保留。当前仓库代码的 MVP 实现以 `Operator_Mastra_First_MVP_Positioning.md` 为准；若两者冲突，先按 Mastra-first MVP 文档执行。

## 1. 项目定位

Operator（算子）定位为面向科研人员、教师、律师、会计师、投行分析师、设计师等专业工作者的智能体平台。

核心理念：

```text
Task Orchestrator
+
Workflow
+
Agent Runtime
+
Skill / Tool / Artifact
```

目标不是做聊天机器人，而是构建真正能够完成专业工作的 Agent 平台。

---

## 2. 总体架构

```text
用户
 ↓
Operator Web / 微信 / 企业入口
 ↓
Operator API
 ↓
Workspace
 ↓
Task Orchestrator
 ↓
Workflow / Workflow Chain
 ↓
Agent Runtime
 ↓
Skill
 ↓
Tool
 ↓
Artifact
```

职责划分：

### Operator

负责：

- 用户系统
- 项目系统
- Agent市场
- Workflow管理
- Artifact管理
- 计费系统
- 权限系统
- 多模型管理

### Workspace

Workspace 不是 Agent，而是：

```text
Scope + Registry + State + UI
```

负责：

- 限定用户当前任务所在行业或场景。
- 缩小可用 Workflow、Skill、Tool 和模板范围。
- 保存任务上下文、项目状态和领域配置。
- 给 Task Orchestrator 提供可选能力边界。

例如：

- Teacher Workspace
- Research Workspace
- PPT Workspace
- Legal Workspace

### Task Orchestrator

Task Orchestrator 是受约束的智能编排器。

负责：

- 理解用户需求。
- 判断是否需要追问。
- 选择单个 Workflow。
- 组合多个 Workflow 形成 Workflow Chain。
- 决定是否进入 Agent Runtime。
- 管理任务执行边界和策略。

内部结构：

- Intent Analyzer
- Workflow Router
- Workflow Composer
- Planner LLM
- Policy Guard
- State Manager

Task Orchestrator 中的 LLM 只负责分类、规划、路由和组合，不负责执行代码、浏览器操作或文件修改。

### Workflow

Workflow 负责定义步骤顺序、输入输出和依赖关系。

它决定：

- 做哪些步骤。
- 每一步输入来自哪里。
- 每一步输出写到哪里。
- 失败、重试、校验和人工审核如何处理。

它不决定：

- 具体如何完成某一步。
- Runtime 内部如何思考、行动和修正。

多个 Workflow 可以由 Task Orchestrator 组合为 Workflow Chain，例如：

```text
paper_summary
 ↓
research_defense_ppt
 ↓
speech_script
```

### Agent Runtime

Agent Runtime 是真正执行复杂步骤的智能体运行时。

可选实现：

- OpenHands Runtime
- Claude Runtime
- OpenAI Runtime
- 后续自研 Runtime

组成：

```text
LLM + Tool Calling + Memory + Planner + Executor + Feedback Loop
```

Runtime 负责：

- 在单个 workflow step 边界内思考、行动、观察、修正。
- 调用 Skill 和 Tool。
- 在受控 sandbox 中完成文件处理、浏览器、Shell、Python、Office 等动作。
- 返回结构化日志、输出和 artifact manifest。

Runtime 不负责选择业务 Workflow，也不负责决定行业任务路由。

### Skill

Skill 是能力单元，不是 Agent。

负责：

- 描述某一步怎么做。
- 提供 prompt、脚本、模板、规则、参考知识。
- 声明输入 schema、输出 schema、产物类型和质量检查。

Runtime 调用 Skill。Skill 不决定整体流程。

### Tool

Tool 是底层动作能力。

例如：

- Python
- Browser
- Shell
- PowerPoint
- Word
- 数据库或第三方 API connector

Tool 必须通过平台注册、权限声明和安全审查后才能被 Runtime 或 Skill 调用。

### Artifact

Artifact 是最终交付物，也是平台核心资产。

例如：

- docx
- pptx
- pdf
- xlsx
- png
- md
- zip

所有 Artifact 必须统一登记元数据、来源 step、文件 hash、大小、类型和下载权限。

### OpenHands

负责：

- Shell执行
- Browser执行
- Python执行
- 文件处理
- 工具调用
- 沙箱隔离

OpenHands 在三层架构中是 Agent Runtime 的一个实现，不是 Operator 的流程控制器。

---

## 3. MVP阶段技术路线

### 不引入 LangGraph

MVP阶段使用轻量三层内核：

```text
Task Orchestrator：先实现 task_type / workspace 规则路由，保留 Planner LLM 接口
Workflow：使用 YAML 顺序 step
Agent Runtime：优先接入 OpenHands，保留 Runtime Adapter 抽象
```

Workflow step 类型：

```text
llm_step
tool_step
openhands_step
validation_step
```

即可支撑：

- 教师Agent
- 科研Agent
- PPT Agent
- 文档Agent

### 后续阶段

当出现以下需求时再引入LangGraph：

- 多分支流程
- 长任务恢复
- 多Agent协作
- Human-in-the-loop
- Checkpoint

---

## 4. 工作流设计原则

采用：

```text
主干写死
分支可配置
局部自主
```

### 示例

教师成绩分析：

```text
上传成绩表
 ↓
统计分析
 ↓
生成图表
 ↓
撰写分析
 ↓
导出报告
```

固定主干由 Workflow 声明。

Task Orchestrator 只负责把用户需求路由到该 Workflow。统计、图表、报告生成等具体执行由对应 step 的 Tool、LLM 或 Agent Runtime 完成。

---

## 5. 行业智能体结构

行业Agent不是Prompt。

定义：

```text
行业Agent
=
Workspace
+
Task Orchestrator 策略
+
Workflow / Workflow Chain
+
Skill包
+
知识库
+
工具链
+
模板
+
质量检查
```

目录结构：

```text
TeacherAgent/

├─ workflows/
├─ skills/
├─ tools/
├─ prompts/
├─ templates/
├─ knowledge/
├─ policies/
└─ evals/
```

---

## 6. Skill包设计

Skill包包含：

```text
Prompt
脚本
模板
工具
知识文档
规则
测试样例
```

例如：

```text
skills/

├─ parse_excel.py
├─ score_statistics.py
├─ attainment_analysis.py
└─ generate_docx.py
```

---

## 7. Agent Runtime协作模式

不是：

```text
Agent Runtime 自己找 Workflow 和 Skill
```

而是：

```text
Task Orchestrator 选择或组合 Workflow
 ↓
Workflow Engine 执行 Step
 ↓
Operator 为 Runtime 构造结构化 Step Task
 ↓
Agent Runtime 调用 Skill 和 Tool 执行
 ↓
返回Artifact
```

即：

```text
Task Orchestrator 负责规划、路由、组合和边界管理
Workflow 负责顺序
Agent Runtime 负责 step 内执行
```

OpenHands 是 MVP 优先采用的 Agent Runtime 实现。

---

## 8. 仓库结构

采用Monorepo。

```text
operator/

├─ apps/
│  ├─ web/
│  └─ api/
│
├─ packages/
│  ├─ workflows/
│  ├─ agents/
│  ├─ skills/
│  ├─ openhands-adapter/
│  └─ shared/
│
├─ infra/
└─ docs/
```

---

## 9. MVP部署架构

```text
服务器

├─ Nginx
├─ Operator Web
├─ Operator API
├─ PostgreSQL
├─ Redis
├─ MinIO
├─ OpenHands
└─ Docker Sandbox
```

---

## 10. Operator API模块划分

```text
operator-api

├─ auth
├─ user
├─ workspace
├─ project
├─ workflow
├─ task
├─ agent
├─ skill
├─ artifact
├─ billing
├─ model
├─ openhands
└─ admin
```

全部属于一个服务。

不拆微服务。

---

## 11. 数据库核心表

```text
users

workspaces

projects

tasks

workflow_runs

workflow_steps

files

artifacts

billing_records

user_quotas
```

---

## 12. Artifact系统

所有产物统一管理。

支持：

```text
pdf
docx
pptx
xlsx
png
md
zip
```

存储：

```text
MinIO
S3
```

数据库保存元数据。

---

## 13. 多模型管理

统一模型接口：

```python
model.generate()
```

后端动态路由：

```text
GPT
Claude
Qwen
DeepSeek
Gemini
```

避免业务层直接调用厂商SDK。

---

## 14. 计费系统

第一版即建设。

记录：

```text
用户
任务
模型
Token
耗时
成本
```

支持：

- 免费额度
- 任务计费
- Token计费
- 套餐订阅

---

## 15. 平台演进路线

### 第一阶段

```text
Operator API
+
Task Orchestrator（规则路由版）
+
Workflow Engine
+
OpenHands
```

目标：

教师Agent
科研Agent
PPT Agent

### 第二阶段

加入：

```text
Worker
Queue
Runtime Adapter 扩展
Workflow Chain
```

支持复杂工作流。

### 第三阶段

形成：

```text
Agent Marketplace
Skill Marketplace
Workflow Marketplace
```

---

## 16. 开源组件选型结论

### 采用

```text
OpenHands
PostgreSQL
Redis
MinIO
Docker
```

### 后续考虑

```text
LangGraph
Temporal
Kubernetes
```

### 不建议MVP引入

```text
微服务
复杂消息总线
多套数据库
```

---

## 17. 最终架构结论

```text
Operator Platform
    ↓
Workspace
    ↓
Task Orchestrator
    ↓
Workflow Engine
    ↓
Agent Runtime
    ↓
Skill Package
    ↓
Tool Package
    ↓
Artifact
```

职责：

```text
Operator
负责业务产品化

Task Orchestrator
负责规划、路由、组合和边界管理

Workflow
负责顺序

Agent Runtime
负责执行、观察、修正和循环

Skill
负责方法

Tool
负责动作

LLM
负责分类、规划、局部判断与表达

Artifact
负责交付和审计
```

最终目标：

构建面向专业工作者的 Agent OS 与 Agent Marketplace。
