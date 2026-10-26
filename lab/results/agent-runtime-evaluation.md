# Operator 通用 Agent Runtime 评估报告

生成时间：2026-06-14

## 结论

开源界有成熟的 web/search/browser 组件，但没有一个完全等价 Claude Code/Codex、可直接替换 Operator 当前 runtime 的开源一体化方案。更合理的设计是：Operator 做 runtime harness 和产物协议，底层 runtime 可插拔，web/search/browser 能力通过 MCP + CLI 组合提供。

第一轮实测支持这个判断：

- Codex CLI 基线可无交互完成文件任务和 web 当前信息任务。
- Playwright MCP、Tavily MCP、Exa MCP、Brave Search MCP、Firecrawl MCP、Browserbase MCP 都能被 MCP 客户端发现工具 schema。
- `mcp-server-fetch` 能实际抓取网页并返回 Markdown。
- Playwright MCP 能实际打开 `https://example.com` 并返回 accessibility snapshot。
- OpenCode/Gemini CLI/mini-swe-agent/browser-use/Crawl4AI/GPT Researcher/Terminal-Bench/DeepAgents CLI 均可安装或启动 smoke；Cline npm 包存在但当前环境 CLI smoke 未通过。

## 关键实测结果

### Codex 基线

见 `runtime-smoke.json`。

| 任务 | 结果 | 耗时 |
| --- | --- | ---: |
| 创建 `agent-smoke.txt` | 成功，内容为 `runtime-ok` | 20.2s |
| 查找 Microsoft Playwright MCP GitHub URL 并写入文件 | 成功，且 Codex 事件中出现 `web_search` | 40.2s |

Codex 的关键差异不是“模型更聪明”这一点本身，而是 runtime 给了它完整闭环：web search、shell、文件写入、检查与最终响应都在同一 harness 中。

### MCP Web/Browser 组件发现

见 `mcp-tool-discovery.json`。

| 组件 | 工具数量 | 代表工具 |
| --- | ---: | --- |
| Playwright MCP | 23 | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot` |
| MCP Fetch | 1 | `fetch` |
| Tavily MCP | 5 | `tavily_search`, `tavily_extract`, `tavily_crawl`, `tavily_map`, `tavily_research` |
| Exa MCP | 2 | `web_search_exa`, `web_fetch_exa` |
| Brave Search MCP | 8 | `brave_web_search`, `brave_news_search`, `brave_llm_context` |
| Firecrawl MCP | 20 | `firecrawl_search`, `firecrawl_scrape`, `firecrawl_crawl`, `firecrawl_agent` |
| Browserbase MCP | 6 | `navigate`, `act`, `observe`, `extract` |

### 组件实际调用

见 `component-smoke.json`。

- `mcp-server-fetch` 成功抓取 `https://example.com`，返回 Markdown。
- Playwright MCP 成功无头打开 `https://example.com`，返回页面 title、URL 和 snapshot。

这说明 Operator 不需要从零实现 fetch/browser 工具，直接集成现成 MCP/CLI 组件即可。

### Runtime CLI Smoke

见 `runtime-smoke.json`。

| Runtime / 组件 | Smoke 结果 | 备注 |
| --- | --- | --- |
| Codex CLI | 通过 | 可作为基线 |
| Gemini CLI | 通过 | README 声明内置 Google Search grounding、web fetch、shell、文件、MCP |
| OpenCode | 通过 | CLI 可启动，内置 fetch/bash/MCP；需要进一步做真实任务测试 |
| Cline | 未通过 | npm 元数据存在，但当前 `npx`/`npm exec` 找不到可执行 `cline` |
| Aider | 未通过 | Python 3.13 环境缺 `pyaudioop`，可用固定 Python 版本重测 |
| mini-swe-agent | 通过 | 适合作为轻量 agent/harness 参考 |
| browser-use | 通过 | 适合浏览器自动化 CLI/skill 组件 |
| Crawl4AI | 通过 | 适合抓取/清洗/Markdown/结构化抽取 |
| GPT Researcher | 通过 | 适合 deep research 专项 agent，不适合作为通用 coding runtime |
| Terminal-Bench | 通过 | 适合作为后续 benchmark |
| DeepAgents CLI | 通过 | 值得进一步测试 LangGraph/DeepAgents runtime 能力 |

## 已下载的 Benchmark

已下载 Terminal-Bench 到 `lab/vendor/terminal-bench`，当前 commit：`1a6ffa9`。

本轮没有跑完整 Terminal-Bench，因为它需要选择 agent adapter、镜像/环境和较长执行时间。当前先使用 `micro-benchmark-manifest.json` 定义 Operator 自己的快测任务，用 Codex 建立基线。

## 推荐的 Operator Runtime 设计

### 1. Runtime 和能力组件分层

不要把 web/search/browser/download 能力写死进某一个 runtime。建议拆成：

- `AgentRuntime`：Codex CLI、Gemini CLI、OpenCode、OpenHands、Claude Code+CCR、mini-swe-agent 等适配器。
- `ToolProvider`：MCP/CLI 工具包，例如 search、fetch、browser、download、artifact。
- `TaskHarness`：工作区、事件流、并发、取消、resume、artifact 扫描、结果验收。

Runtime 只负责思考和调用工具；Operator harness 负责“任务是否真的完成”。

### 2. 默认 Web 工具包

建议默认挂载：

- Fetch：`mcp-server-fetch`，零 API key，解决已知 URL 抓取。
- Browser：`@playwright/mcp`，零 API key，解决动态网页、点击、截图、页面状态。
- Search：优先 Tavily 或 Exa；Brave 作为通用搜索备选。
- Scrape/Crawl：Firecrawl 或 Crawl4AI。
- Browser agent 可选：browser-use 或 Browserbase。

这些工具均应同时提供：

- MCP 形式：给支持 MCP 的 runtime 使用。
- CLI 形式：给 shell-first 的 coding agent 使用，减少大 schema 上下文消耗。

### 3. Artifact 和下载必须由 Harness 验收

失败案例的根因之一是 agent “说完成”但没有产物。Operator 应对任务类型增加验收：

- 下载任务：文件存在、非零大小、content-type/扩展名合理、sha256 可记录。
- 报告任务：Markdown/PDF/DOCX 落盘并登记 artifact。
- web 任务：回答中包含来源 URL；如果要求下载，必须有 artifact。

前端只展示 final response 不够，必须展示 workspace artifact。

### 4. Runtime 选型建议

当前优先级：

1. Codex CLI：作为质量基线和 benchmark oracle。
2. Gemini CLI：最值得测试的开源 runtime 候选，因为原生 web/search/fetch/MCP 比较完整。
3. OpenCode：轻量、CLI-first、支持 fetch/bash/MCP，适合嵌入式 runtime 候选。
4. Claude Code+CCR：工具 loop 成熟，但 CCR/Agnes 路径缺少原生 web search，需要 MCP/CLI 工具补齐。
5. OpenHands：保留为可选 runtime，但不要继续把它当唯一主 runtime；当前 Operator 接入路径没有形成 Codex 式完整闭环。

### 5. 下一轮测试

建议新增 `lab/scripts/run-runtime-adapter-bench.mjs`，对以下 runtime 跑同一组 micro tasks：

- Codex CLI
- Gemini CLI
- OpenCode
- Claude Code+CCR
- OpenHands Agent Server
- mini-swe-agent

任务集：

- 文件精确写入
- 当前网页搜索并引用来源
- 已知 URL 下载 PDF 并校验 sha256
- 未知 URL 检索下载：例如找一个公开 PDF，并登记 artifact
- 动态网页：Playwright 打开页面并提取标题

只有 runtime 通过这些任务，才适合作为 Operator 默认通用 agent runtime。
