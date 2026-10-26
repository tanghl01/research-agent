"use client";

import { isActiveRunStatus, isRunStatus, type RunStatus } from "@operator/contracts";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FilePenLine,
  FileText,
  HardDrive,
  Loader2,
  Save,
  Upload,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownTextPart } from "@/components/message-content";
import {
  artifactFilenameFromHref,
  artifactIdFromHref,
  artifactPathFromHref,
  extensionOf,
  mimeTypeFromFilename,
  operatorBaseUrl,
  withArtifactDownloadParam
} from "@/lib/artifact-client";

type TaskDetail = {
  taskId?: string;
  workspace?: string;
  exists: boolean;
  latestRun?: {
    status?: RunStatus;
  };
  request?: {
    run_id?: string;
    messages?: Array<{ id: string; role: "user" | "assistant" | "system"; content: string }>;
  };
  plan?: {
    phase?: string;
    trace?: TraceEvent[];
    error?: string;
    error_code?: string;
    error_detail?: string;
  };
  result?: {
    run_id: string;
    status: "succeeded" | "failed";
    response?: string;
    selected_skills: Array<{ skill: string; reason?: string }>;
    runs: Array<{ skill: string; status: string; error?: string }>;
    agent: {
      endpoint?: string;
      conversation_id?: string;
      conversation_ids?: string[];
      trace?: TraceEvent[];
      error?: string;
      error_code?: string;
      error_detail?: string;
    };
  };
  artifacts?: ArtifactItem[];
};

type TraceEvent = {
  kind: "action" | "observation" | "error";
  label: string;
  detail?: string;
  tool?: string;
  timestamp?: string;
};

type ArtifactItem = {
  name: string;
  type: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  href: string;
  downloadHref: string;
  preview?: string;
};

type ArtifactViewMode = "preview" | "source";
type OfficePreviewMetadata = {
  pageCount?: number;
};

export function ArtifactPreview({
  localHistoryMode = false,
  selectedFilename,
  taskId,
  selectedHref,
  onClose
}: {
  localHistoryMode?: boolean;
  selectedFilename?: string;
  taskId?: string;
  selectedHref?: string;
  onClose?: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>();

  useEffect(() => {
    if (!taskId) {
      setDetail(null);
      setSelectedKey(selectedHref);
      return;
    }
    setSelectedKey(selectedHref);
    let cancelled = false;
    let pollTimer: number | undefined;
    const loadDetail = () => {
      const params = new URLSearchParams({ taskId });
      if (localHistoryMode) params.set("source", "browser-local");
      fetch(`/api/operator/task-detail?${params.toString()}`)
        .then((response) => response.json())
        .then((payload: TaskDetail) => {
          if (cancelled) return;
          setDetail(payload);
          if (selectedHref) setSelectedKey(selectedHref);
          if (shouldPollTaskDetail(payload)) {
            pollTimer = window.setTimeout(loadDetail, 2500);
          }
        })
        .catch(() => {
          if (!cancelled) setDetail(null);
        });
    };
    loadDetail();
    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [localHistoryMode, selectedHref, taskId]);

  useEffect(() => {
    if (selectedHref) setSelectedKey(selectedHref);
  }, [selectedHref]);

  const artifacts = detail?.artifacts ?? [];
  const selectedArtifact = findArtifactByKey(artifacts, selectedKey) ?? linkedArtifactFromHref(selectedKey, selectedFilename);

  return (
    <aside className="preview-pane document-workspace" aria-label="文件工作区">
      <button className="preview-close-button document-workspace-close" type="button" aria-label="关闭文件工作区" onClick={onClose}>
        <X size={17} />
      </button>

      {selectedArtifact ? <ArtifactPreviewSection artifact={selectedArtifact} /> : <WorkspaceEmpty />}
    </aside>
  );
}

function shouldPollTaskDetail(detail: TaskDetail): boolean {
  if (!detail.exists || detail.result) return false;
  if (detail.latestRun?.status) return isActiveRunStatus(detail.latestRun.status);
  return isRunStatus(detail.plan?.phase) && isActiveRunStatus(detail.plan.phase);
}

function findArtifactByKey(artifacts: ArtifactItem[], key: string | undefined): ArtifactItem | undefined {
  if (!key) return undefined;
  return artifacts.find(
    (artifact) =>
      artifact.path === key || artifact.href === key || artifact.downloadHref === key || artifact.path === artifactPathFromHref(key)
  );
}

function linkedArtifactFromHref(href: string | undefined, fallbackFilename?: string): ArtifactItem | undefined {
  if (!href?.includes("/api/operator/artifact")) return undefined;
  const filename = fallbackFilename || artifactFilenameFromHref(href);
  const path = artifactPathFromHref(href) ?? filename;
  return {
    name: filename,
    type: extensionOf(filename).slice(1) || "file",
    path,
    mime_type: mimeTypeFromFilename(filename),
    size_bytes: 0,
    href,
    downloadHref: withArtifactDownloadParam(href, true)
  };
}

function ArtifactPreviewSection({ artifact }: { artifact: ArtifactItem }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingText, setLoadingText] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [viewMode, setViewMode] = useState<ArtifactViewMode>("preview");
  const [editorText, setEditorText] = useState(artifact.preview ?? "");
  const [savedText, setSavedText] = useState(artifact.preview ?? "");
  const canEditText = isEditableTextArtifact(artifact);
  const legacyTarget = legacyArtifactEditTarget(artifact.href);
  const sourceMode = canEditText && viewMode === "source";
  const canCopy = canEditText && Boolean(editorText || artifact.preview);
  const artifactId = artifactIdFromHref(artifact.href);

  useEffect(() => {
    let cancelled = false;
    setSaveMessage("");
    setCopied(false);
    setViewMode("preview");
    setEditorText(artifact.preview ?? "");
    setSavedText(artifact.preview ?? "");
    if (!canEditText) return;
    if (artifact.preview !== undefined) return;
    setLoadingText(true);
    fetch(artifact.href, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`读取失败：${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (cancelled) return;
        setEditorText(text);
        setSavedText(text);
      })
      .catch((error) => {
        if (!cancelled) setSaveMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingText(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.href, artifact.preview, canEditText]);

  const copyPreview = async () => {
    const text = editorText || artifact.preview;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const saveText = async () => {
    if (!legacyTarget) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const response = await fetch(legacyTarget.href, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: editorText })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `保存失败：${response.status}`);
      setSavedText(editorText);
      setSaveMessage("已保存到任务工作区");
      setViewMode("preview");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const replaceFile = async (file: File | undefined) => {
    if (!file || !legacyTarget) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const contentBase64 = await fileToBase64(file);
      const response = await fetch(legacyTarget.href, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentBase64 })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `替换失败：${response.status}`);
      setSaveMessage("文件已替换");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const saveToDrive = async () => {
    if (!artifactId) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const response = await fetch("/api/operator/drive/save-artifact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Save failed: ${response.status}`);
      setSaveMessage("已保存到 Drive");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="preview-section artifact-preview-section">
      <div className="preview-actions">
        <a href={artifact.href} target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          <span>打开</span>
        </a>
        <a href={artifact.downloadHref}>
          <Download size={15} />
          <span>下载</span>
        </a>
        {canEditText ? (
          <button type="button" onClick={() => setViewMode((mode) => (mode === "source" ? "preview" : "source"))}>
            {sourceMode ? <Eye size={15} /> : <FilePenLine size={15} />}
            <span>{sourceMode ? "预览" : "编辑"}</span>
          </button>
        ) : null}
        {canCopy ? (
          <button type="button" onClick={copyPreview}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        ) : null}
        {sourceMode && legacyTarget ? (
          <button type="button" onClick={saveText} disabled={saving || loadingText || editorText === savedText}>
            {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            <span>保存</span>
          </button>
        ) : null}
        {legacyTarget ? (
          <label className="preview-upload-button">
            <Upload size={15} />
            <span>替换文件</span>
            <input type="file" onChange={(event) => void replaceFile(event.currentTarget.files?.[0])} />
          </label>
        ) : null}
        {artifactId ? (
          <button type="button" onClick={saveToDrive} disabled={saving}>
            {saving ? <Loader2 className="spin" size={15} /> : <HardDrive size={15} />}
            <span>保存到 Drive</span>
          </button>
        ) : null}
      </div>
      {saveMessage ? <p className="preview-muted">{saveMessage}</p> : null}
      <div className="artifact-preview-body">
        <ArtifactPreviewBody
          artifact={artifact}
          canEditText={canEditText}
          editorText={editorText}
          loadingText={loadingText}
          viewMode={viewMode}
          onEditorTextChange={setEditorText}
        />
      </div>
    </section>
  );
}

function ArtifactPreviewBody({
  artifact,
  canEditText,
  editorText,
  loadingText,
  viewMode,
  onEditorTextChange
}: {
  artifact: ArtifactItem;
  canEditText: boolean;
  editorText: string;
  loadingText: boolean;
  viewMode: ArtifactViewMode;
  onEditorTextChange: (text: string) => void;
}) {
  if (canEditText && viewMode === "source") {
    return (
      <div className="document-editor">
        <textarea
          value={editorText}
          onChange={(event) => onEditorTextChange(event.target.value)}
          spellCheck={false}
          aria-label="编辑文件内容"
          placeholder={loadingText ? "正在读取文件..." : "文件内容为空"}
        />
      </div>
    );
  }

  if (canEditText) {
    return <CompiledTextPreview artifact={artifact} sourceText={editorText || artifact.preview || ""} loadingText={loadingText} />;
  }

  if (isImageArtifact(artifact)) {
    return (
      <a className="artifact-preview-media" href={artifact.href} target="_blank" rel="noreferrer">
        <img src={artifact.href} alt={artifact.name} />
      </a>
    );
  }

  if (isOfficeArtifact(artifact)) {
    return <OfficeArtifactPreview artifact={artifact} />;
  }

  if (isPdfArtifact(artifact)) {
    return (
      <div className="document-frame-wrap">
        <iframe src={artifact.href} title={`${artifact.name} 可视化预览`} />
      </div>
    );
  }

  if (!artifact.preview) {
    return <p className="preview-muted">该文件类型可打开或下载查看；本地工作区文件也可以用“替换文件”更新。</p>;
  }

  if (isMarkdownArtifact(artifact)) {
    return <MarkdownTextPart text={artifact.preview} />;
  }

  return <pre className="artifact-preview-code">{artifact.preview}</pre>;
}

function WorkspaceEmpty() {
  return (
    <div className="artifact-empty">
      <FileText size={22} />
      <p>从对话中点击 Word、PPT、Markdown 或其他文件后，这里会打开文件并支持编辑。</p>
    </div>
  );
}

function OfficeArtifactPreview({ artifact }: { artifact: ArtifactItem }) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPage(1);
    setPageCount(1);
    setError("");
    fetch(officeMetadataPreviewHref(artifact.href), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`预览信息读取失败：${response.status}`);
        return response.json() as Promise<OfficePreviewMetadata>;
      })
      .then((metadata) => {
        if (cancelled) return;
        const nextPageCount = Number(metadata.pageCount ?? 1);
        setPageCount(Number.isFinite(nextPageCount) && nextPageCount > 0 ? nextPageCount : 1);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.href]);

  const safePage = Math.min(page, pageCount);
  const canGoBack = safePage > 1;
  const canGoForward = safePage < pageCount;

  return (
    <div className="office-preview-shell">
      <div className="office-preview-toolbar" aria-label="PPT 页面导航">
        <button type="button" aria-label="上一页" disabled={!canGoBack} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
          <ChevronLeft size={15} />
        </button>
        <span>
          第 {safePage} / {pageCount} 页
        </span>
        <button
          type="button"
          aria-label="下一页"
          disabled={!canGoForward}
          onClick={() => setPage((value) => Math.min(value + 1, pageCount))}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      {error ? <p className="preview-muted">{error}</p> : null}
      <a className="artifact-preview-media office-preview-media" href={artifact.href} target="_blank" rel="noreferrer">
        <img key={`${artifact.href}:${safePage}`} src={officePngPreviewHref(artifact.href, safePage)} alt={artifact.name} />
      </a>
    </div>
  );
}

function CompiledTextPreview({ artifact, sourceText, loadingText }: { artifact: ArtifactItem; sourceText: string; loadingText: boolean }) {
  if (isHtmlArtifact(artifact)) {
    return (
      <div className="document-frame-wrap">
        {sourceText ? (
          <iframe sandbox="allow-forms allow-modals allow-popups allow-scripts" srcDoc={sourceText} title={`${artifact.name} 预览`} />
        ) : (
          <iframe sandbox="allow-forms allow-modals allow-popups allow-scripts" src={artifact.href} title={`${artifact.name} 预览`} />
        )}
      </div>
    );
  }

  if (isSvgArtifact(artifact)) {
    return (
      <div className="document-frame-wrap compact">
        {sourceText ? (
          <iframe sandbox="" srcDoc={sourceText} title={`${artifact.name} 预览`} />
        ) : (
          <iframe sandbox="" src={artifact.href} title={`${artifact.name} 预览`} />
        )}
      </div>
    );
  }

  if (isMarkdownArtifact(artifact)) {
    return (
      <div className="document-rendered-preview">
        <MarkdownTextPart text={sourceText || (loadingText ? "正在生成预览..." : " ")} />
      </div>
    );
  }

  if (isTeXArtifact(artifact)) {
    return (
      <div className="document-rendered-preview">
        <MarkdownTextPart text={latexToMarkdownPreview(sourceText) || (loadingText ? "正在生成预览..." : " ")} />
      </div>
    );
  }

  if (loadingText && !sourceText) {
    return <p className="preview-muted">正在生成预览...</p>;
  }

  return <pre className="artifact-preview-code">{formattedTextPreview(artifact, sourceText)}</pre>;
}

function isImageArtifact(artifact: ArtifactItem): boolean {
  const path = artifact.path.toLowerCase();
  return (
    artifact.mime_type.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].some((extension) => path.endsWith(extension))
  );
}

function isMarkdownArtifact(artifact: ArtifactItem): boolean {
  return artifact.mime_type.includes("markdown") || artifact.path.toLowerCase().endsWith(".md");
}

function isHtmlArtifact(artifact: ArtifactItem): boolean {
  const path = artifact.path.toLowerCase();
  return artifact.mime_type.includes("html") || path.endsWith(".html") || path.endsWith(".htm");
}

function isSvgArtifact(artifact: ArtifactItem): boolean {
  return artifact.mime_type.includes("svg") || artifact.path.toLowerCase().endsWith(".svg");
}

function isTeXArtifact(artifact: ArtifactItem): boolean {
  return [".tex", ".latex"].includes(extensionOf(artifact.path || artifact.name));
}

function isEditableTextArtifact(artifact: ArtifactItem): boolean {
  const extension = extensionOf(artifact.path || artifact.name);
  return (
    artifact.mime_type.startsWith("text/") ||
    artifact.mime_type.includes("json") ||
    isXmlMimeType(artifact.mime_type) ||
    [
      ".md",
      ".markdown",
      ".txt",
      ".json",
      ".csv",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".py",
      ".css",
      ".html",
      ".htm",
      ".svg",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".sql",
      ".tex",
      ".latex"
    ].includes(extension)
  );
}

function isXmlMimeType(mimeType: string): boolean {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized === "application/xml" || normalized === "text/xml" || normalized.endsWith("+xml");
}

function isPdfArtifact(artifact: ArtifactItem): boolean {
  return artifact.mime_type.includes("pdf") || artifact.path.toLowerCase().endsWith(".pdf");
}

function isOfficeArtifact(artifact: ArtifactItem): boolean {
  const extension = extensionOf(artifact.path || artifact.name);
  return [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extension);
}

function legacyArtifactEditTarget(href: string): { href: string; workspace: string; path: string } | undefined {
  try {
    const url = new URL(href, operatorBaseUrl());
    if (url.pathname !== "/api/operator/artifact") return undefined;
    const workspace = url.searchParams.get("workspace");
    const artifactPath = url.searchParams.get("path");
    if (!workspace || !artifactPath) return undefined;
    const source = url.searchParams.get("source");
    const params = new URLSearchParams({ workspace, path: artifactPath });
    if (source) params.set("source", source);
    return { href: `/api/operator/artifact?${params.toString()}`, workspace, path: artifactPath };
  } catch {
    return undefined;
  }
}

function officeMetadataPreviewHref(href: string): string {
  return officePreviewHref(href, "metadata");
}

function officePngPreviewHref(href: string, page: number): string {
  return officePreviewHref(href, "png", page);
}

function officePreviewHref(href: string, preview: "metadata" | "png", page?: number): string {
  try {
    const url = new URL(href, operatorBaseUrl());
    const isLegacyArtifact = url.pathname === "/api/operator/artifact";
    const isRegisteredArtifact = /^\/api\/operator\/artifacts\/[0-9a-f-]+\/download$/iu.test(url.pathname);
    if (!isLegacyArtifact && !isRegisteredArtifact) return href;
    url.searchParams.delete("download");
    url.searchParams.set("preview", preview);
    if (page !== undefined) url.searchParams.set("page", String(page));
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? (value.split(",").at(-1) ?? "") : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formattedTextPreview(artifact: ArtifactItem, sourceText: string): string {
  if ((artifact.mime_type.includes("json") || artifact.path.toLowerCase().endsWith(".json")) && sourceText.trim()) {
    try {
      return JSON.stringify(JSON.parse(sourceText), null, 2);
    } catch {
      return sourceText;
    }
  }
  return sourceText;
}

function latexToMarkdownPreview(sourceText: string): string {
  return sourceText
    .replace(/^\s*%.*$/gmu, "")
    .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/gu, "")
    .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/gu, "")
    .replace(/\\title\{([^}]*)\}/gu, "# $1\n")
    .replace(/\\author\{([^}]*)\}/gu, "_$1_\n")
    .replace(/\\date\{([^}]*)\}/gu, "$1\n")
    .replace(/\\maketitle/gu, "")
    .replace(/\\begin\{document\}|\\end\{document\}/gu, "")
    .replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/gu, "\n\n> $1\n\n")
    .replace(/\\section\*?\{([^}]*)\}/gu, "\n\n## $1\n\n")
    .replace(/\\subsection\*?\{([^}]*)\}/gu, "\n\n### $1\n\n")
    .replace(/\\subsubsection\*?\{([^}]*)\}/gu, "\n\n#### $1\n\n")
    .replace(/\\begin\{(?:equation|align)\*?\}/gu, "\n$$\n")
    .replace(/\\end\{(?:equation|align)\*?\}/gu, "\n$$\n")
    .replace(/\\begin\{itemize\}|\\end\{itemize\}/gu, "\n")
    .replace(/\\item\s+/gu, "- ")
    .replace(/\\textbf\{([^}]*)\}/gu, "**$1**")
    .replace(/\\emph\{([^}]*)\}/gu, "*$1*")
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
