# Operator 专业 AI 工作流开源项目调研

调研日期：2026-06-10

本文整理一批不是通用工作流平台、而是已经在科研、论文、代码审阅、法律、专利、CAD、硬件设计等专业场景中使用 AI 进行开发、撰写、设计、审阅或验证的开源项目。目标是判断哪些项目的内容、代码、SOP、工具调用方式和校验逻辑可以被改造进 Operator。

## 核心结论

通用 AI workflow 平台中的大量低复杂度流程已经被 coding agent、agent skills 和更强的多模态模型商品化。仅仅把 Dify、Coze、n8n、ComfyUI 里的节点链路搬进 Operator，价值有限。

Operator 更应该吸收的是专业领域中沉淀下来的 SOP、工具链、schema、validator 和 human-in-the-loop 审批点。也就是说：

- workflow 负责确定性边界、状态、审计、复现、验收和人工闸门。
- coding agent 负责不确定性推理、资料检索、代码修改、实验执行、错误修复和迭代。
- skill 负责把专业知识、领域工具、操作细节和风格约束注入 agent。

因此，真正值得注册进 Operator 的不是“通用 AI 流程模板”，而是“专业任务协议”。

## 筛选标准

本次调研优先选择满足以下条件的项目：

- 不是通用 workflow 平台或 agent 框架本身。
- 有明确专业任务闭环，例如实验、论文、专利、代码审阅、CAD、RTL、法律审阅。
- 能产出专业产物，例如论文草稿、研究报告、PR review、CAD 脚本、Verilog、合同红线、专利文档。
- 有可迁移的 SOP、prompt/skill、工具调用、数据结构或校验逻辑。
- 可以与 coding agent 融合，而不是只作为独立聊天机器人。

低优先级项目包括：

- 普通 RAG 问答。
- 普通 deep research demo。
- 普通多 agent 聊天或角色扮演。
- 单纯图像生成或 3D 生成模型，除非它们带有专业设计校验流程。
- 缺少源码质量、专业约束或验收机制的小型壳应用。

## 高优先级候选

| 方向 | 项目 | GitHub 热度 | 开源协议 | Operator 改造价值 |
|---|---:|---:|---|---|
| 科研 skills | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 27.8k stars | MIT | 大量科学技能和数据库连接，适合拆成 `science.*` workflow 和 skill 包。 |
| 科研/工程 skills | [Orchestra-Research/AI-Research-SKILLs](https://github.com/Orchestra-Research/AI-Research-SKILLs) | 9.5k stars | MIT | 面向 Claude Code、Codex、Gemini 等 coding agent，和 Operator skill 方向高度一致。 |
| 端到端科研 workflow | [SamuelSchmidgall/AgentLaboratory](https://github.com/SamuelSchmidgall/AgentLaboratory) | 5.7k stars | MIT | 覆盖文献、实验、代码、报告，适合改造成 `research.experiment_report`。 |
| 科学发现 | [SakanaAI/AI-Scientist](https://github.com/SakanaAI/AI-Scientist) | 13.9k stars | 未声明 | 提供 ideation、实验执行、论文写作的研究型流程，适合借鉴模板和阶段划分。 |
| 科学发现 v2 | [SakanaAI/AI-Scientist-v2](https://github.com/SakanaAI/AI-Scientist-v2) | 6.5k stars | 未声明 | 有 agentic tree search 思路，适合借鉴研究假设搜索和 novelty 检查。 |
| 知识综述 | [stanford-oval/storm](https://github.com/stanford-oval/storm) | 28.3k stars | MIT | 适合改造成带引用的深度调研、综述和证据表 workflow。 |
| 科学文献 QA | [Future-House/paper-qa](https://github.com/Future-House/paper-qa) | 8.7k stars | Apache-2.0 | 高质量科学文档 RAG，可作为论文审阅、引用校验和证据检索工具层。 |
| 生物医学 agent | [snap-stanford/Biomni](https://github.com/snap-stanford/Biomni) | 3.2k stars | Apache-2.0 | 专业性强，适合 biomedical workflow，但必须加入人工复核和安全边界。 |
| 科学工具层 | [mims-harvard/ToolUniverse](https://github.com/mims-harvard/ToolUniverse) | 1.4k stars | Apache-2.0 | 可作为科学任务工具调用层，适合和 Operator validator/artifact 体系结合。 |
| 化学 agent | [ur-whitelab/chemcrow-public](https://github.com/ur-whitelab/chemcrow-public) | 922 stars | MIT | 有化学工具链和专业操作思路，可抽象为 `chemistry.*` workflow。 |
| PR 审阅 | [The-PR-Agent/pr-agent](https://github.com/The-PR-Agent/pr-agent) | 11.5k stars | Apache-2.0 | PR 描述、review、改进建议和风险检查很适合工作流化。 |
| issue 修复 | [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | 19.5k stars | MIT | 可封装为 `software.issue_fix`，但它更像执行 runtime，需要 Operator 做外围约束。 |
| 安全审计 | [GitHubSecurityLab/seclab-taskflows](https://github.com/GitHubSecurityLab/seclab-taskflows) | 72 stars | MIT | stars 不高，但方向正确：安全 taskflow 比普通 code review 更有专业价值。 |
| 安全 agent | [GitHubSecurityLab/seclab-taskflow-agent](https://github.com/GitHubSecurityLab/seclab-taskflow-agent) | 205 stars | MIT | 可借鉴任务流执行模型和漏洞扫描流程。 |
| CAD/硬件 skills | [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) | 5.9k stars | MIT | CAD、robotics、hardware design skills 集合，非常适合作为 Operator 设计类 workflow 素材。 |
| 法律 workflow | [anthropics/claude-for-legal](https://github.com/anthropics/claude-for-legal) | 8.2k stars | Apache-2.0 | 法律插件和 workflow 素材质量高，可借鉴结构、guardrail 和审阅流程。 |

## 中优先级候选

这些项目有较强专业价值，但更适合作为某个步骤的工具、模型或参考实现，而不是直接作为完整 Operator workflow。

| 方向 | 项目 | GitHub 热度 | 开源协议 | 改造判断 |
|---|---:|---:|---|---|
| open deep research | [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) | 11.7k stars | MIT | 可以借鉴 research plan 和检索流程，但容易变成通用 deep research。 |
| 深度研究 agent | [Alibaba-NLP/DeepResearch](https://github.com/Alibaba-NLP/DeepResearch) | 19.3k stars | Apache-2.0 | 工程质量和热度不错，但需要收敛到专业场景。 |
| 科研创新 | [HKUDS/AI-Researcher](https://github.com/HKUDS/AI-Researcher) | 5.4k stars | 未声明 | 有研究 idea、实验和写作流程，需进一步审查源码和 license。 |
| 论文/科学写作 | [K-Dense-AI/claude-scientific-writer](https://github.com/K-Dense-AI/claude-scientific-writer) | 1.9k stars | MIT | 可拆成 scientific writing skill，但需要补引用和事实校验。 |
| ML/CV/NLP 论文写作 | [Master-cai/Research-Paper-Writing-Skills](https://github.com/Master-cai/Research-Paper-Writing-Skills) | 3.6k stars | MIT | 适合做论文写作风格和章节 SOP，不宜自动生成最终论文。 |
| 学术研究助手 | [Galaxy-Dawn/claude-scholar](https://github.com/Galaxy-Dawn/claude-scholar) | 4.3k stars | MIT | 有跨 CLI agent 支持，可作为研究 assistant workflow 参考。 |
| AI peer review | [poldrack/ai-peer-review](https://github.com/poldrack/ai-peer-review) | 144 stars | 未声明 | 适合借鉴 meta-review 结构，但需要谨慎处理学术伦理。 |
| CAD 生成 | [SadilKhan/Text2CAD](https://github.com/SadilKhan/Text2CAD) | 429 stars | 未声明 | NeurIPS 2024 Spotlight，适合作为 CAD 生成工具层。 |
| Blender CAD 脚本 | [FreedomIntelligence/BlenderLLM](https://github.com/FreedomIntelligence/BlenderLLM) | 251 stars | Apache-2.0 | 可作为设计图/3D 脚本生成工具，不是完整 workflow。 |
| CAD 编程库 | [CadQuery/cadquery](https://github.com/CadQuery/cadquery) | 5.3k stars | 未声明 | 不是 AI 项目，但可作为 Operator CAD workflow 的确定性工具。 |
| CAD 编程库 | [gumyr/build123d](https://github.com/gumyr/build123d) | 2.4k stars | Apache-2.0 | 同上，适合做可验证 CAD 输出。 |
| IFC/BIM 工具 | [IfcOpenShell/IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell) | 2.6k stars | LGPL-3.0 | 建筑/施工图方向需要它这类确定性工具，但 AI SOP 仍需自研。 |
| RTL 生成 | [stable-lab/MAGE](https://github.com/stable-lab/MAGE) | 121 stars | MIT | 多 agent RTL 生成，专业价值高但成熟度需验证。 |
| RTL 生成 | [hkust-zhiyao/RTL-Coder](https://github.com/hkust-zhiyao/RTL-Coder) | 300 stars | 未声明 | 可作为 RTL code generation 参考。 |
| Verilog 生成 | [NVlabs/VerilogCoder](https://github.com/NVlabs/VerilogCoder) | 163 stars | Apache-2.0 | 可作为芯片设计工具层参考。 |
| Verilog 修复 | [NVlabs/RTLFixer](https://github.com/NVlabs/RTLFixer) | 51 stars | MIT | 适合做 RTL 语法修复步骤。 |
| Verilog benchmark | [NVlabs/verilog-eval](https://github.com/NVlabs/verilog-eval) | 439 stars | 未声明 | 可作为 RTL workflow 的 evaluation/validator 参考。 |
| 法律合同 skill | [evolsb/claude-legal-skill](https://github.com/evolsb/claude-legal-skill) | 317 stars | MIT | 合同风险检测和 redline workflow 有参考价值。 |
| 专利生成 | [RobThePCGuy/Claude-Patent-Creator](https://github.com/RobThePCGuy/Claude-Patent-Creator) | 136 stars | MIT | 有 USPTO/MPEP/RAG/合规检查思路，但必须 human-in-the-loop。 |
| 专利 agent | [QiYao-Wang/AutoPatent](https://github.com/QiYao-Wang/AutoPatent) | 206 stars | 未声明 | 论文型项目，可参考 multi-agent patent generation 流程。 |
| 本地专利套件 | [erdalbektas/OpenPatent](https://github.com/erdalbektas/OpenPatent) | 24 stars | 未声明 | 早期项目，方向对但成熟度低。 |

## 不建议优先改造的类型

以下类型短期内不建议作为 Operator 主线：

1. 通用 workflow 平台模板

   Dify、Coze、n8n、Flowise、Langflow 等平台本身仍有企业集成价值，但它们的普通 LLM 节点链路不应作为 Operator 的核心资产。

2. 纯 agent runtime

   Aider、OpenHands、Plandex、SWE-agent 等更像执行环境或 coding agent。Operator 可以调用它们，但不应把它们整体改造成 workflow。

3. 普通生图/3D 生成

   直出模型已经能覆盖大量普通设计需求。只有当图像、CAD 或 3D 生成进入专业设计 SOP，并带有参数、约束、校验和修改闭环时，才值得注册进 Operator。

4. 建筑/施工图 AI 项目

   当前开源生态中，建筑/施工图方向缺少成熟的 AI 审图闭环。可用的更多是 OCCT、IfcOpenShell、CadQuery 这类确定性工具。AI SOP 需要 Operator 自研。

## 推荐的 Operator 改造模式

### 1. Skill-first

优先导入专业 skill 库，而不是导入完整应用。

适合项目：

- `scientific-agent-skills`
- `AI-Research-SKILLs`
- `text-to-cad`
- `claude-for-legal`
- `Research-Paper-Writing-Skills`

Operator 应抽取：

- `SKILL.md` 或等价说明。
- 专业术语、步骤和限制。
- 外部数据库、命令行工具和 MCP/API。
- 输入输出 schema。
- 人工复核点。

### 2. Workflow skeleton

对 AgentLaboratory、AI-Scientist、PR-Agent 这类有完整流程的项目，抽取 workflow skeleton，而不是照搬代码。

示例：

```text
research.idea
  -> novelty_check
  -> literature_review
  -> experiment_plan
  -> implementation
  -> run_experiment
  -> analyze_results
  -> write_report
  -> human_review
```

### 3. Tool adapter

对 PaperQA、CadQuery、build123d、IfcOpenShell、RTLFixer、VerilogEval 这类工具型项目，做成 Operator tool adapter。

示例：

```text
workflow step
  -> calls deterministic tool
  -> writes artifact
  -> validator checks artifact
  -> agent reads failure and iterates
```

### 4. Validator-first

专业 workflow 的关键不是“能生成”，而是“能验收”。

推荐每个 Operator workflow 都定义：

- `artifact_manifest.json`
- `validation_report.json`
- 结构化 trace
- 可执行 test/lint/check
- human approval gate

## 建议第一批落地的 Operator workflow

### `research.literature_review`

候选来源：

- STORM
- PaperQA
- scientific-agent-skills
- AI-Research-SKILLs

产物：

- 主题分解
- 文献检索策略
- 引用证据表
- 综述草稿
- 事实/引用一致性报告

核心 validators：

- 每个关键结论必须绑定 citation。
- 引用必须能回溯到原文片段。
- 明确区分事实、推断和作者观点。

### `research.experiment_report`

候选来源：

- AgentLaboratory
- AI-Scientist
- AI-Scientist-v2
- ToolUniverse

产物：

- research idea
- novelty check
- 实验计划
- 代码仓库或 notebook
- 实验结果
- 研究报告

核心 validators：

- 实验代码可运行。
- 结果文件存在且进入 artifact manifest。
- 报告中的指标能回溯到原始结果。
- 关键决策需要 human approval。

### `software.pr_review`

候选来源：

- PR-Agent
- GitHub Security Lab taskflows
- Gito
- ai-review

产物：

- PR 摘要
- 风险列表
- inline review comment 草稿
- 安全/兼容性/测试缺口报告

核心 validators：

- finding 必须引用文件和行号。
- finding 必须说明可复现风险或行为回归。
- 低置信度建议不能作为阻塞项。

### `design.text_to_cad`

候选来源：

- text-to-cad
- CadQuery
- build123d
- BlenderLLM
- Text2CAD

产物：

- 设计需求 schema
- 参数化 CAD 脚本
- 预览图
- 几何/尺寸校验报告

核心 validators：

- CAD 脚本可执行。
- 输出模型存在。
- 关键尺寸和约束被显式检查。

### `ip.patent_draft`

候选来源：

- Claude-Patent-Creator
- AutoPatent
- OpenPatent
- PQAI
- claude-for-legal

产物：

- 发明交底书
- prior art 搜索摘要
- novelty/obviousness 风险清单
- claim tree
- specification draft
- drawing brief

核心 validators：

- 所有 claim 术语在说明书中有支持。
- prior art 结论必须绑定来源。
- 最终文档必须经过 human legal review。

注意：该方向风险高，不能自动提交、自动申请或替代专利代理人。

### `hardware.rtl_design_review`

候选来源：

- MAGE
- RTL-Coder
- VerilogCoder
- RTLFixer
- VerilogEval

产物：

- RTL 设计说明
- Verilog/SystemVerilog 源码
- testbench
- lint/simulation report
- 修复 trace

核心 validators：

- 代码可编译。
- testbench 可运行。
- lint/simulation 报告进入 artifact manifest。
- agent 修改必须保留 diff 和失败原因。

## 短期执行建议

第一阶段不要大规模 vendoring。建议先做一个 `professional-workflow-candidates` 目录或 registry，把每个候选项目登记为结构化对象：

```json
{
  "workflow_id": "research.literature_review",
  "source_projects": ["stanford-oval/storm", "Future-House/paper-qa"],
  "domain": "research",
  "artifacts": ["evidence_table", "literature_review", "citation_report"],
  "validators": ["citation_traceability", "claim_source_alignment"],
  "human_gates": ["final_claims_review"]
}
```

第二阶段选择 2 到 3 个项目做深度拆解：

1. `research.literature_review`
2. `software.pr_review`
3. `design.text_to_cad`

第三阶段再接入高风险高价值方向：

- `ip.patent_draft`
- `biomed.research_assistant`
- `hardware.rtl_design_review`

## License 和合规注意事项

很多高价值项目使用 MIT 或 Apache-2.0，适合借鉴和集成。但也有不少项目 GitHub API 显示 `NOASSERTION` 或未声明 license。Operator 不应直接复制未明确授权的源码。

建议策略：

- 对 MIT/Apache-2.0 项目，可以优先研究源码并按 license 保留 attribution。
- 对未声明 license 项目，只借鉴公开论文思想、流程结构和接口思路，不直接复制代码。
- 对法律、专利、生物医学、实验设计等高风险领域，必须保留 human-in-the-loop 和免责声明。
- 对专业数据库、论文、专利和法律文本，额外检查数据源授权和使用条款。

## 最终判断

Operator 的长期价值不在于成为另一个 workflow 平台，也不在于收集一堆通用 agent demo。

更有价值的路线是：

```text
professional SOP
  + coding agent
  + domain skills
  + deterministic tools
  + artifact manifest
  + executable validators
  + human approval gates
```

按这个标准看，科研、论文、代码审阅、CAD/硬件、法律/专利、生物医学方向已经有足够开源素材可以启动。但每个方向都应该先抽象成 Operator-native workflow，再决定是否 vendoring 上游代码。
