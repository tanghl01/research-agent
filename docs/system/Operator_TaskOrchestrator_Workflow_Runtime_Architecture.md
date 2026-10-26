# Operator 三层执行架构设计（任务编排器 - 工作流 - 智能体 Runtime）

> 状态说明：本文是 Operator 后期 Task Orchestrator/Workflow/Runtime 分层参考文档，从历史版本恢复保留。当前仓库代码的 MVP 实现以 `Operator_Mastra_First_MVP_Positioning.md` 为准；若两者冲突，先按 Mastra-first MVP 文档执行。

## 核心思想

Operator 采用：

用户
→ Task Orchestrator
→ Workflow
→ Agent Runtime
→ Skill
→ Tool
→ Artifact

核心原则：

- Task Orchestrator 负责规划
- Workflow 负责顺序
- Agent Runtime 负责执行
- Skill 负责能力
- Tool 负责动作
- Artifact 负责交付

---

## 第一层：Task Orchestrator

Task Orchestrator 是受约束的智能编排器。

职责：

- 理解用户需求
- 选择工作流
- 组合多个工作流
- 判断是否需要追问
- 判断是否需要进入 Runtime
- 管理执行边界

内部结构：

- Intent Analyzer
- Workflow Router
- Workflow Composer
- Planner LLM
- Policy Guard
- State Manager

LLM 仅负责：

- 分类
- 规划
- 路由
- 组合

不负责：

- 执行代码
- 浏览器操作
- 文件修改

---

## Workspace 的作用

Workspace 不是 Agent。

Workspace = Scope + Registry + State + UI

例如：

- Teacher Workspace
- Research Workspace
- PPT Workspace
- Legal Workspace

作用：

缩小搜索范围，仅开放对应领域的 Workflow 和 Skill。

---

## 第二层：Workflow

Workflow 定义步骤顺序。

例如：

上传成绩表
→ 统计分析
→ 图表生成
→ 达成度计算
→ 报告生成

Workflow 决定：

- 步骤
- 输入输出
- 依赖关系

Workflow 不决定：

- 如何完成步骤

---

## Workflow Chain

多个 Workflow 可以组合。

例如：

paper_summary
→ research_defense_ppt
→ speech_script

形成 Workflow Chain。

---

## 第三层：Agent Runtime

Agent Runtime 是业界标准意义上的 Agent。

例如：

- OpenHands Runtime
- Claude Runtime
- OpenAI Runtime

组成：

LLM + Tool Calling + Memory + Planner + Executor + Feedback Loop

职责：

- 思考
- 行动
- 观察
- 修正
- 循环执行

---

## Runtime 与 Workflow 的关系

Workflow：

决定做什么。

Runtime：

决定怎么做。

例如：

Workflow：
统计成绩

Runtime：
读取 Excel
生成 Python
运行分析
生成图表

---

## Skill Layer

Skill 是能力单元。

例如：

- excel-analysis
- ppt-generation
- citation-search
- contract-review

Skill 不等于 Agent。

Runtime 负责调用 Skill。

---

## Tool Layer

Tool 是底层执行能力。

例如：

- Python
- Browser
- Shell
- PowerPoint
- Word

Skill 调用 Tool。

Runtime 调用 Skill。

---

## Artifact Layer

Artifact 是最终交付物。

例如：

- docx
- pptx
- pdf
- xlsx
- png

Artifact 是平台核心资产。

---

## 执行流程示例

用户：

帮我把论文做成答辩 PPT 并生成演讲稿。

执行过程：

Task Orchestrator
→ Workflow Composer
→ paper_summary
→ research_defense_ppt
→ speech_script
→ OpenHands Runtime
→ Skill
→ Tool
→ PPT
→ 演讲稿

---

## 最终架构

Workspace
↓
Task Orchestrator
↓
Workflow
↓
Agent Runtime
↓
Skill
↓
Tool
↓
Artifact
