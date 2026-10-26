import { expect, test } from "@playwright/test";

const ownerSession = {
  backend: { enabled: true },
  authenticated: true,
  owner: true,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@operator.local",
    phone: null,
    displayName: "owner",
    avatarUrl: null,
    isGuest: false
  },
  error: null
};

const anonymousSession = {
  backend: { enabled: true },
  authenticated: false,
  owner: false,
  user: null,
  error: null
};

test("owner can log in and operate the admin console", async ({ page }) => {
  let loggedIn = false;
  let balance = 100;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.route(
    (url) => url.pathname === "/api/admin/session",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(loggedIn ? ownerSession : anonymousSession)
      })
  );
  await page.route(
    (url) => url.pathname === "/api/admin/session/login",
    async (route) => {
      loggedIn = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(ownerSession)
      });
    }
  );
  await page.route("**/api/admin/summary", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        users: { total: 33, active: 32, registered: 3, guests: 30, disabled: 1 },
        sessions: { active: 4 },
        work: { conversations: 12, messages: 88, agentRuns: 7, failedAgentRuns24h: 1 },
        credits: { totalBalance: balance, totalGranted: 200, totalConsumed: 100 }
      })
    })
  );
  await page.route(
    (url) => url.pathname === "/api/admin/users",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          users: [adminUser(balance)],
          pagination: { limit: 30, offset: 0, total: 1 }
        })
      })
  );
  await page.route(
    (url) => url.pathname === "/api/admin/users/00000000-0000-4000-8000-000000000001",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(adminUserDetail(balance))
      })
  );
  await page.route("**/api/admin/users/00000000-0000-4000-8000-000000000001/credits", async (route) => {
    const request = (await route.request().postDataJSON()) as { delta: number };
    balance += request.delta;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ accountId: "credit-account-1", balance, ledgerId: "ledger-2" })
    });
  });

  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "登录管理台" })).toBeVisible();
  await page.getByLabel("邮箱").fill("owner@operator.local");
  const loginButton = page.locator('.admin-login-form button[type="submit"]');
  await expect(loginButton).toBeEnabled();
  const loginResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/admin/session/login" && response.request().method() === "POST"
  );
  await loginButton.click();
  await expect((await loginResponse).ok()).toBe(true);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
  await expect(page.getByText("用户总数")).toBeVisible();
  await expect(page.getByText("33")).toBeVisible();
  await expect(page.getByText("owner@operator.local").first()).toBeVisible();

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await expect(page.getByText("owner@operator.local").first()).toBeVisible();
  await page.getByRole("link", { name: "查看 owner" }).click();

  await expect(page).toHaveURL(/\/admin\/users\/00000000-0000-4000-8000-000000000001$/);
  await expect(page.getByRole("heading", { name: "用户详情" })).toBeVisible();
  await expect(page.getByText("100").first()).toBeVisible();
  await page.getByLabel("调整值").fill("50");
  await page.getByLabel("原因").fill("Playwright 发放");
  await page.getByRole("button", { name: "提交调整" }).click();
  await expect(page.getByText("积分已更新。")).toBeVisible();
  await expect(page.getByText("150").first()).toBeVisible();

  const metrics = await page.evaluate(() => ({
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight,
    adminMainVisible: Boolean(document.querySelector(".admin-main"))
  }));
  expect(metrics.adminMainVisible).toBe(true);
  expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(consoleErrors).toEqual([]);
});

function adminUser(creditBalance: number) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "active",
    primaryEmail: "owner@operator.local",
    primaryPhone: null,
    displayName: "owner",
    avatarUrl: null,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:00.000Z",
    isOwner: true,
    creditBalance,
    conversationCount: 2,
    messageCount: 9,
    lastSessionAt: "2026-06-18T10:30:00.000Z"
  };
}

function adminUserDetail(balance: number) {
  return {
    user: adminUser(balance),
    creditAccount: {
      id: "credit-account-1",
      balance,
      currency: "points",
      status: "active",
      updatedAt: "2026-06-18T10:30:00.000Z"
    },
    ledger: [
      {
        id: "ledger-1",
        accountId: "credit-account-1",
        delta: balance,
        balanceAfter: balance,
        reason: "内测积分发放",
        createdBy: "00000000-0000-4000-8000-000000000001",
        metadata: {},
        createdAt: "2026-06-18T10:30:00.000Z"
      }
    ],
    conversations: [
      {
        id: "conversation-1",
        title: "测试后台任务",
        status: "active",
        createdAt: "2026-06-18T10:00:00.000Z",
        updatedAt: "2026-06-18T10:30:00.000Z"
      }
    ]
  };
}
