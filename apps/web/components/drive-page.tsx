"use client";

import { HardDrive, Home, Loader2, LogIn, RefreshCcw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type DriveObject = {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
  visibility: "private" | "organization" | "project";
};

type DrivePayload = {
  quotaBytes: number;
  usedBytes: number;
  objects: DriveObject[];
};

type DriveSessionPayload = {
  backend?: {
    enabled?: boolean;
  };
  authenticated?: boolean;
};

export function DrivePage() {
  const [payload, setPayload] = useState<DrivePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const usagePercent = useMemo(() => {
    if (!payload?.quotaBytes) return 0;
    return Math.min(100, Math.round((payload.usedBytes / payload.quotaBytes) * 100));
  }, [payload]);

  const loadDrive = async () => {
    setLoading(true);
    setMessage("");
    try {
      const sessionResponse = await fetch("/api/operator/session", { cache: "no-store" });
      if (sessionResponse.ok) {
        const session = (await sessionResponse.json()) as DriveSessionPayload;
        if (session.backend?.enabled && !session.authenticated) {
          setAuthRequired(true);
          setPayload(null);
          return;
        }
      }

      const response = await fetch("/api/operator/drive/objects", { cache: "no-store" });
      const next = await response.json();
      if (response.status === 401) {
        setAuthRequired(true);
        setPayload(null);
        return;
      }
      if (!response.ok) throw new Error(next.error ?? `Drive request failed: ${response.status}`);
      setAuthRequired(false);
      setPayload(next as DrivePayload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setPayload(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrive();
  }, []);

  const uploadFile = async (file: File | undefined) => {
    if (!file || authRequired) return;
    setLoading(true);
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/operator/drive/objects", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Upload failed: ${response.status}`);
      await loadDrive();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteObject = async (objectId: string) => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/operator/drive/objects/${encodeURIComponent(objectId)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Delete failed: ${response.status}`);
      await loadDrive();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="drive-page">
      <header className="drive-topbar">
        <Link className="drive-brand" href="/">
          <img src="/brand/operator-logo.svg" alt="" />
          <span>算子</span>
        </Link>
        <div className="drive-actions">
          <button className="icon-button" type="button" onClick={loadDrive} aria-label="刷新云盘" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
          </button>
          <Link className="icon-button" href="/" aria-label="回到工作台">
            <Home size={18} />
          </Link>
        </div>
      </header>

      <section className="drive-hero">
        <div>
          <div className="section-label">云盘</div>
          <h1>云盘</h1>
        </div>
        {!authRequired ? (
          <label className="drive-upload-button">
            <Upload size={17} />
            <span>上传</span>
            <input ref={fileInputRef} type="file" onChange={(event) => void uploadFile(event.currentTarget.files?.[0])} />
          </label>
        ) : null}
      </section>

      {authRequired ? (
        <section className="drive-login-panel" aria-label="登录云盘">
          <HardDrive size={22} />
          <div>
            <h2>登录后使用云盘</h2>
            <p>你的上传文件、任务产物和保存记录只会显示在自己的账户中。</p>
          </div>
          <Link className="drive-login-link" href="/login?next=/drive">
            <LogIn size={16} />
            <span>登录</span>
          </Link>
          {message ? <div className="drive-message">{message}</div> : null}
        </section>
      ) : (
        <>
          <section className="drive-usage" aria-label="云盘容量">
            <div>
              <strong>{payload ? `${formatBytes(payload.usedBytes)} / ${formatBytes(payload.quotaBytes)}` : "未连接"}</strong>
              <span>{payload ? `${usagePercent}%` : "正在连接"}</span>
            </div>
            <div className="drive-usage-track">
              <div style={{ width: `${usagePercent}%` }} />
            </div>
          </section>

          {message ? <div className="drive-message">{message}</div> : null}

          <section className="drive-list" aria-label="云盘文件列表">
            {payload?.objects.length ? (
              payload.objects.map((object) => (
                <article className="drive-row" key={object.id}>
                  <HardDrive size={18} />
                  <div>
                    <strong>{object.name}</strong>
                    <span>
                      {formatBytes(object.sizeBytes)} · {object.contentType || "application/octet-stream"} · {formatDate(object.createdAt)}
                    </span>
                  </div>
                  <button type="button" aria-label={`删除 ${object.name}`} onClick={() => void deleteObject(object.id)} disabled={loading}>
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <div className="drive-empty">{loading ? "加载中" : "暂无文件"}</div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}
