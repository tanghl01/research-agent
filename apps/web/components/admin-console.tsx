"use client";

import { Activity, ArrowLeft, ArrowRight, Coins, Database, Home, LogOut, RefreshCw, Search, Shield, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

type AdminSession = {
  backend: {
    enabled: boolean;
  };
  authenticated: boolean;
  owner: boolean;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
    avatarUrl: string | null;
    isGuest?: boolean;
  } | null;
  error: string | null;
};

type AdminSummary = {
  users: {
    total: number;
    active: number;
    registered: number;
    guests: number;
    disabled: number;
  };
  sessions: {
    active: number;
  };
  work: {
    conversations: number;
    messages: number;
    agentRuns: number;
    failedAgentRuns24h: number;
  };
  credits: {
    totalBalance: number;
    totalGranted: number;
    totalConsumed: number;
  };
};

type AdminUser = {
  id: string;
  status: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  creditBalance: number;
  conversationCount: number;
  messageCount: number;
  lastSessionAt: string | null;
};

type AdminUserListResult = {
  users: AdminUser[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

type AdminUserDetail = {
  user: AdminUser;
  creditAccount: {
    id: string;
    balance: number;
    currency: string;
    status: string;
    updatedAt: string;
  } | null;
  ledger: Array<{
    id: string;
    accountId: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    createdBy: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

type LoadState<T> =
  | { status: "loading"; data: null; error: "" }
  | { status: "ready"; data: T; error: "" }
  | { status: "error"; data: null; error: string };

export function AdminLoginPage({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<AdminSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: AdminSession) => {
        if (cancelled) return;
        setSession(payload);
        if (payload.owner) router.replace(nextPath);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [nextPath, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) {
      setMessage("请输入 owner 邮箱。");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: nextEmail })
    });
    const payload = (await response.json().catch(() => ({}))) as AdminSession & { error?: string };
    setBusy(false);
    if (!response.ok || !payload.owner) {
      setMessage(payload.error ?? "登录失败。");
      return;
    }
    setSession(payload);
    router.replace(nextPath);
    router.refresh();
  };

  const backendEnabled = session?.backend.enabled ?? true;

  return (
    <main className="admin-login-page">
      <header className="admin-login-topbar">
        <Link className="admin-brand" href="/">
          <img src="/brand/operator-logo.svg" alt="" />
          <span>算子</span>
        </Link>
        <Link className="admin-return" href="/">
          <ArrowLeft size={17} />
          <span>返回产品</span>
        </Link>
      </header>
      <section className="admin-login-panel" aria-label="owner 登录">
        <div className="admin-section-label">Owner</div>
        <h1>登录管理台</h1>
        <p>仅平台 owner 可访问用户、积分和运行概览。</p>
        {backendEnabled ? (
          <form className="admin-login-form" onSubmit={submit}>
            <label htmlFor="admin-owner-email">邮箱</label>
            <input
              id="admin-owner-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              placeholder="owner@example.com"
              autoComplete="email"
              disabled={busy}
            />
            <button type="submit" disabled={busy}>
              <Shield size={16} />
              <span>{busy ? "登录中" : "登录"}</span>
            </button>
          </form>
        ) : (
          <div className="admin-empty-state">后端账户服务尚未启用。</div>
        )}
        {message ? <div className="admin-form-message">{message}</div> : null}
      </section>
    </main>
  );
}

export function AdminDashboardPage() {
  const { session, state } = useAdminGuard();
  const [summary, setSummary] = useState<LoadState<AdminSummary>>(loadingState());
  const [users, setUsers] = useState<LoadState<AdminUserListResult>>(loadingState());

  const load = useCallback(() => {
    setSummary(loadingState());
    setUsers(loadingState());
    fetchJson<AdminSummary>("/api/admin/summary").then(setSummary);
    fetchJson<AdminUserListResult>("/api/admin/users?limit=6").then(setUsers);
  }, []);

  useEffect(() => {
    if (state === "ready") load();
  }, [load, state]);

  return (
    <AdminShell session={session} title="概览">
      {state === "loading" ? <AdminLoading /> : null}
      {state === "denied" ? <AdminDenied /> : null}
      {state === "ready" ? (
        <div className="admin-content-grid">
          <div className="admin-page-heading">
            <div>
              <div className="admin-section-label">Dashboard</div>
              <h1>系统概览</h1>
            </div>
            <button className="admin-outline-button" type="button" onClick={load}>
              <RefreshCw size={16} />
              <span>刷新</span>
            </button>
          </div>

          {summary.status === "ready" ? (
            <div className="admin-stat-grid">
              <StatCard
                icon={<Users size={18} />}
                label="用户总数"
                value={summary.data.users.total}
                detail={`${summary.data.users.registered} 注册 / ${summary.data.users.guests} 访客`}
              />
              <StatCard
                icon={<Activity size={18} />}
                label="活跃会话"
                value={summary.data.sessions.active}
                detail={`${summary.data.work.failedAgentRuns24h} 个 24h 失败任务`}
              />
              <StatCard
                icon={<Database size={18} />}
                label="对话与消息"
                value={summary.data.work.conversations}
                detail={`${summary.data.work.messages} 条消息 / ${summary.data.work.agentRuns} 次运行`}
              />
              <StatCard
                icon={<Coins size={18} />}
                label="积分余额"
                value={summary.data.credits.totalBalance}
                detail={`${summary.data.credits.totalGranted} 发放 / ${summary.data.credits.totalConsumed} 消耗`}
              />
            </div>
          ) : (
            <AdminPanelState state={summary} />
          )}

          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>最近用户</h2>
                <span>按创建时间排序</span>
              </div>
              <Link className="admin-link-button" href="/admin/users">
                <span>查看全部</span>
                <ArrowRight size={15} />
              </Link>
            </div>
            {users.status === "ready" ? <AdminUserTable users={users.data.users} compact /> : <AdminPanelState state={users} />}
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}

export function AdminUsersPage() {
  const { session, state } = useAdminGuard();
  const router = useRouter();
  const params = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const initialOffset = Number(params.get("offset") ?? 0);
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<LoadState<AdminUserListResult>>(loadingState());

  const load = useCallback(
    (nextQuery = initialQuery, nextOffset = initialOffset) => {
      setResult(loadingState());
      const url = `/api/admin/users?limit=30&offset=${Math.max(0, nextOffset)}&q=${encodeURIComponent(nextQuery.trim())}`;
      fetchJson<AdminUserListResult>(url).then(setResult);
    },
    [initialOffset, initialQuery]
  );

  useEffect(() => {
    if (state === "ready") load();
  }, [load, state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = query.trim();
    router.replace(next ? `/admin/users?q=${encodeURIComponent(next)}` : "/admin/users");
    load(next, 0);
  };

  const page = result.status === "ready" ? result.data.pagination : null;
  const canPrevious = Boolean(page && page.offset > 0);
  const canNext = Boolean(page && page.offset + page.limit < page.total);

  return (
    <AdminShell session={session} title="用户">
      {state === "loading" ? <AdminLoading /> : null}
      {state === "denied" ? <AdminDenied /> : null}
      {state === "ready" ? (
        <div className="admin-content-grid">
          <div className="admin-page-heading">
            <div>
              <div className="admin-section-label">Users</div>
              <h1>用户管理</h1>
            </div>
            <form className="admin-search-form" onSubmit={submit}>
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索邮箱、昵称或手机号" />
              <button type="submit">搜索</button>
            </form>
          </div>

          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>用户列表</h2>
                <span>{page ? `${page.total} 个用户` : "加载中"}</span>
              </div>
            </div>
            {result.status === "ready" ? <AdminUserTable users={result.data.users} /> : <AdminPanelState state={result} />}
            {page ? (
              <div className="admin-pagination">
                <button type="button" disabled={!canPrevious} onClick={() => load(query, Math.max(0, page.offset - page.limit))}>
                  上一页
                </button>
                <span>
                  {page.offset + 1}-{Math.min(page.offset + page.limit, page.total)} / {page.total}
                </span>
                <button type="button" disabled={!canNext} onClick={() => load(query, page.offset + page.limit)}>
                  下一页
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}

export function AdminUserDetailPage({ userId }: { userId: string }) {
  const { session, state } = useAdminGuard();
  const [detail, setDetail] = useState<LoadState<AdminUserDetail>>(loadingState());
  const [delta, setDelta] = useState("100");
  const [reason, setReason] = useState("内测积分发放");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setDetail(loadingState());
    fetchJson<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`).then(setDetail);
  }, [userId]);

  useEffect(() => {
    if (state === "ready") load();
  }, [load, state]);

  const adjustCredits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/credits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        delta: Number(delta),
        reason
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "积分调整失败。");
      return;
    }
    setMessage("积分已更新。");
    load();
  };

  return (
    <AdminShell session={session} title="用户详情">
      {state === "loading" ? <AdminLoading /> : null}
      {state === "denied" ? <AdminDenied /> : null}
      {state === "ready" ? (
        <div className="admin-content-grid">
          <div className="admin-page-heading">
            <div>
              <div className="admin-section-label">User</div>
              <h1>用户详情</h1>
            </div>
            <Link className="admin-outline-button" href="/admin/users">
              <ArrowLeft size={16} />
              <span>返回列表</span>
            </Link>
          </div>

          {detail.status === "ready" ? (
            <>
              <section className="admin-user-hero">
                <div className="admin-user-avatar">{initials(detail.data.user.displayName)}</div>
                <div>
                  <h2>{detail.data.user.displayName}</h2>
                  <span>{detail.data.user.primaryEmail ?? detail.data.user.primaryPhone ?? "访客账户"}</span>
                </div>
                <div className="admin-user-badges">
                  <span>{detail.data.user.status}</span>
                  {detail.data.user.isOwner ? <span>owner</span> : null}
                </div>
              </section>

              <div className="admin-two-column">
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>积分账户</h2>
                      <span>{detail.data.creditAccount?.currency ?? "points"}</span>
                    </div>
                    <strong className="admin-balance">{detail.data.creditAccount?.balance ?? detail.data.user.creditBalance}</strong>
                  </div>
                  <form className="admin-credit-form" onSubmit={adjustCredits}>
                    <label>
                      <span>调整值</span>
                      <input value={delta} onChange={(event) => setDelta(event.currentTarget.value)} inputMode="numeric" />
                    </label>
                    <label>
                      <span>原因</span>
                      <input value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
                    </label>
                    <button type="submit" disabled={busy}>
                      <Coins size={16} />
                      <span>{busy ? "处理中" : "提交调整"}</span>
                    </button>
                  </form>
                  {message ? <div className="admin-form-message">{message}</div> : null}
                </section>

                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>使用概况</h2>
                      <span>当前账户统计</span>
                    </div>
                  </div>
                  <dl className="admin-detail-list">
                    <div>
                      <dt>对话数</dt>
                      <dd>{detail.data.user.conversationCount}</dd>
                    </div>
                    <div>
                      <dt>消息数</dt>
                      <dd>{detail.data.user.messageCount}</dd>
                    </div>
                    <div>
                      <dt>最近会话</dt>
                      <dd>{formatDate(detail.data.user.lastSessionAt)}</dd>
                    </div>
                    <div>
                      <dt>创建时间</dt>
                      <dd>{formatDate(detail.data.user.createdAt)}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <section className="admin-panel">
                <div className="admin-panel-heading">
                  <div>
                    <h2>积分流水</h2>
                    <span>最近 20 条</span>
                  </div>
                </div>
                <div className="admin-ledger-list">
                  {detail.data.ledger.length ? (
                    detail.data.ledger.map((item) => (
                      <div className="admin-ledger-item" key={item.id}>
                        <strong className={item.delta > 0 ? "positive" : "negative"}>
                          {item.delta > 0 ? `+${item.delta}` : item.delta}
                        </strong>
                        <span>{item.reason}</span>
                        <small>
                          {formatDate(item.createdAt)} · 余额 {item.balanceAfter}
                        </small>
                      </div>
                    ))
                  ) : (
                    <div className="admin-empty-state">暂无积分流水。</div>
                  )}
                </div>
              </section>

              <section className="admin-panel">
                <div className="admin-panel-heading">
                  <div>
                    <h2>最近任务</h2>
                    <span>最近 10 条对话</span>
                  </div>
                </div>
                <div className="admin-conversation-list">
                  {detail.data.conversations.length ? (
                    detail.data.conversations.map((conversation) => (
                      <Link href={`/tasks/${encodeURIComponent(conversation.id)}`} key={conversation.id}>
                        <strong>{conversation.title}</strong>
                        <span>{conversation.status}</span>
                        <small>{formatDate(conversation.updatedAt)}</small>
                      </Link>
                    ))
                  ) : (
                    <div className="admin-empty-state">暂无任务。</div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <AdminPanelState state={detail} />
          )}
        </div>
      ) : null}
    </AdminShell>
  );
}

function AdminShell({ children, session, title }: { children: ReactNode; session: AdminSession | null; title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const logout = async () => {
    await fetch("/api/operator/session/logout", { method: "POST" }).catch(() => undefined);
    router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    router.refresh();
  };

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin">
          <img src="/brand/operator-logo.svg" alt="" />
          <span>算子</span>
        </Link>
        <nav className="admin-nav" aria-label="后台导航">
          <Link className={pathname === "/admin" ? "active" : ""} href="/admin">
            <Home size={17} />
            <span>概览</span>
          </Link>
          <Link className={pathname.startsWith("/admin/users") ? "active" : ""} href="/admin/users">
            <Users size={17} />
            <span>用户</span>
          </Link>
          <Link href="/">
            <ArrowLeft size={17} />
            <span>产品首页</span>
          </Link>
        </nav>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span>Owner Console</span>
            <strong>{title}</strong>
          </div>
          <div className="admin-account">
            <UserCog size={17} />
            <span>{session?.user?.displayName ?? "Owner"}</span>
            <button type="button" onClick={logout} aria-label="退出管理台">
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <div className="admin-scroll">{children}</div>
      </section>
    </main>
  );
}

function useAdminGuard(): { session: AdminSession | null; state: "loading" | "ready" | "denied" } {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: AdminSession) => {
        if (cancelled) return;
        setSession(payload);
        if (payload.owner) {
          setState("ready");
        } else {
          setState("denied");
          router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("denied");
        router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return { session, state };
}

function AdminUserTable({ compact, users }: { compact?: boolean; users: AdminUser[] }) {
  if (!users.length) return <div className="admin-empty-state">暂无用户。</div>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>状态</th>
            <th>积分</th>
            <th>对话</th>
            <th>最近会话</th>
            <th>创建时间</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <div className="admin-user-cell">
                  <span>{initials(user.displayName)}</span>
                  <div>
                    <strong>{user.displayName}</strong>
                    <small>{user.primaryEmail ?? user.primaryPhone ?? user.id}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className={user.isOwner ? "admin-status owner" : "admin-status"}>{user.isOwner ? "owner" : user.status}</span>
              </td>
              <td>{user.creditBalance}</td>
              <td>{user.conversationCount}</td>
              <td>{formatDate(user.lastSessionAt)}</td>
              <td>{formatDate(user.createdAt)}</td>
              <td>
                <Link
                  className="admin-icon-link"
                  href={`/admin/users/${encodeURIComponent(user.id)}`}
                  aria-label={`查看 ${user.displayName}`}
                >
                  <ArrowRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {compact ? null : <div className="admin-table-foot">显示当前页用户。</div>}
    </div>
  );
}

function StatCard({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: number }) {
  return (
    <section className="admin-stat-card">
      <div className="admin-stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function AdminPanelState<T>({ state }: { state: LoadState<T> }) {
  if (state.status === "loading") return <AdminLoading />;
  if (state.status === "error") return <div className="admin-empty-state">{state.error}</div>;
  return null;
}

function AdminLoading() {
  return <div className="admin-empty-state">加载中...</div>;
}

function AdminDenied() {
  return <div className="admin-empty-state">需要 owner 权限。</div>;
}

function loadingState<T>(): LoadState<T> {
  return { status: "loading", data: null, error: "" };
}

async function fetchJson<T>(url: string): Promise<LoadState<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { status: "error", data: null, error: payload.error ?? "请求失败。" };
    return { status: "ready", data: payload, error: "" };
  } catch (error) {
    return { status: "error", data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function initials(value: string): string {
  const text = value.trim();
  if (!text) return "S";
  return text.slice(0, 2).toUpperCase();
}
