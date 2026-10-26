import { listUserScopeSelectionCatalog } from "@operator/contracts";
import { expect, type Page, test } from "@playwright/test";
import { groupScopes, type ScopeCatalog, type ScopeItem } from "../lib/scopes";

const scopeCatalog = listUserScopeSelectionCatalog() as ScopeCatalog;
const scopeGroups = groupScopes(scopeCatalog);
const officeGroupScopes = scopeGroups.find((group) => group.id === "office")?.items ?? [];
const educationGroupScopes = scopeGroups.find((group) => group.id === "education")?.items ?? [];
const researchGroupScopes = scopeGroups.find((group) => group.id === "research")?.items ?? [];
const designGroupScopes = scopeGroups.find((group) => group.id === "design")?.items ?? [];
const enabledScopeEntries = scopeGroups
  .flatMap((group) => group.items.map((item) => ({ group, item })))
  .filter(({ item }) => isEnabledScope(item));

test("submits a prompt through the frontend composer and renders a response", async ({ page }) => {
  await page.route("**/api/operator/chat?**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1"
      },
      body: uiMessageStream([
        { type: "text-start", id: "mock-text" },
        {
          type: "text-delta",
          id: "mock-text",
          delta:
            "CI_FRONTEND_CHAT_OK\n\n公式：$a^2+b^2=c^2$\n\nLaTeX 小括号：\\(F=ma\\)\n\nLaTeX 方括号：\\[E_k=\\frac12mv^2\\]\n\n```python\nprint('rsa demo')\n```"
        },
        { type: "text-end", id: "mock-text" }
      ])
    })
  );

  const chatResponse = page.waitForResponse(
    (response) => response.url().includes("/api/operator/chat") && response.request().method() === "POST"
  );

  await page.goto("/");
  await page.getByPlaceholder("输入任务需求").fill("随便回复一句话");
  await page.getByLabel("发送任务").click();

  await expect(page.locator(".user-message .message-bubble").filter({ hasText: "随便回复一句话" })).toBeVisible();
  await expect(page.getByText("CI_FRONTEND_CHAT_OK")).toBeVisible();
  await expect(page.locator(".katex").filter({ hasText: "a" }).first()).toBeVisible();
  await expect(page.locator(".katex").filter({ hasText: "F" }).first()).toBeVisible();
  await expect(page.locator(".katex").filter({ hasText: "E" }).first()).toBeVisible();
  await expect(page.locator(".code-block code")).toContainText("rsa demo");
  await expect(page.getByText("运行 ID：")).toHaveCount(0);
  await expect((await chatResponse).status()).toBe(200);
});

test("does not duplicate the submitted prompt when persisted history catches up", async ({ page }) => {
  const prompt = "生成单文件 HTML 横向演示稿《企业知识库智能体》";
  let messageRequests = 0;

  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ source: "server", tasks: [] })
    })
  );
  await page.route("**/api/operator/task-messages?**", (route) => {
    messageRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        source: "server",
        messages: [
          {
            id: "persisted-user-message",
            role: "user",
            content: prompt
          }
        ]
      })
    });
  });
  await page.route("**/api/operator/task-detail?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "task_duplicate_prompt",
        exists: true,
        latestRun: {
          runId: "web_duplicate_prompt",
          status: "running",
          output: {}
        },
        messages: [
          {
            id: "persisted-user-message",
            taskId: "task_duplicate_prompt",
            conversationId: "task_duplicate_prompt",
            role: "user",
            content: prompt,
            createdAt: new Date(0).toISOString(),
            metadata: {}
          }
        ],
        agUiEvents: [],
        productEvents: [],
        artifacts: []
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
      body: uiMessageStream([
        { type: "text-start", id: "mock-duplicate" },
        { type: "text-delta", id: "mock-duplicate", delta: "DUPLICATE_PROMPT_OK" },
        { type: "text-end", id: "mock-duplicate" }
      ])
    })
  );

  await page.goto("/");
  await page.getByPlaceholder("输入任务需求").fill(prompt);
  await page.getByLabel("发送任务").click();
  await expect.poll(() => messageRequests).toBeGreaterThan(0);
  await expect(page.locator(".thread-frame.active .user-message .message-bubble").filter({ hasText: prompt })).toHaveCount(1);
  await expect(page.locator(".thread-frame.active").getByText("DUPLICATE_PROMPT_OK")).toBeVisible();
});

test("recovers a completed task from task status events when the live stream stalls", async ({ page }) => {
  let releaseChat: () => void = () => undefined;
  const chatGate = new Promise<void>((resolve) => {
    releaseChat = resolve;
  });
  let messageRequests = 0;
  let detailRequests = 0;

  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ source: "local", tasks: [] })
    })
  );
  await page.route("**/api/operator/task-messages?**", (route) => {
    messageRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: [] })
    });
  });
  await page.route("**/api/operator/task-detail?**", (route) => {
    detailRequests += 1;
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "task_event_recovery",
        exists: true,
        latestRun: {
          runId: "web_mock",
          status: "succeeded",
          finishedAt: new Date().toISOString(),
          output: {}
        },
        messages: [
          {
            id: "user-recovery",
            taskId: "task_event_recovery",
            conversationId: "task_event_recovery",
            role: "user",
            content: "需要自动恢复最终状态",
            createdAt: new Date(0).toISOString(),
            metadata: {}
          },
          {
            id: "assistant-recovery",
            taskId: "task_event_recovery",
            conversationId: "task_event_recovery",
            runId: "web_mock",
            role: "assistant",
            content: "RECOVERED_FINAL_STATUS",
            createdAt: new Date(0).toISOString(),
            metadata: {}
          }
        ],
        agUiEvents: [],
        productEvents: [],
        artifacts: []
      })
    });
  });
  await page.route("**/api/operator/task-events?**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache"
      },
      body: [
        "event: ag-ui-event",
        `data: ${JSON.stringify({
          type: "RUN_FINISHED",
          threadId: "task_event_recovery",
          runId: "web_mock",
          timestamp: Date.now(),
          outcome: { type: "success" }
        })}`,
        "",
        ""
      ].join("\n")
    })
  );
  await page.route("**/api/operator/chat?**", async (route) => {
    await chatGate;
    await route.abort("aborted");
  });

  await page.goto("/tasks/task_event_recovery");
  await expect
    .poll(() => detailRequests, {
      timeout: 10_000
    })
    .toBeGreaterThan(0);
  await page.getByPlaceholder("输入任务需求").fill("需要自动恢复最终状态");
  await expect(page.getByLabel("发送任务")).toBeEnabled();
  await page.getByLabel("发送任务").click();

  await expect(page.locator(".thread-frame.active").getByText("RECOVERED_FINAL_STATUS")).toBeVisible({
    timeout: 12_000
  });
  expect(messageRequests).toBeGreaterThan(0);
  expect(detailRequests).toBeGreaterThan(0);
  releaseChat();
});

test("reconciles the final answer after the chat stream ends without a task status event", async ({ page }) => {
  let chatCompleted = false;
  let messageRequests = 0;
  let detailRequests = 0;

  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ source: "local", tasks: [] })
    })
  );
  await page.route("**/api/operator/task-messages?**", (route) => {
    messageRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: [] })
    });
  });
  await page.route("**/api/operator/task-detail?**", (route) => {
    detailRequests += 1;
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "task_stream_reconcile",
        exists: true,
        latestRun: chatCompleted
          ? {
              runId: "web_stream_reconcile",
              status: "succeeded",
              finishedAt: new Date().toISOString(),
              output: {}
            }
          : {
              runId: "web_stream_reconcile",
              status: "running",
              output: {}
            },
        messages: chatCompleted
          ? [
              {
                id: "user-stream",
                taskId: "task_stream_reconcile",
                conversationId: "task_stream_reconcile",
                role: "user",
                content: "需要流结束后自动显示",
                createdAt: new Date(0).toISOString(),
                metadata: {}
              },
              {
                id: "assistant-stream",
                taskId: "task_stream_reconcile",
                conversationId: "task_stream_reconcile",
                runId: "web_stream_reconcile",
                role: "assistant",
                content: "RECOVERED_AFTER_STREAM_END",
                createdAt: new Date(0).toISOString(),
                metadata: {}
              }
            ]
          : [],
        agUiEvents: [],
        productEvents: [],
        artifacts: []
      })
    });
  });
  await page.route("**/api/operator/task-events?**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache"
      },
      body: ": connected\n\n"
    })
  );
  await page.route("**/api/operator/chat?**", (route) => {
    chatCompleted = true;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1"
      },
      body: uiMessageStream([
        {
          type: "data-ag-ui-event",
          data: {
            type: "RUN_STARTED",
            threadId: "task_stream_reconcile",
            runId: "web_stream_reconcile",
            timestamp: Date.parse("2026-06-15T14:30:00.000Z")
          }
        }
      ])
    });
  });

  await page.goto("/tasks/task_stream_reconcile");
  await page.getByPlaceholder("输入任务需求").fill("需要流结束后自动显示");
  await page.getByLabel("发送任务").click();

  await expect(page.locator(".thread-frame.active").getByText("RECOVERED_AFTER_STREAM_END")).toBeVisible({
    timeout: 12_000
  });
  expect(messageRequests).toBeGreaterThan(0);
  expect(detailRequests).toBeGreaterThan(0);
});

test("restores persisted running agent events after leaving and returning to a task", async ({ page }) => {
  const runningEvents = [
    {
      type: "RUN_STARTED",
      threadId: "task_restore_running",
      runId: "web_restore_running",
      timestamp: Date.parse("2026-06-15T14:30:00.000Z")
    },
    {
      type: "CUSTOM",
      timestamp: Date.parse("2026-06-15T14:30:01.000Z"),
      name: "operator.agent_trace",
      value: {
        kind: "action",
        label: "Agent tool call",
        detail: "Web search: running lifecycle"
      }
    },
    {
      type: "ACTIVITY_SNAPSHOT",
      timestamp: Date.parse("2026-06-15T14:30:02.000Z"),
      messageId: "web_restore_running:activity:progress",
      activityType: "operator.progress",
      replace: true,
      content: {
        threadId: "task_restore_running",
        runId: "web_restore_running",
        startedAt: Date.parse("2026-06-15T14:30:00.000Z"),
        elapsedMs: 2000,
        label: "Agent 正在执行",
        detail: "等待实时输出或最终结果"
      }
    }
  ];

  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        authenticated: true,
        user: {
          id: "user-restore-running",
          email: null,
          phone: "+8613800138000",
          displayName: "+8613800138000",
          avatarUrl: null,
          isGuest: false
        },
        bootstrapAvailable: true,
        error: null
      })
    })
  );
  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        source: "server",
        tasks: [
          {
            id: "task_restore_running",
            title: "恢复运行中任务",
            createdAt: "2026-06-15T14:30:00.000Z",
            updatedAt: "2026-06-15T14:30:02.000Z"
          }
        ]
      })
    })
  );
  await page.route("**/api/operator/task-messages?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "上一轮任务" },
          { role: "assistant", content: "上一轮已经完成" },
          { role: "user", content: "恢复运行中任务" }
        ]
      })
    })
  );
  await page.route("**/api/operator/task-detail?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "task_restore_running",
        exists: true,
        request: {
          run_id: "web_restore_running",
          messages: [
            { role: "user", content: "上一轮任务" },
            { role: "assistant", content: "上一轮已经完成" },
            { role: "user", content: "恢复运行中任务" }
          ]
        },
        plan: {
          phase: "running",
          trace: []
        },
        events: runningEvents,
        artifacts: []
      })
    })
  );
  await page.route("**/api/operator/task-events?**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache"
      },
      body: ": connected\n\n"
    })
  );

  await page.goto("/tasks/task_restore_running");
  await expect(page.locator(".thread-frame.active").getByText("开始执行任务")).toBeVisible();
  await expect(page.locator(".thread-frame.active").getByText("Agent 调用工具")).toBeVisible();

  await page.goto("/account?tab=settings");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.goto("/tasks/task_restore_running");

  await expect(page.locator(".thread-frame.active").getByText("恢复运行中任务")).toBeVisible();
  await expect(page.locator(".thread-frame.active").getByText("开始执行任务")).toBeVisible();
  await expect(page.locator(".thread-frame.active").getByText("Agent 调用工具")).toBeVisible();
});

test("agent status chips are arranged left to right and capped at three rows", async ({ page }) => {
  await page.route("**/api/operator/task-messages?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: [] })
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
      body: uiMessageStream([
        {
          type: "data-ag-ui-event",
          data: {
            type: "RUN_STARTED",
            threadId: "home",
            runId: "web_status_layout",
            timestamp: Date.parse("2026-06-15T14:30:00.000Z")
          }
        },
        {
          type: "data-ag-ui-event",
          data: {
            type: "CUSTOM",
            timestamp: Date.parse("2026-06-15T14:30:01.000Z"),
            name: "operator.agent_trace",
            value: {
              kind: "action",
              label: "Main agent attempt",
              detail: "codex-acp (Codex ACP)"
            }
          }
        },
        {
          type: "data-ag-ui-event",
          data: {
            type: "STEP_STARTED",
            timestamp: Date.parse("2026-06-15T14:30:02.000Z"),
            stepName: "acp_main_agent"
          }
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          type: "data-ag-ui-event" as const,
          data: {
            type: "CUSTOM" as const,
            timestamp: Date.parse(`2026-06-15T14:30:${String(index + 3).padStart(2, "0")}.000Z`),
            name: "operator.agent_trace",
            value: {
              kind: index % 2 ? "observation" : "action",
              label: index % 2 ? "Agent output" : "Agent tool call",
              detail: `Web search: {"type":"webSearch","id":"ws_status_layout_${index}","query":"long progress detail should not expand the status panel"}`
            }
          }
        })),
        { type: "text-start", id: "mock-status-layout" },
        { type: "text-delta", id: "mock-status-layout", delta: "STATUS_LAYOUT_OK" },
        { type: "text-end", id: "mock-status-layout" }
      ])
    })
  );

  await page.goto("/");
  await page.getByPlaceholder("输入任务需求").fill("检查状态横排");
  await page.getByLabel("发送任务").click();

  const statusPanel = page.locator(".thread-frame.active .agent-event-panel").first();
  const chips = statusPanel.locator(".agent-event");
  await expect(chips).toHaveCount(13);
  await expect(page.getByText("STATUS_LAYOUT_OK")).toBeVisible();

  const boxes = await chips.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    })
  );
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  const panelMetrics = await statusPanel.evaluate((panel) => ({
    height: panel.getBoundingClientRect().height,
    scrollHeight: panel.scrollHeight
  }));
  expect(panelMetrics.height).toBeLessThanOrEqual(106);
  expect(panelMetrics.scrollHeight).toBeGreaterThan(panelMetrics.height);
});

test("homepage default agent and every enabled scope tag can respond through the composer", async ({ page }) => {
  const chatUrls: string[] = [];
  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ tasks: [] })
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
        catalog: scopeCatalog
      })
    })
  );
  await page.route("**/api/operator/chat?**", async (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("scope") ?? "default";
    chatUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1"
      },
      body: uiMessageStream([
        { type: "text-start", id: `mock-` },
        {
          type: "text-delta",
          id: `mock-`,
          delta: `SCOPE_OK:${scope}\n\n公式：\\(F=ma\\)`
        },
        { type: "text-end", id: `mock-` }
      ])
    });
  });

  await page.goto("/");
  await expect(page.getByPlaceholder("输入任务需求")).toBeVisible();
  await expect(page.locator(".workspace-composer .group-tab")).toHaveText(["办公", "教育", "科研", "设计", "工业"]);
  await expect(page.locator(".workspace-composer .scope-tag")).toHaveCount(officeGroupScopes.length);
  await expect(page.locator(".workspace-composer .scope-tag").first()).toHaveAttribute("data-scope-id", "ppt-master");
  await expect(page.locator('.workspace-composer [data-scope-id="ppt-master"]')).toBeVisible();
  await expect(page.locator('.workspace-composer [data-scope-id="guizang-ppt-skill"]')).toBeVisible();
  await expect(page.locator('.workspace-composer [data-scope-id="gorden-ppt-skill"]')).toHaveCount(0);

  await page.getByRole("button", { name: "教育", exact: true }).click();
  await expect(page.locator(".workspace-composer .scope-tag")).toHaveCount(educationGroupScopes.length);

  await page.getByRole("button", { name: "科研", exact: true }).click();
  await expect(page.locator(".workspace-composer .scope-tag")).toHaveCount(researchGroupScopes.length);
  await expect(page.locator('.workspace-composer [data-scope-id="scientific-agent-skills"]')).toBeVisible();
  await expect(page.locator('.workspace-composer [data-scope-id="research.paper-from-results"]')).toContainText("用实验结果写论文");
  await expect(page.locator('.workspace-composer [data-scope-id="text-to-cad"]')).toHaveCount(0);
  await page.getByRole("button", { name: "设计", exact: true }).click();
  await expect(page.locator(".workspace-composer .scope-tag")).toHaveCount(designGroupScopes.length);
  await expect(page.locator('.workspace-composer [data-scope-id="text-to-cad"]')).toBeVisible();
  await page.getByRole("button", { name: "办公", exact: true }).click();

  let previousChatCount = chatUrls.length;
  await submitComposer(page, "default flow");
  await expect.poll(() => chatUrls.length).toBe(previousChatCount + 1);
  expect(new URL(chatUrls.at(-1) ?? "").searchParams.has("scope")).toBe(false);
  await expect(page.locator(".thread-frame.active").getByText("SCOPE_OK:default")).toBeVisible();
  await expect(page.locator(".thread-frame.active .katex")).toContainText("F");

  let submittedScopeCount = 0;
  for (const { group, item: scope } of enabledScopeEntries) {
    await page.getByRole("button", { name: "新任务" }).click();
    await expect(page).toHaveURL(/\/$/);
    const groupTab = page.getByRole("button", { name: group.label, exact: true });
    await groupTab.click();
    await expect(groupTab).toHaveClass(/active/);
    const scopeTag = page.locator(`.workspace-composer [data-scope-id="${scope.id}"]`);
    await expect(scopeTag).toBeVisible();
    if (await scopeTag.isDisabled()) {
      await expect(scopeTag).toHaveClass(/unavailable/);
      continue;
    }
    await scopeTag.click();
    await expect(scopeTag).toHaveClass(/active/);
    previousChatCount = chatUrls.length;
    await submitComposer(page, `scope flow ${scope.id}`);
    await expect.poll(() => chatUrls.length).toBe(previousChatCount + 1);
    expect(new URL(chatUrls.at(-1) ?? "").searchParams.get("scope")).toBe(scope.id);
    await expect(page.locator(".thread-frame.active").getByText(`SCOPE_OK:${scope.id}`)).toBeVisible();
    await expect(page.locator(".thread-frame.active .katex").filter({ hasText: "F" }).first()).toBeVisible();
    submittedScopeCount += 1;
  }

  expect(chatUrls).toHaveLength(submittedScopeCount + 1);
});

async function submitComposer(page: Page, text: string) {
  const activeThread = page.locator(".thread-frame.active");
  const composer = page.locator(".workspace-composer");
  await composer.locator(".composer-input").fill(text);
  await composer.getByLabel("发送任务").click();
  await expect(activeThread.getByText(text, { exact: true })).toBeVisible();
}

function uiMessageStream(chunks: unknown[]) {
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("");
}

function isEnabledScope(item: ScopeItem) {
  return item.kind !== "skill" || item.available !== false;
}
