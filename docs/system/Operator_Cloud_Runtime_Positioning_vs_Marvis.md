# Operator 云端专业执行平台定位与 Marvis 对比

日期：2026-06-13

## 背景

Marvis（马维斯）是腾讯推出的操作系统层级 AI 助手。公开资料显示，它面向 Windows、macOS、Android 等终端系统，强调本地大模型、本地文件零上传模式、手机远程操控电脑、文件与图片智能搜索、系统设置修改、文档理解和格式转换等能力。

Operator 的定位不应与 Marvis 正面对打桌面 OS Agent，而应明确为云端 Linux 专业执行平台。Operator 主要运行在云端 Linux 环境中，依托 Linux 开源生态、GitHub skill/agent/workflow 供给、专业软件环境和可复现执行体系，为用户完成复杂专业任务并产出可验证 artifact。

一句话区分：

```text
Marvis = 个人电脑 OS Agent
Operator = 云端 Linux 专业技能 Agent 平台
```

参考资料：

- 腾讯 Marvis 官网：https://marvis.qq.com/
- 中国日报：腾讯上线操作系统层级 AI 助手 Marvis，支持跨端操控与本地隐私模式：https://cn.chinadaily.com.cn/a/202605/25/WS6a13a97da310942cc49adfc2.html
- 东方财富转载上观新闻：腾讯 Marvis 上线，操作系统级 AI 助手登场：https://finance.eastmoney.com/a/202605213744753525.html
- TechNode: Tencent unveils Mavis AI assistant that turns PCs into conversational interfaces：https://technode.com/2026/05/21/tencent-unveils-mavis-ai-assistant-that-turns-pcs-into-conversational-interfaces/

## 产品定位差异

| 维度 | Marvis | Operator |
| --- | --- | --- |
| 核心定位 | 个人电脑 OS 级 AI 助手 | 云端 Linux 专业技能 Agent 平台 |
| 运行环境 | Windows、macOS、Android、iOS 等终端生态 | 云端 Linux、容器、专业 runtime、GPU/CPU worker |
| 用户对象 | 普通 PC 用户、办公用户、新手、长辈、移动办公用户 | 专业任务用户、科研/教育/文档/CAD/生信/法律/开发等场景 |
| 主要能力 | 文件搜索、系统设置、应用操作、浏览器操作、跨端控制 | GitHub skill 接入、专业工具调用、云端执行、artifact 验证 |
| Agent 体系 | 出厂预置多 Agent 团队 | Scope catalog + skill manifests + OpenHands/Mastra 编排 |
| 安全重点 | 桌面敏感操作确认、本地隐私模式 | 沙箱隔离、runtime 权限、密钥隔离、开源依赖审查、artifact 审计 |
| 产出形态 | 直接操作用户电脑和文件 | 工作区、日志、artifact manifest、可下载产物、可复现运行记录 |

Marvis 的优势是贴近用户桌面。它把电脑系统、文件、应用、浏览器和跨端连接变成可对话对象，降低普通用户操作电脑的门槛。

Operator 的优势应放在专业云端执行能力。它不需要接管用户本机，而是提供一个已经准备好专业工具链、专业 Agent 和可验证产物机制的云端工作台。

## Operator 应坚持的方向

Operator 应成为：

```text
Cloud-native Linux Professional Agent Runtime
  + GitHub Skill Marketplace
  + Runtime Registry
  + Artifact Verification Platform
```

核心价值包括：

1. 利用 Linux 生态承载专业软件和命令行工具。
2. 从 GitHub 获取开源 skill、agent、workflow，并将其标准化接入。
3. 通过云端 worker 提供比用户本机更稳定、更专业、更可复现的执行环境。
4. 将 Agent 的完成声明转化为真实 artifact、日志、hash、大小、验证报告。
5. 通过 runtime 隔离、权限控制和审计机制降低运行陌生开源项目的风险。

典型任务包括：

- 生成可编辑 PPTX、HTML deck、PDF、DOCX、XLSX。
- 调用 CAD 工具生成 STEP、STL、DXF 和验证报告。
- 执行科研文献检索、综述、引用管理、实验数据分析。
- 运行生信、化学、材料、仿真、统计分析等专业 pipeline。
- 调用浏览器自动化、网页抓取、文件转换、代码生成和 CI 验证。

## GitHub Skill 接入模型

Operator 不应简单地把 GitHub 仓库 clone 下来直接交给 Agent 使用。更稳妥的流程是把开源 skill 转换为 Operator 可调度、可验证、可复现的能力。

推荐接入流程：

```text
Discover GitHub skill/agent/workflow
  -> 解析 README / SKILL.md / examples
  -> 生成或维护 skill manifest
  -> 识别依赖和专业软件
  -> 映射到已有 domain runtime 或触发 runtime build
  -> 编写 Operator adapter
  -> 定义 output contract
  -> 运行 smoke test / benchmark
  -> 生成 scope card
  -> 发布到 Operator scope catalog
```

Skill 分级建议：

| 等级 | 含义 |
| --- | --- |
| Raw | 仅发现并索引，尚不可稳定执行 |
| Integrated | 已有 manifest 和 adapter，可在开发环境试跑 |
| Verified | 通过安装、smoke test 和 artifact contract 验证 |
| Production | 通过 benchmark、权限策略、稳定性测试和安全审查 |
| Private | 用户或组织私有 skill，独立权限和密钥边界 |

## Runtime 设计原则

Operator 不应把所有软件安装到一个巨大环境里。正确方向是根据 skill、agent 和专业领域隔离 runtime，同时避免用户请求时反复安装依赖。

关键原则：

```text
不要：一个超级 Ubuntu，装满所有专业软件
不要：每次用户请求现场 pip/npm/apt install
应该：预构建多个可复用、可验证、按需启动的 runtime
```

推荐 runtime 分层：

```text
Base Runtime
  通用 Linux、用户、目录、安全策略、基础 shell 工具

Language Runtime
  Python、Node、pnpm、uv、conda/mamba、JDK、Rust、Go 等

Domain Runtime
  文档/PPT、CAD、生信、科研数据分析、浏览器自动化、LaTeX、GPU 推理等

Skill Runtime
  具体 skill 的固定 commit、少量特殊依赖、adapter、smoke test metadata
```

任务执行流程：

```text
User request
  -> scope selection
  -> skill / agent selection
  -> runtime resolver
  -> choose image or cached runtime
  -> start isolated worker
  -> mount workspace
  -> execute tool calls
  -> verify artifacts
  -> write logs and manifest
```

依赖安装应发生在 skill 接入或 runtime 构建阶段，而不是用户任务执行阶段。只有以下情况才允许触发构建：

- 新 skill 第一次接入平台。
- runtime 版本升级。
- 依赖 lock/hash 发生变化。
- 管理员触发 rebuild。
- 低优先级后台构建任务。

## 预构建 Runtime 与存储占用

预构建不同 runtime image 会带来重复依赖和空间占用风险。如果每个 skill 都做完整大镜像，磁盘会快速膨胀。因此 Operator 应采用分层复用和 thin overlay。

推荐镜像层次：

```text
operator/base-ubuntu
  Linux 基础、用户、目录、通用安全配置

operator/base-python-node
  Python、Node、pnpm、uv、常用构建工具

operator/runtime-doc
  LibreOffice、Pandoc、字体、PDF 工具、Playwright

operator/runtime-cad
  OCCT、FreeCAD/build123d、渲染工具、STEP 检查工具

operator/runtime-bio
  conda/mamba、samtools、blast、常用生信工具

operator/skill-gorden-ppt
  GordenPPTSkill 固定 commit、adapter、少量特殊依赖

operator/skill-text-to-cad
  text-to-cad 固定 commit、adapter、少量特殊依赖
```

同一底层 layer 在容器镜像系统中按内容寻址存储，不会被完整重复保存。多个 PPT 或文档 skill 可以共享 `operator/runtime-doc`；多个 CAD skill 可以共享 `operator/runtime-cad`。

存储控制策略：

1. 按领域构建 domain runtime，不为每个 skill 构建完整大环境。
2. skill 层保持薄，只放 skill repo、adapter、少量特殊依赖和 metadata。
3. runtime key 使用 digest/hash 生成，依赖完全相同时复用同一个 runtime。
4. 构建阶段使用 Docker BuildKit cache、uv/pip wheel cache、pnpm store、conda package cache。
5. 大模型、参考数据库、索引库不要塞进每个镜像，改用共享 volume 或对象存储挂载。
6. 定期 GC，清理 failed build、旧 digest、长期未使用 runtime 和孤儿缓存。

建议 runtime key 包含：

```text
base image digest
apt package lock
python lock
node lock
conda lock
skill repo commit
adapter version
runtime build script version
```

## 控制面与执行面

Operator 应逐步拆出清晰的控制面和执行面。

```text
Operator Control Plane
  - users / tasks / runs
  - scope catalog
  - skill registry
  - runtime registry
  - scheduler
  - artifact index
  - audit logs

Operator Execution Plane
  - isolated workers
  - prebuilt runtime images
  - warm worker pools
  - workspace mount
  - tool execution
  - artifact verification

Storage Layer
  - Postgres for metadata
  - object storage for artifacts
  - registry/cache for runtime images
  - shared volumes for models and datasets
```

热门 runtime 可以保持 warm worker，普通 runtime 只预拉镜像并按需启动，冷门 runtime 保留在 registry 中按需拉取。这样既避免用户请求时现场安装依赖，又控制常驻成本。

## 与当前 Operator 架构的关系

当前 Operator 已经具备这条路线的雏形：

- `apps/web`：前端工作台和 API route。
- `apps/mastra`：执行范围选择、OpenHands 调用、skill 执行编排。
- `apps/mastra/src/product-scopes/`：用户可选 scope 目录和路由元数据。
- `apps/mastra/src/skills/registry.ts`：skill catalog 和 resolved skill。
- `packages/core/src/capabilities/skills.ts`：skill manifest、runtime resolution、adapter resolution。
- `tmp/runs/...`：任务 workspace 和 artifact 输出。
- `artifact_manifest.json`：产物索引和验证基础。

后续需要加强：

1. Runtime registry：记录镜像、版本、scope 标签、依赖 hash、健康状态。
2. Runtime builder：后台构建 runtime，并运行 smoke test。
3. Scheduler：根据 skill 选择 worker、CPU/GPU、内存、网络策略和安全等级。
4. Artifact UI：展示执行计划、日志、产物、验证证据和下载入口。
5. Skill onboarding pipeline：自动发现、解析、接入、测试、发布 GitHub skill。
6. Security policy：网络权限、密钥隔离、文件权限、危险命令拦截、许可证扫描。

## 结论

Operator 的合理路线不是复制 Marvis 的桌面 OS Agent，而是利用云端 Linux、开源生态和专业 runtime，构建一个可扩展的专业 Agent 执行平台。

最终目标：

```text
用户不需要本机安装复杂专业软件。
用户只需要描述任务。
Operator 在云端选择专业 skill 和 runtime。
Agent 调用专业工具完成任务。
系统产出真实 artifact、日志、hash、验证报告。
任务可以复现、审计、共享和持续改进。
```

这条路线与 Marvis 互补。Marvis 解决普通用户如何操作自己的电脑；Operator 解决用户如何获得云端专业执行能力和可验证复杂产物。
