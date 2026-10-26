import { test, expect } from "@playwright/test";

const olderMockTasks = Array.from({ length: 34 }, (_, index) => ({
  id: `task_archive_${index}`,
  title: `历史归档任务 ${index + 1}`,
  createdAt: `2026-06-12T${String(23 - Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "15" : "45"}:00.000Z`,
  updatedAt: `2026-06-12T${String(23 - Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "15" : "45"}:00.000Z`
}));

const mockTasks = [
  {
    id: "task_math",
    title: "找今年上海高考数学压轴题",
    createdAt: "2026-06-13T01:00:00.000Z",
    updatedAt: "2026-06-13T01:00:00.000Z"
  },
  {
    id: "task_poem",
    title: "作一首关于黄浦江的诗歌",
    createdAt: "2026-06-13T00:30:00.000Z",
    updatedAt: "2026-06-13T00:30:00.000Z"
  },
  ...olderMockTasks,
  {
    id: "task_rsa",
    title: "写一段 RSA 算法代码",
    createdAt: "2026-06-11T00:20:00.000Z",
    updatedAt: "2026-06-11T00:20:00.000Z"
  }
];

const taskRsaMessages = [
  { role: "user", content: "历史任务内容" },
  {
    role: "assistant",
    content:
      "已生成网页课件： [html deck](/api/operator/artifact?workspace=/tmp/operator/task_rsa&path=deck.html)\n\n目标产物：\n- [下载 deck.html](/api/operator/artifact?workspace=/tmp/operator/task_rsa&path=deck.html&download=1)\n- [预览 deck.pptx](/api/operator/artifact?workspace=/tmp/operator/task_rsa&path=deck.pptx) / [下载 deck.pptx](/api/operator/artifact?workspace=/tmp/operator/task_rsa&path=deck.pptx&download=1)"
  }
];

test.beforeEach(async ({ page, context }) => {
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
  await page.route("**/api/operator/session/bootstrap", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ source: "local", tasks: mockTasks })
    })
  );
  await page.route("**/api/operator/task-messages?**", (route) => {
    const url = new URL(route.request().url());
    const taskId = url.searchParams.get("taskId");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: taskId === "task_rsa" ? taskRsaMessages : [] })
    });
  });
  await context.route("**/api/operator/artifact?**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, sizeBytes: 32 })
        })
      : route.fulfill(artifactRouteResponse(route.request().url()))
  );
  await page.route("**/api/operator/task-detail?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(taskRsaDetail())
    })
  );
});

test("workbench navigation, history search, preview, and account controls are stable", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveTitle("算子");
  await expect(page.locator(".brand-link")).toContainText("算子");
  await expect(page.locator(".brand-link img.brand-mark")).toHaveAttribute("src", "/brand/operator-logo.svg");
  await expect(page.locator('link[rel="icon"][href="/brand/operator-favicon.png"]')).toHaveCount(1);
  await expect(page.getByText("你想完成什么任务？")).toBeVisible();

  const metrics = await page.evaluate(() => ({
    bodyScrollHeight: document.body.scrollHeight,
    htmlScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    navTexts: Array.from(document.querySelectorAll(".primary-nav button, .primary-nav a")).map((element) => element.textContent?.trim())
  }));
  expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(metrics.htmlScrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(metrics.navTexts).toEqual(["新任务", "搜索", "云盘"]);
  await expect(page.locator(".sidebar-account .account-button")).toBeVisible();
  await expect(page.locator(".topbar-account .account-button")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.getByLabel("收起左侧栏")).toBeVisible();
  const unavailableScopes = page.locator(".scope-tag.unavailable");
  const unavailableScopeCount = await unavailableScopes.count();
  for (let index = 0; index < unavailableScopeCount; index += 1) {
    await expect(unavailableScopes.nth(index)).toBeDisabled();
    await expect(unavailableScopes.nth(index)).toContainText("未安装");
  }
  await expect(page.locator(".workspace-composer .composer-root")).toBeVisible();
  await page.locator(".workspace-composer").evaluate((element) => {
    element.setAttribute("data-stable-check", "composer-host");
  });

  await page.getByLabel("收起左侧栏").click();
  await expect(page.locator(".operator-shell.sidebar-collapsed")).toBeVisible();
  const collapsedSidebarWidth = await page.locator(".sidebar").evaluate((element) => element.getBoundingClientRect().width);
  expect(collapsedSidebarWidth).toBeLessThanOrEqual(66);
  await page.getByLabel("展开左侧栏").click();
  await expect(page.locator(".operator-shell.sidebar-collapsed")).toHaveCount(0);

  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByLabel("搜索任务历史")).toBeVisible();
  await page.getByLabel("搜索任务历史").fill("黄浦江");
  await expect(page.locator("a.task-item", { hasText: "黄浦江" })).toBeVisible();
  await expect(page.locator(".task-item")).toHaveCount(1);

  await page.getByLabel("搜索任务历史").fill("");
  await page.locator(".task-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  const rsaTaskLink = page.locator('a.task-item[href="/tasks/task_rsa"]');
  await rsaTaskLink.scrollIntoViewIfNeeded();
  await expect(rsaTaskLink).toBeVisible();
  await rsaTaskLink.click();
  await expect(page).toHaveURL(/\/tasks\/task_rsa$/);
  await expect(page.getByText("历史任务内容")).toBeVisible();
  await page.getByLabel("复制回答").first().click();
  await expect(page.getByRole("button", { name: "复制回答" }).first()).toContainText("已复制");
  await expect(page.locator(".workspace-composer")).toHaveAttribute("data-stable-check", "composer-host");
  const htmlDownloadLink = page.locator('.thread-frame.active a.markdown-link[download="deck.html"]', { hasText: "下载 deck.html" });
  await expect(htmlDownloadLink).toBeVisible();
  await expect(htmlDownloadLink).toHaveAttribute("href", /download=1/);
  const pptDownloadLink = page.locator('.thread-frame.active a.markdown-link[download="deck.pptx"]', { hasText: "下载 deck.pptx" });
  await expect(pptDownloadLink).toBeVisible();
  await expect(pptDownloadLink).toHaveAttribute("href", /download=1/);
  const htmlDeckLink = page.locator(".thread-frame.active a.artifact-inline-card", { hasText: "deck.html" });
  await expect(htmlDeckLink).toHaveAttribute("target", "_blank");
  await expect(htmlDeckLink).toHaveAttribute("rel", "noreferrer");
  await htmlDeckLink.click();
  await expect(page.locator(".preview-pane")).toBeVisible();
  await expect(page.locator(".preview-pane")).toHaveAttribute("aria-label", "文件工作区");
  await expect(page.locator(".preview-pane")).not.toContainText("文件工作区");
  await expect(page.locator(".preview-pane")).not.toContainText("task_rsa");
  await expect(page.locator(".preview-pane")).not.toContainText("deck.html");
  await expect(page.locator(".preview-pane")).not.toContainText("产物区");
  await expect(page.getByText("output/chat_result.json")).toHaveCount(0);
  await expect(page.getByLabel("编辑文件内容")).toHaveCount(0);
  await expect(page.frameLocator(".document-frame-wrap iframe").getByRole("heading", { name: "Mock deck" })).toBeVisible();
  const previewLayout = await page.locator(".preview-pane").evaluate((pane) => {
    const paneBox = pane.getBoundingClientRect();
    const frameBox = pane.querySelector(".document-frame-wrap")?.getBoundingClientRect();
    return { paneHeight: paneBox.height, frameHeight: frameBox?.height ?? 0 };
  });
  expect(previewLayout.frameHeight).toBeGreaterThan(previewLayout.paneHeight - 120);
  await page.locator(".preview-pane").getByRole("button", { name: "编辑" }).click();
  await expect(page.getByLabel("编辑文件内容")).toHaveValue(/Mock deck/);
  const editorLayout = await page.locator(".preview-pane").evaluate((pane) => {
    const paneBox = pane.getBoundingClientRect();
    const editorBox = pane.querySelector("textarea")?.getBoundingClientRect();
    return { paneHeight: paneBox.height, editorHeight: editorBox?.height ?? 0 };
  });
  expect(editorLayout.editorHeight).toBeGreaterThan(editorLayout.paneHeight - 120);
  await page.getByLabel("编辑文件内容").fill("<!doctype html><title>html deck</title><h1>Edited deck</h1>");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存到任务工作区")).toBeVisible();
  await expect(page.getByLabel("编辑文件内容")).toHaveCount(0);
  await expect(page.frameLocator(".document-frame-wrap iframe").getByRole("heading", { name: "Edited deck" })).toBeVisible();
  const pptDeckLink = page.locator(".thread-frame.active a.artifact-inline-card", { hasText: "deck.pptx" });
  await pptDeckLink.click();
  const pptPreviewImage = page.locator('.preview-pane .artifact-preview-media img[alt="deck.pptx"]');
  await expect(pptPreviewImage).toBeVisible();
  await expect(pptPreviewImage).toHaveAttribute("src", /preview=png/);
  await expect(page.locator(".preview-pane").getByText("第 1 / 3 页")).toBeVisible();
  await page.locator(".preview-pane").getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".preview-pane").getByText("第 2 / 3 页")).toBeVisible();
  await expect(pptPreviewImage).toHaveAttribute("src", /page=2/);
  await expect(page.locator(".preview-pane").getByRole("button", { name: "编辑" })).toHaveCount(0);
  await expect(page.getByText("历史任务内容")).toBeVisible();
  await page.getByLabel("关闭文件工作区").click();
  await expect(page.locator(".preview-pane")).toHaveCount(0);
  await page.getByLabel("打开预览区").click();
  await expect(page.locator(".preview-pane")).toBeVisible();
  await expect(page.locator(".preview-pane")).toHaveAttribute("aria-label", "文件工作区");
  await expect(page.locator(".preview-pane")).not.toContainText("文件工作区");
  await expect(page.locator(".preview-pane")).not.toContainText("task_rsa");
  await expect(page.locator(".preview-pane")).not.toContainText("产物区");
  await expect(page.getByText("output/chat_result.json")).toHaveCount(0);
  await expect(page.getByLabel("编辑文件内容")).toHaveCount(0);
  await expect(page.getByText("从对话中点击 Word、PPT、Markdown 或其他文件后")).toBeVisible();
  await page.getByLabel("关闭文件工作区").click();
  await expect(page.locator(".preview-pane")).toHaveCount(0);

  await page.getByRole("button", { name: "新任务" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("你想完成什么任务？")).toBeVisible();
  await expect(page.locator(".workspace-composer")).toHaveAttribute("data-stable-check", "composer-host");

  await expect(page.locator(".workspace-composer").getByLabel("添加附件")).toBeEnabled();
  await expect(async () => {
    await page.locator(".topbar-account .account-button").click();
    await expect(page).toHaveURL(/\/login\?next=%2F$/, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "登录算子" })).toBeVisible();
  await expect(page.getByText("账户服务尚未启用。")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("task workspace remains usable as a drawer on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible();
  await page.getByRole("button", { name: "搜索" }).click();
  const rsaTaskLink = page.locator('.operator-shell.history-open a.task-item[href="/tasks/task_rsa"]');
  await expect(rsaTaskLink).toBeVisible();
  await rsaTaskLink.click();
  await expect(page).toHaveURL(/\/tasks\/task_rsa$/);
  await expect(page.getByText("历史任务内容")).toBeVisible();
  await expect(page.getByRole("button", { name: "继续对话" })).toHaveCount(0);
  await expect(page.locator(".workspace-composer").getByLabel("添加附件")).toBeEnabled();
  const mobileHeader = await page.evaluate(() => {
    const brand = document.querySelector(".brand-row")?.getBoundingClientRect();
    const nav = document.querySelector(".primary-nav")?.getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    return {
      brandCenter: brand ? brand.top + brand.height / 2 : 0,
      navCenter: nav ? nav.top + nav.height / 2 : 999,
      sidebarHeight: sidebar?.height ?? 0
    };
  });
  expect(Math.abs(mobileHeader.brandCenter - mobileHeader.navCenter)).toBeLessThan(4);
  expect(mobileHeader.sidebarHeight).toBeLessThanOrEqual(62);

  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.locator(".operator-shell.history-open .history-block")).toBeVisible();
  await expect(page.locator(".operator-shell.history-open .task-item", { hasText: "写一段 RSA 算法代码" })).toBeVisible();
  await page.mouse.click(374, 80);
  await expect(page.locator(".operator-shell.history-open")).toHaveCount(0);

  await page.getByLabel("打开预览区").click();
  await expect(page.locator(".preview-pane")).toBeVisible();
  await expect(page.locator(".preview-pane")).toHaveAttribute("aria-label", "文件工作区");

  const drawerBox = await page.locator(".preview-pane").boundingBox();
  expect(drawerBox?.width).toBeGreaterThan(360);
  expect(drawerBox?.height).toBeGreaterThan(700);

  await page.getByLabel("关闭文件工作区").click();
  await expect(page.locator(".preview-pane")).toHaveCount(0);
});

test("history selection switches away from home while messages are still loading", async ({ page }) => {
  await page.unroute("**/api/operator/task-messages?**");
  await page.unroute("**/api/operator/task-detail?**");
  let releaseMessages: () => void = () => undefined;
  const messagesGate = new Promise<void>((resolve) => {
    releaseMessages = resolve;
  });
  await page.route("**/api/operator/task-messages?**", async (route) => {
    const url = new URL(route.request().url());
    const taskId = url.searchParams.get("taskId");
    if (taskId === "task_rsa") await messagesGate;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: taskId === "task_rsa" ? taskRsaMessages : [] })
    });
  });
  await page.route("**/api/operator/task-detail?**", async (route) => {
    const url = new URL(route.request().url());
    const taskId = url.searchParams.get("taskId");
    if (taskId === "task_rsa") await messagesGate;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(taskId === "task_rsa" ? taskRsaDetail() : { exists: false })
    });
  });

  await page.goto("/");
  await expect(page.getByText("你想完成什么任务？")).toBeVisible();
  const rsaTaskLink = page.locator('a.task-item[href="/tasks/task_rsa"]');
  await rsaTaskLink.scrollIntoViewIfNeeded();
  await expect(rsaTaskLink).toBeVisible();
  await rsaTaskLink.click({ noWaitAfter: true });

  await expect(page.locator('a.task-item.active[href="/tasks/task_rsa"]')).toContainText("写一段 RSA 算法代码");
  await expect(page.getByText("你想完成什么任务？")).toHaveCount(0);
  await expect(page.getByText("正在打开任务...")).toHaveCount(0);
  await expect(page.locator(".thread-frame.active .message")).toHaveCount(0);

  releaseMessages();
  await expect(page.getByText("历史任务内容")).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/task_rsa$/);
});

test("drive page asks guests to log in instead of exposing raw auth errors", async ({ page }) => {
  let driveObjectsCalled = false;
  await page.unroute("**/api/operator/session");
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true, unverifiedEmailLoginAllowed: true },
        authenticated: false,
        user: null,
        bootstrapAvailable: true,
        error: "Auth session missing!"
      })
    })
  );
  await page.route("**/api/operator/drive/objects", (route) => {
    driveObjectsCalled = true;
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Authentication is required.", code: "AUTH_REQUIRED" })
    });
  });
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "云盘" })).toBeVisible();
  await expect(page.getByLabel("登录云盘")).toBeVisible();
  await expect(page.locator(".drive-login-link")).toHaveAttribute("href", "/login?next=/drive");
  await expect(page.getByText("Authentication is required")).toHaveCount(0);
  expect(driveObjectsCalled).toBe(false);
});

test("login page presents phone login with retained email entry in backend mode", async ({ page }) => {
  await page.unroute("**/api/operator/session");
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true, unverifiedEmailLoginAllowed: true },
        authenticated: false,
        user: null,
        bootstrapAvailable: true,
        error: "Auth session missing!"
      })
    })
  );

  await page.goto("/login?next=/drive");
  await expect(page.getByRole("heading", { name: "登录算子" })).toBeVisible();
  await expect(page.getByLabel("手机号")).toBeVisible();
  await expect(page.getByLabel("验证码")).toBeVisible();
  await expect(page.getByRole("button", { name: "获取验证码" })).toBeVisible();
  await expect(page.getByLabel("安全邮箱")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "手机号登录 / 创建账户" })).toBeVisible();
  await page.getByRole("button", { name: "邮箱" }).click();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByRole("button", { name: "邮箱登录 / 绑定" })).toBeVisible();
  await expect(page.locator(".login-return")).toHaveAttribute("href", "/drive");
});

test("guest topbar account entry is labeled as login", async ({ page }) => {
  await page.unroute("**/api/operator/session");
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        authenticated: true,
        user: {
          id: "guest-1",
          email: null,
          phone: null,
          displayName: "访客 abc123",
          avatarUrl: null,
          isGuest: true
        },
        bootstrapAvailable: true,
        error: null
      })
    })
  );

  await page.goto("/");
  await expect(page.locator(".topbar-account .account-button")).toContainText("登录");
});

test("registered phone account shows local phone label and opens account menu", async ({ page }) => {
  await page.unroute("**/api/operator/session");
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        authenticated: true,
        user: {
          id: "user-phone-1",
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

  await page.goto("/");
  await expect(page.locator(".sidebar-account .account-button")).toContainText("13800138000");
  await expect(page.locator(".sidebar-account .account-button")).not.toContainText("+86");
  await page.locator(".sidebar-account .account-button").click();
  await expect(page.locator(".sidebar-account .account-menu")).toBeVisible();
  await expect(page.locator(".sidebar-account .account-menu")).toContainText("个人资料");
  await expect(page.locator(".sidebar-account .account-menu")).toContainText("设置");
  await expect(page.locator(".sidebar-account .account-menu a", { hasText: "个人资料" })).toHaveAttribute("href", "/account?tab=profile");
  await expect(page.locator(".sidebar-account .account-menu a", { hasText: "设置" })).toHaveAttribute("href", "/account?tab=settings");
});

test("account page updates profile basics", async ({ page }) => {
  await page.unroute("**/api/operator/session");
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        authenticated: true,
        user: {
          id: "user-phone-1",
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
  let requestBody: unknown;
  await page.route("**/api/operator/account/profile", async (route) => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        authenticated: true,
        user: {
          id: "user-phone-1",
          email: "safe@example.com",
          phone: "+8613800138000",
          displayName: "BioStar",
          avatarUrl: null,
          isGuest: false
        },
        bootstrapAvailable: true,
        error: null
      })
    });
  });

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
  await expect(page.getByLabel("显示名称")).toHaveValue("13800138000");
  await expect(page.locator("#account-phone")).toContainText("13800138000");
  await page.getByLabel("显示名称").fill("BioStar");
  await page.getByLabel("安全邮箱").fill("safe@example.com");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("已保存。")).toBeVisible();
  expect(requestBody).toEqual({ displayName: "BioStar", safetyEmail: "safe@example.com" });
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByText("本机任务缓存")).toBeVisible();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("signed-out backend mode shows only browser-local task history", async ({ page }) => {
  await page.unroute("**/api/operator/session");
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "operator.tasks.v1",
      JSON.stringify([
        {
          id: "task_browser_local",
          title: "匿名本地对话",
          createdAt: "2026-06-17T09:00:00.000Z",
          updatedAt: "2026-06-17T09:00:00.000Z"
        }
      ])
    );
  });
  await page.route("**/api/operator/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        authenticated: false,
        user: null,
        bootstrapAvailable: true,
        error: "Auth session missing!"
      })
    })
  );
  await page.route("**/api/operator/tasks", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ source: "server", tasks: [] })
    })
  );

  await page.goto("/");
  await expect(page.locator(".task-item", { hasText: "匿名本地对话" })).toBeVisible();
  await expect(page.locator(".history-auth-prompt")).toHaveCount(0);
  await expect(page.getByText("找今年上海高考数学压轴题")).toHaveCount(0);
});

test("starting a new task does not cancel or erase the previous running task", async ({ page }) => {
  await page.route("**/api/operator/chat?**", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { messages?: Array<{ role?: string; content?: string; parts?: Array<{ text?: string }> }> };
    const text = body.messages?.at(-1)?.content ?? body.messages?.at(-1)?.parts?.find((part) => part.text)?.text ?? "unknown";
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1"
      },
      body: uiMessageStream([
        { type: "text-start", id: "parallel-text" },
        {
          type: "text-delta",
          id: "parallel-text",
          delta: `PARALLEL_DONE:${text}`
        },
        { type: "text-end", id: "parallel-text" }
      ])
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("输入任务需求").fill("第一个并行任务");
  await page.getByLabel("发送任务").click();
  await expect(page).toHaveURL(/\/tasks\/task_/);
  const firstTaskUrl = page.url();

  await page.getByRole("button", { name: "新任务" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("你想完成什么任务？")).toBeVisible();

  await page.waitForTimeout(900);
  await page.locator("a.task-item", { hasText: "第一个并行任务" }).click();
  await expect(page).toHaveURL(firstTaskUrl);
  await expect(page.locator(".thread-frame.active .user-message").getByText("第一个并行任务", { exact: true })).toBeVisible();
  await expect(page.locator(".thread-frame.active").getByText("PARALLEL_DONE:第一个并行任务")).toBeVisible();
});

function artifactRouteResponse(requestUrl: string) {
  const url = new URL(requestUrl);
  const artifactPath = url.searchParams.get("path") ?? "";
  if (artifactPath.endsWith(".pptx")) {
    if (url.searchParams.get("preview") === "metadata") {
      return {
        contentType: "application/json",
        body: JSON.stringify({ pageCount: 3 })
      };
    }
    if (url.searchParams.get("preview") === "png") {
      return {
        contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
      };
    }
    return {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      body: "mock pptx"
    };
  }
  return {
    contentType: "text/html",
    body: "<!doctype html><title>html deck</title><h1>Mock deck</h1>"
  };
}

function taskRsaDetail() {
  return {
    taskId: "task_rsa",
    workspace: "/tmp/operator/task_rsa",
    exists: true,
    request: { messages: taskRsaMessages },
    result: {
      run_id: "task_rsa",
      status: "succeeded",
      selected_skills: [],
      runs: [],
      agent: {
        conversation_id: "conversation_rsa",
        trace: [{ kind: "action", label: "调用工具 terminal", detail: "python rsa.py", tool: "terminal" }]
      }
    },
    artifacts: [
      {
        name: "chat_result",
        type: "json",
        path: "output/chat_result.json",
        mime_type: "application/json",
        size_bytes: 128,
        href: "/api/operator/artifact?workspace=/tmp/operator/task_rsa&path=output/chat_result.json",
        downloadHref: "/api/operator/artifact?workspace=/tmp/operator/task_rsa&path=output/chat_result.json&download=1",
        preview: '{\n  "status": "succeeded"\n}'
      }
    ]
  };
}

function uiMessageStream(chunks: unknown[]) {
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("");
}
