# Claude Code 开发规范入口

本仓库的强制开发规范以根目录 `AGENTS.md` 为准。Claude Code 在进行任何代码修改、修复、重构、提交前，必须先读取并遵守 `AGENTS.md`。

核心要求：

- 不打临时补丁，不硬编码 taskId、手机号、runId、路径或状态值。
- 每个 bug 必须定位根因，并从全局标准化角度修复同类问题。
- 成熟框架已有能力时必须优先使用：Mastra、ACP、Next.js、React、Postgres/Drizzle、S3-compatible storage、BullMQ、AG-UI、assistant-ui、Vercel AI SDK、Zod、OpenAPI/AsyncAPI、OpenTelemetry 等。
- MVP 第一批工具取舍以 `AGENTS.md` 的“最低自研、成熟工具优先、大型平台暂缓”规则为准，不默认引入 Temporal、Inngest、OpenFGA 或 Langfuse 平台本体。
- 算子平台只自研产品语义和业务控制面，并保持框架无关、接口适配、可迁移。
- Agent 生命周期必须先定义为算子产品级状态机，再通过 adapter 映射到 Mastra/ACP。
- runtime 产生终态后，必须先写终态和 terminal event，再执行 artifact 注册、assistant message、链接改写等后置步骤。

详细说明见 `docs/DEVELOPMENT_STANDARD.md`。
