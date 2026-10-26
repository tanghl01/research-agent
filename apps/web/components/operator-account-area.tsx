"use client";

import { ChevronDown, CircleUserRound, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatAccountName, formatAccountPhone } from "@/lib/account-display";

export type AccountSession = {
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

const disabledAccountSession: AccountSession = {
  backend: {
    enabled: false,
    publicConfigured: false,
    serviceConfigured: false
  },
  authenticated: false,
  user: null,
  bootstrapAvailable: false,
  error: null
};

let accountSessionRequest: Promise<AccountSession> | null = null;
let accountBootstrapUserKey: string | null = null;

export function AccountArea({
  onSessionChange,
  placement
}: {
  onSessionChange: (session: AccountSession) => void;
  placement: "sidebar" | "topbar";
}) {
  const router = useRouter();
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshAccountSession = useCallback(
    async (force = false) => {
      try {
        const payload = await loadAccountSession(force);
        setAccountSession(payload);
        onSessionChange(payload);
        const bootstrapUserKey = payload.user?.id ?? null;
        if (payload.authenticated && payload.bootstrapAvailable && bootstrapUserKey !== accountBootstrapUserKey) {
          accountBootstrapUserKey = bootstrapUserKey;
          fetch("/api/operator/session/bootstrap", { method: "POST" }).catch(() => undefined);
        }
      } catch {
        setAccountSession(disabledAccountSession);
        onSessionChange(disabledAccountSession);
      }
    },
    [onSessionChange]
  );

  useEffect(() => {
    void refreshAccountSession(true);
    const handleAccountRefresh = () => void refreshAccountSession(true);
    window.addEventListener("operator-account-refresh", handleAccountRefresh);
    return () => window.removeEventListener("operator-account-refresh", handleAccountRefresh);
  }, [refreshAccountSession]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const registeredUser = accountSession?.authenticated && !accountSession.user?.isGuest ? accountSession.user : null;
  const accountLabel = accountSession?.authenticated
    ? accountSession.user?.isGuest
      ? placement === "topbar"
        ? "登录"
        : "访客"
      : formatAccountName(accountSession.user)
    : "登录";
  const accountDetail = registeredUser ? formatAccountPhone(registeredUser.phone) || registeredUser.email || "算子账户" : "";
  const accountInitial = accountLabel.trim().slice(0, 1).toUpperCase() || "算";

  const handleAccountClick = () => {
    if (registeredUser) {
      setMenuOpen((value) => !value);
      return;
    }
    const next = `${window.location.pathname}${window.location.search}` || "/";
    router.push(`/login?next=${encodeURIComponent(next)}`);
  };

  const logout = async () => {
    setLogoutBusy(true);
    await fetch("/api/operator/session/logout", { method: "POST" }).catch(() => undefined);
    accountSessionRequest = null;
    setMenuOpen(false);
    setLogoutBusy(false);
    await refreshAccountSession(true);
    window.dispatchEvent(new Event("operator-account-refresh"));
    router.refresh();
  };

  return (
    <div ref={menuRef} className={placement === "topbar" ? "account-area topbar-account" : "account-area sidebar-account"}>
      <button
        className="account-button"
        type="button"
        onClick={handleAccountClick}
        aria-haspopup={registeredUser ? "menu" : undefined}
        aria-expanded={registeredUser ? menuOpen : undefined}
      >
        <CircleUserRound size={20} />
        <span>{accountLabel}</span>
        {registeredUser ? <ChevronDown className="account-button-caret" size={15} /> : null}
      </button>
      {registeredUser && menuOpen ? (
        <div className="account-menu" role="menu">
          <div className="account-menu-profile">
            <div className="account-menu-avatar">{accountInitial}</div>
            <div>
              <strong>{accountLabel}</strong>
              <span>{accountDetail}</span>
            </div>
          </div>
          <Link className="account-menu-item" href="/account?tab=profile" role="menuitem" onClick={() => setMenuOpen(false)}>
            <UserRound size={17} />
            <span>个人资料</span>
          </Link>
          <Link className="account-menu-item" href="/account?tab=settings" role="menuitem" onClick={() => setMenuOpen(false)}>
            <Settings size={17} />
            <span>设置</span>
          </Link>
          <button className="account-menu-item account-menu-logout" type="button" role="menuitem" onClick={logout} disabled={logoutBusy}>
            <LogOut size={17} />
            <span>{logoutBusy ? "退出中" : "退出登录"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function loadAccountSession(force = false): Promise<AccountSession> {
  if (!force && accountSessionRequest) return accountSessionRequest;
  accountSessionRequest = fetch("/api/operator/session", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
      return (await response.json()) as AccountSession;
    })
    .catch((error) => {
      accountSessionRequest = null;
      throw error;
    });
  return accountSessionRequest;
}
