import playwright from "../../apps/web/node_modules/@playwright/test/index.js";

const { chromium } = playwright;

const baseUrl = process.env.OPERATOR_CAPTURE_URL ?? "http://127.0.0.1:3003";
const outDir = new URL("./assets/", import.meta.url);

const skillCatalog = [
  {
    id: "gorden-ppt-skill",
    kind: "skill",
    displayName: "GordenPPT",
    description: "生成可编辑 PowerPoint 文件",
    keywords: ["pptx", "slides"],
    outputFormat: "pptx",
    available: true
  },
  {
    id: "guizang-ppt-skill",
    kind: "skill",
    displayName: "GuizangPPT",
    description: "生成单文件 HTML 演示稿",
    keywords: ["html", "slides"],
    outputFormat: "html",
    available: true
  },
  {
    id: "ppt-master",
    kind: "skill",
    displayName: "PPT大师",
    description: "SVG-first 的高视觉密度 PPTX 生成",
    keywords: ["ppt", "slides"],
    outputFormat: "pptx",
    available: true
  },
  {
    id: "scientific-agent-skills",
    kind: "skill",
    displayName: "科研助手",
    description: "覆盖文献综述、数据分析和科研写作",
    keywords: ["scientific", "research", "科研"],
    outputFormat: "research",
    available: true
  },
  {
    id: "text-to-cad",
    kind: "skill",
    displayName: "文本转 CAD",
    description: "从文字或图纸生成并校验工程 CAD 产物",
    keywords: ["cad", "engineering"],
    outputFormat: "cad",
    available: true
  },
  {
    id: "claude-for-legal",
    kind: "skill",
    displayName: "法律助手",
    description: "处理合同、隐私合规和法律工作流草稿",
    keywords: ["legal", "law"],
    outputFormat: "legal",
    available: true
  }
];

function stream(chunks) {
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("");
}

async function installRoutes(page) {
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: false, publicConfigured: false, serviceConfigured: false },
        authenticated: false,
        user: null,
        bootstrapAvailable: false,
        error: null
      })
    })
  );
  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        source: "local",
        tasks: [
          {
            id: "demo-seed-pitch",
            title: "种子期路演 PPT",
            createdAt: "2026-06-18T09:00:00.000Z",
            updatedAt: "2026-06-18T09:20:00.000Z"
          }
        ]
      })
    })
  );
  await page.route("**/api/operator/task-messages?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: [] })
    })
  );
  await page.route("**/api/operator/scopes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "1.0",
        catalog: { agents: [], skills: skillCatalog, workflows: [], tools: [] }
      })
    })
  );
  await page.route("**/api/operator/chat?**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1"
      },
      body: stream([
        {
          type: "data-operator-event",
          data: {
            type: "RUN_STARTED",
            threadId: "home",
            runId: "demo-run",
            timestamp: "2026-06-18T09:20:00.000Z"
          }
        },
        {
          type: "data-operator-event",
          data: {
            type: "CUSTOM",
            threadId: "home",
            runId: "demo-run",
            timestamp: "2026-06-18T09:20:01.000Z",
            name: "operator.selected_skills",
            value: [{ skill: "gorden-ppt-skill", status: "selected" }]
          }
        },
        {
          type: "data-operator-event",
          data: {
            type: "STEP_STARTED",
            threadId: "home",
            runId: "demo-run",
            timestamp: "2026-06-18T09:20:02.000Z",
            stepName: "artifact_build"
          }
        },
        { type: "text-start", id: "demo-text" },
        {
          type: "text-delta",
          id: "demo-text",
          delta:
            "已根据创业大赛场景生成路演稿：\n\n- 7 分钟节奏\n- 可编辑 PPTX\n- 含产品截图与技术架构\n\n下载：[operator_seed_pitch.pptx](runs/gorden-ppt-skill/output/operator_seed_pitch.pptx)"
        },
        { type: "text-end", id: "demo-text" }
      ])
    })
  );
}

async function snap(page, name) {
  await page.screenshot({ path: new URL(name, outDir).pathname, fullPage: false });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await installRoutes(page);

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForSelector(".composer-input");
await page.addStyleTag({
  content: `
    .history-heading,
    .task-list {
      display: none !important;
    }
    .history-block::before {
      content: "内测任务历史";
      display: block;
      margin-top: 16px;
      color: #64748b;
      font-size: 12px;
    }
    .history-block::after {
      content: "种子期路演 PPT\\A 专业工作流 Demo\\A Skill 接入测试";
      white-space: pre-line;
      display: grid;
      gap: 10px;
      margin-top: 14px;
      color: #25324a;
      font-size: 13px;
      line-height: 2.6;
    }
  `
});
await snap(page, "demo-frame-01-home.png");

await page.getByRole("button", { name: "办公" }).click();
await page.waitForTimeout(350);
await snap(page, "demo-frame-02-presentation-skills.png");

await page.locator('[data-scope-id="gorden-ppt-skill"]').click({ force: true });
await page.waitForTimeout(250);
await snap(page, "demo-frame-03-skill-selected.png");

await page.locator(".thread-frame.active .composer-input").fill("为 Operator 生成一份 7 分钟创业大赛路演 PPT");
await page.waitForTimeout(250);
await snap(page, "demo-frame-04-prompt-ready.png");

await page.getByLabel("发送任务").click();
await page.waitForTimeout(1000);
await snap(page, "demo-frame-05-result.png");

await browser.close();
