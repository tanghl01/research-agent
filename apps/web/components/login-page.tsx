"use client";

import { ArrowLeft, KeyRound, LogOut, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { formatAccountName, formatAccountPhone } from "@/lib/account-display";

type LoginPageProps = {
  nextPath: string;
};

type LoginSession = {
  backend: {
    enabled: boolean;
    publicConfigured: boolean;
    serviceConfigured: boolean;
    unverifiedEmailLoginAllowed?: boolean;
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

export function LoginPage({ nextPath }: LoginPageProps) {
  const router = useRouter();
  const [session, setSession] = useState<LoginSession | null>(null);
  const [loginMode, setLoginMode] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeExpiresAt, setCodeExpiresAt] = useState("");
  const [message, setMessage] = useState("");

  const secondsLeft = useCountdownSeconds(codeExpiresAt);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/operator/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: LoginSession) => {
        if (!cancelled) setSession(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setSession({
            backend: { enabled: false, publicConfigured: false, serviceConfigured: false },
            authenticated: false,
            user: null,
            bootstrapAvailable: false,
            error: null
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPhoneCode = async () => {
    const nextPhone = phone.trim();
    if (!nextPhone) {
      setMessage("请输入手机号。");
      return;
    }

    if (session && !session.backend.enabled) {
      setMessage("账户服务尚未启用。");
      return;
    }

    setCodeBusy(true);
    setMessage("");
    const response = await fetch("/api/operator/session/phone-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: nextPhone })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      phone?: string;
      expiresAt?: string;
      debugCode?: string | null;
      error?: string;
    };
    setCodeBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "验证码发送失败。");
      return;
    }
    if (payload.phone) setPhone(payload.phone);
    if (payload.expiresAt) setCodeExpiresAt(payload.expiresAt);
    if (payload.debugCode) setCode(payload.debugCode);
    setMessage(payload.debugCode ? `验证码已生成：${payload.debugCode}` : "验证码已发送。");
  };

  const submitPhoneLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPhone = phone.trim();
    const nextCode = code.trim();
    if (!nextPhone) {
      setMessage("请输入手机号。");
      return;
    }
    if (!nextCode) {
      setMessage("请输入验证码。");
      return;
    }

    if (session && !session.backend.enabled) {
      setMessage("账户服务尚未启用。");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/operator/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "phone",
        phone: nextPhone,
        code: nextCode
      })
    });
    const payload = (await response.json().catch(() => ({}))) as LoginSession & { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "登录失败。");
      return;
    }
    setSession(payload);
    window.dispatchEvent(new Event("operator-account-refresh"));
    setMessage("已登录。");
    router.push(nextPath);
    router.refresh();
  };

  const submitEmailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) {
      setMessage("请输入邮箱。");
      return;
    }

    if (session && !session.backend.enabled) {
      setMessage("账户服务尚未启用。");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/operator/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "email", email: nextEmail })
    });
    const payload = (await response.json().catch(() => ({}))) as LoginSession & { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "登录失败。");
      return;
    }
    setSession(payload);
    window.dispatchEvent(new Event("operator-account-refresh"));
    setMessage("已登录。");
    router.push(nextPath);
    router.refresh();
  };

  const logout = async () => {
    setBusy(true);
    setMessage("");
    await fetch("/api/operator/session/logout", { method: "POST" }).catch(() => undefined);
    setSession((current) => ({
      ...(current ?? {
        backend: { enabled: true, publicConfigured: true, serviceConfigured: true },
        bootstrapAvailable: true,
        error: null
      }),
      authenticated: false,
      user: null
    }));
    window.dispatchEvent(new Event("operator-account-refresh"));
    setBusy(false);
    setMessage("已退出登录。");
    router.refresh();
  };

  const accountEnabled = session?.backend.enabled ?? true;
  const displayName = formatAccountName(session?.user, "已登录账户");
  const accountDetail = formatAccountPhone(session?.user?.phone) || session?.user?.email || "算子账户";
  const registered = Boolean(session?.authenticated && !session.user?.isGuest);
  const emailLoginAvailable = Boolean(session?.backend.unverifiedEmailLoginAllowed);
  const activeLoginMode = emailLoginAvailable ? loginMode : "phone";

  return (
    <main className="login-page">
      <header className="login-topbar">
        <Link className="login-brand" href="/">
          <img src="/brand/operator-logo.svg" alt="" />
          <span>算子</span>
        </Link>
        <Link className="login-return" href={nextPath}>
          <ArrowLeft size={17} />
          <span>返回</span>
        </Link>
      </header>

      <section className="login-panel" aria-label="登录算子">
        <div>
          <div className="section-label">账户</div>
          <h1>登录算子</h1>
        </div>

        {registered ? (
          <div className="login-account">
            <div>
              <strong>{displayName}</strong>
              <span>{accountDetail}</span>
            </div>
            <div className="login-actions">
              <Link href={nextPath}>继续使用</Link>
              <button type="button" onClick={logout} disabled={busy}>
                <LogOut size={16} />
                <span>{busy ? "退出中" : "退出登录"}</span>
              </button>
            </div>
          </div>
        ) : accountEnabled ? (
          <>
            {session?.user?.isGuest ? (
              <div className="login-account guest-account">
                <div>
                  <strong>访客身份</strong>
                  <span>当前任务已临时保存，登录手机号后会继续保留。</span>
                </div>
              </div>
            ) : null}
            {emailLoginAvailable ? (
              <div className="login-mode-tabs" role="tablist" aria-label="登录方式">
                <button
                  type="button"
                  className={activeLoginMode === "phone" ? "active" : ""}
                  onClick={() => setLoginMode("phone")}
                  aria-pressed={activeLoginMode === "phone"}
                >
                  <Phone size={16} />
                  <span>手机号</span>
                </button>
                <button
                  type="button"
                  className={activeLoginMode === "email" ? "active" : ""}
                  onClick={() => setLoginMode("email")}
                  aria-pressed={activeLoginMode === "email"}
                >
                  <Mail size={16} />
                  <span>邮箱</span>
                </button>
              </div>
            ) : null}
            {activeLoginMode === "phone" ? (
              <form className="login-form" onSubmit={submitPhoneLogin}>
                <label htmlFor="operator-login-phone">手机号</label>
                <input
                  id="operator-login-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.currentTarget.value)}
                  placeholder="138 0000 0000"
                  disabled={busy}
                  autoComplete="tel"
                />
                <div className="login-code-row">
                  <div>
                    <label htmlFor="operator-login-code">验证码</label>
                    <input
                      id="operator-login-code"
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.currentTarget.value)}
                      placeholder="000000"
                      disabled={busy}
                      autoComplete="one-time-code"
                    />
                  </div>
                  <button type="button" className="login-secondary-button" onClick={requestPhoneCode} disabled={busy || codeBusy}>
                    <KeyRound size={16} />
                    <span>{codeBusy ? "发送中" : secondsLeft > 0 ? "重新获取" : "获取验证码"}</span>
                  </button>
                </div>
                <button type="submit" disabled={busy}>
                  <Phone size={16} />
                  <span>{busy ? "登录中" : "手机号登录 / 创建账户"}</span>
                </button>
              </form>
            ) : (
              <form className="login-form" onSubmit={submitEmailLogin}>
                <label htmlFor="operator-login-email">邮箱</label>
                <input
                  id="operator-login-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  placeholder="you@example.com"
                  disabled={busy}
                  autoComplete="email"
                />
                <button type="submit" disabled={busy}>
                  <Mail size={16} />
                  <span>{busy ? "登录中" : "邮箱登录 / 绑定"}</span>
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="login-unavailable">账户服务尚未启用。</div>
        )}

        {message ? <div className="login-message">{message}</div> : null}
      </section>
    </main>
  );
}

function useCountdownSeconds(expiresAt: string): number {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(0);
      return;
    }

    const update = () => {
      const next = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(Number.isFinite(next) ? next : 0);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return secondsLeft;
}
