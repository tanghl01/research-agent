"use client";

import { ArrowLeft, Database, LogOut, Mail, Phone, Save, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { formatAccountName, formatAccountPhone } from "@/lib/account-display";

type AccountTab = "profile" | "settings";

type AccountSession = {
  backend: {
    enabled: boolean;
    publicConfigured: boolean;
    serviceConfigured: boolean;
  };
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
    avatarUrl: string | null;
    isGuest?: boolean;
  } | null;
  bootstrapAvailable: boolean;
  error: string | null;
};

export function AccountPage({ initialTab }: { initialTab: AccountTab }) {
  const router = useRouter();
  const [session, setSession] = useState<AccountSession | null>(null);
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);
  const [displayName, setDisplayName] = useState("");
  const [safetyEmail, setSafetyEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [localCacheCleared, setLocalCacheCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/operator/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: AccountSession) => {
        if (cancelled) return;
        setSession(payload);
        if (payload.user) {
          setDisplayName(formatAccountName(payload.user));
          setSafetyEmail(payload.user.email ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const user = session?.authenticated && !session.user?.isGuest ? session.user : null;
  const accountName = formatAccountName(user, "算子账户");
  const phoneLabel = formatAccountPhone(user?.phone);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/operator/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: displayName.trim(),
        safetyEmail: safetyEmail.trim()
      })
    });
    const payload = (await response.json().catch(() => ({}))) as AccountSession & { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "保存失败。");
      return;
    }
    setSession(payload);
    if (payload.user) {
      setDisplayName(formatAccountName(payload.user));
      setSafetyEmail(payload.user.email ?? "");
    }
    window.dispatchEvent(new Event("operator-account-refresh"));
    setMessage("已保存。");
  };

  const clearLocalCache = () => {
    window.localStorage.removeItem("operator.tasks.v1");
    setLocalCacheCleared(true);
  };

  const logout = async () => {
    setBusy(true);
    await fetch("/api/operator/session/logout", { method: "POST" }).catch(() => undefined);
    window.dispatchEvent(new Event("operator-account-refresh"));
    setBusy(false);
    router.replace("/login?next=/");
  };

  return (
    <main className="account-page">
      <header className="account-topbar">
        <Link className="login-brand" href="/">
          <img src="/brand/operator-logo.svg" alt="" />
          <span>算子</span>
        </Link>
        <Link className="login-return" href="/">
          <ArrowLeft size={17} />
          <span>返回工作区</span>
        </Link>
      </header>

      <section className="account-layout" aria-label="账户管理">
        <aside className="account-sidebar">
          <div className="account-identity">
            <div className="account-avatar">{accountName.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{accountName}</strong>
              <span>{phoneLabel || user?.email || "未登录"}</span>
            </div>
          </div>
          <nav className="account-tabs" aria-label="账户页面">
            <button type="button" className={activeTab === "profile" ? "active" : ""} onClick={() => setActiveTab("profile")}>
              <UserRound size={17} />
              <span>个人资料</span>
            </button>
            <button type="button" className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
              <Settings size={17} />
              <span>设置</span>
            </button>
          </nav>
        </aside>

        <div className="account-content">
          {!session ? (
            <section className="account-panel">
              <h1>账户</h1>
              <p>正在加载账户信息。</p>
            </section>
          ) : !user ? (
            <section className="account-panel">
              <h1>账户</h1>
              <p>请先登录手机号账户后再管理个人资料。</p>
              <Link className="account-primary-link" href="/login?next=/account">
                登录
              </Link>
            </section>
          ) : activeTab === "profile" ? (
            <section className="account-panel">
              <div className="account-panel-heading">
                <div>
                  <div className="section-label">账户</div>
                  <h1>个人资料</h1>
                </div>
              </div>
              <form className="account-form" onSubmit={saveProfile}>
                <label htmlFor="account-display-name">显示名称</label>
                <input
                  id="account-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.currentTarget.value)}
                  maxLength={80}
                  disabled={busy}
                />

                <label htmlFor="account-phone">手机号</label>
                <div className="account-readonly-field" id="account-phone">
                  <Phone size={16} />
                  <span>{phoneLabel || "未绑定"}</span>
                </div>

                <label htmlFor="account-safety-email">安全邮箱</label>
                <div className="account-input-with-icon">
                  <Mail size={16} />
                  <input
                    id="account-safety-email"
                    type="email"
                    value={safetyEmail}
                    onChange={(event) => setSafetyEmail(event.currentTarget.value)}
                    placeholder="you@example.com"
                    disabled={busy}
                  />
                </div>

                <button type="submit" disabled={busy}>
                  <Save size={16} />
                  <span>{busy ? "保存中" : "保存资料"}</span>
                </button>
              </form>
              {message ? <div className="account-message">{message}</div> : null}
            </section>
          ) : (
            <section className="account-panel">
              <div className="account-panel-heading">
                <div>
                  <div className="section-label">账户</div>
                  <h1>设置</h1>
                </div>
              </div>
              <div className="account-setting-row">
                <div>
                  <strong>本机任务缓存</strong>
                  <span>清除当前浏览器里尚未同步的本地任务历史。</span>
                </div>
                <button type="button" onClick={clearLocalCache}>
                  <Database size={16} />
                  <span>{localCacheCleared ? "已清除" : "清除"}</span>
                </button>
              </div>
              <div className="account-setting-row">
                <div>
                  <strong>登录会话</strong>
                  <span>{phoneLabel || user.email || "当前账户"}</span>
                </div>
                <button type="button" onClick={logout} disabled={busy}>
                  <LogOut size={16} />
                  <span>{busy ? "退出中" : "退出登录"}</span>
                </button>
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
