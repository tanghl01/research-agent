"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  PlayCircle,
  Presentation,
  Route
} from "lucide-react";
import Link from "next/link";
import { isValidElement, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { DataMessagePartProps, FileMessagePartProps } from "@assistant-ui/react";
import { EventType } from "@ag-ui/core";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { AG_UI_EVENT_PART_NAME, OPERATOR_PROGRESS_ACTIVITY_TYPE, isOperatorAgUiEvent, type OperatorAgUiEvent } from "@/lib/ag-ui";
import { artifactDownloadHref, artifactFilename, artifactInlineHref, extensionOf, isArtifactDownloadHref } from "@/lib/artifact-client";

type TextPartProps = {
  text?: string;
  status?: {
    type?: string;
  };
};

type ReasoningPartProps = {
  text?: string;
  status?: {
    type?: string;
  };
};

const markdownComponents: Components = {
  a({ href, children }) {
    const artifact = artifactLinkInfo(href, reactNodeText(children));
    const download = artifact ? <Download aria-hidden size={14} /> : null;
    if (artifact) {
      if (isArtifactDownloadHref(artifact.href)) {
        return (
          <a className="markdown-link" href={artifact.downloadHref} download={artifact.filename}>
            {children}
            {download}
          </a>
        );
      }
      if (artifact.previewKind !== "link") return <ArtifactInlinePreview artifact={artifact} />;
      return (
        <a
          className="markdown-link"
          href={artifact.href}
          download={isArtifactDownloadHref(artifact.href) ? artifact.filename : undefined}
          target={isArtifactDownloadHref(artifact.href) ? undefined : "_blank"}
          rel={isArtifactDownloadHref(artifact.href) ? undefined : "noreferrer"}
        >
          {children}
          {download}
        </a>
      );
    }
    return (
      <Link className="markdown-link" href={href ?? "#"} target={href?.startsWith("http") ? "_blank" : undefined}>
        {children}
        {download}
      </Link>
    );
  },
  code({ className, children }) {
    const match = /language-([a-z0-9_-]+)/iu.exec(className ?? "");
    const code = reactNodeText(children).replace(/\n$/u, "");
    if (!match) {
      return <code className="inline-code">{children}</code>;
    }
    return <CodeBlock language={match[1]} code={code} />;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="markdown-table-wrap">
        <table>{children}</table>
      </div>
    );
  }
};

export function MarkdownTextPart({ text = "", status }: TextPartProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} components={markdownComponents}>
        {normalizeMathDelimiters(formatReadableMarkdown(text))}
      </ReactMarkdown>
      {status?.type === "running" ? <span className="typing-dot" aria-label="正在生成" /> : null}
    </div>
  );
}

type ArtifactPreviewKind = "image" | "pdf" | "presentation" | "document" | "spreadsheet" | "archive" | "model" | "file" | "link";

type ArtifactLinkInfo = {
  href: string;
  inlineHref: string;
  downloadHref: string;
  filename: string;
  extension: string;
  previewKind: ArtifactPreviewKind;
};

function ArtifactInlinePreview({ artifact }: { artifact: ArtifactLinkInfo }) {
  const Icon = artifactIcon(artifact.previewKind);
  const title = artifactTitle(artifact.previewKind);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    window.dispatchEvent(
      new CustomEvent("operator-open-artifact", {
        detail: {
          href: artifact.inlineHref,
          downloadHref: artifact.downloadHref,
          filename: artifact.filename,
          previewKind: artifact.previewKind
        }
      })
    );
  };

  if (artifact.previewKind === "image") {
    return (
      <a className="artifact-inline-card image" href={artifact.inlineHref} target="_blank" rel="noreferrer" onClick={handleClick}>
        <span className="artifact-inline-image-frame">
          <img src={artifact.inlineHref} alt={artifact.filename} loading="lazy" />
        </span>
        <span className="artifact-inline-meta">
          <span>{artifact.filename}</span>
          <small>
            <FileImage size={13} />
            图片
          </small>
        </span>
      </a>
    );
  }

  if (artifact.previewKind === "pdf") {
    return (
      <a className="artifact-inline-card document pdf" href={artifact.inlineHref} target="_blank" rel="noreferrer" onClick={handleClick}>
        <span className="artifact-inline-pdf-frame" aria-hidden>
          <iframe src={`${artifact.inlineHref}#page=1&toolbar=0&navpanes=0&scrollbar=0`} title={`${artifact.filename} 首页预览`} />
        </span>
        <span className="artifact-inline-meta">
          <span>{artifact.filename}</span>
          <small>
            <ExternalLink size={13} />
            打开完整 PDF
          </small>
        </span>
      </a>
    );
  }

  return (
    <a
      className={`artifact-inline-card document ${artifact.previewKind}`}
      href={artifact.inlineHref}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
    >
      <span className="artifact-document-thumb" aria-hidden>
        <Icon size={30} />
      </span>
      <span className="artifact-inline-meta">
        <span>{artifact.filename}</span>
        <small>
          <ExternalLink size={13} />
          {title}
        </small>
      </span>
    </a>
  );
}

function artifactLinkInfo(href: string | undefined, label: string): ArtifactLinkInfo | undefined {
  if (!href?.includes("/api/operator/artifact")) return undefined;
  const inlineHref = artifactInlineHref(href);
  const downloadHref = artifactDownloadHref(href);
  const filename = artifactFilename(href, label);
  const extension = extensionOf(filename || href);
  return {
    href,
    inlineHref,
    downloadHref,
    filename: filename || "artifact",
    extension,
    previewKind: artifactPreviewKind(extension)
  };
}

function artifactPreviewKind(extension: string): ArtifactPreviewKind {
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension)) return "image";
  if (extension === ".pdf") return "pdf";
  if ([".ppt", ".pptx", ".key"].includes(extension)) return "presentation";
  if ([".doc", ".docx"].includes(extension)) return "document";
  if ([".xls", ".xlsx", ".csv"].includes(extension)) return "spreadsheet";
  if ([".zip", ".7z", ".rar", ".tar", ".gz"].includes(extension)) return "archive";
  if ([".step", ".stp", ".cad", ".glb", ".gltf"].includes(extension)) return "model";
  if (extension) return "file";
  return "link";
}

function artifactIcon(kind: ArtifactPreviewKind) {
  switch (kind) {
    case "image":
      return FileImage;
    case "presentation":
      return Presentation;
    case "spreadsheet":
      return FileSpreadsheet;
    case "archive":
      return FileArchive;
    default:
      return FileText;
  }
}

function artifactTitle(kind: ArtifactPreviewKind): string {
  switch (kind) {
    case "presentation":
      return "打开完整演示文稿";
    case "document":
      return "打开完整文档";
    case "spreadsheet":
      return "打开完整表格";
    case "archive":
      return "打开或下载压缩包";
    case "model":
      return "打开模型文件";
    default:
      return "打开文件";
  }
}

export function ReasoningPart({ text = "", status }: ReasoningPartProps) {
  if (!text.trim() && status?.type !== "running") return null;
  return (
    <details className="reasoning-card" open={status?.type === "running"}>
      <summary>模型思考</summary>
      <MarkdownTextPart text={text || "正在思考..."} status={status} />
    </details>
  );
}

export function FilePart(part: FileMessagePartProps) {
  const name = part.filename ?? "附件";
  const href = part.data.startsWith("data:") ? part.data : `data:${part.mimeType};base64,${part.data}`;
  return (
    <a className="file-chip" href={href} download={name}>
      <FileText size={16} />
      <span>{name}</span>
      <small>{part.mimeType}</small>
    </a>
  );
}

export function DataPart({ name, data }: DataMessagePartProps) {
  if (name === AG_UI_EVENT_PART_NAME && isOperatorAgUiEvent(data)) return <OperatorEventPart event={data} />;
  return null;
}

export function OperatorEventPart({ event }: { event: OperatorAgUiEvent }) {
  const view = eventView(event);
  if (!view) return null;
  const Icon = view.tone === "error" ? AlertTriangle : view.tone === "success" ? CheckCircle2 : view.tone === "route" ? Route : PlayCircle;
  return (
    <div className={`agent-event ${view.tone}`}>
      <Icon size={15} />
      <span>{view.label}</span>
      {view.detail ? <small>{view.detail}</small> : null}
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const label = useMemo(() => language.toLowerCase(), [language]);

  return (
    <figure className="code-block">
      <figcaption>
        <span>{label}</span>
        <button type="button" onClick={handleCopy} aria-label="复制代码">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </figcaption>
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </figure>
  );
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeText(node.props.children);
  return "";
}

function normalizeMathDelimiters(text: string): string {
  const lines = text.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/u.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : normalizeInlineMathDelimiters(line);
    })
    .join("\n");
}

function formatReadableMarkdown(text: string): string {
  const normalized = text.replace(/\r\n?/gu, "\n");
  if (!normalized.trim()) return normalized;
  const parts = normalized.split(/(\n{2,})/gu);
  return parts
    .map((part) => {
      if (/^\n{2,}$/u.test(part)) return part;
      return formatReadableBlock(part);
    })
    .join("");
}

function formatReadableBlock(block: string): string {
  if (!block.trim() || hasMarkdownBlockSyntax(block)) return block;
  const compact = block.replace(/[ \t]*\n[ \t]*/gu, " ").trim();
  if (compact.length < 90) return compact;
  const sentences = compact.match(/[^。！？!?；;]+[。！？!?；;”’"）)]*|[^。！？!?；;]+$/gu) ?? [compact];
  const paragraphs: string[] = [];
  let current = "";
  for (const sentence of sentences.map((value) => value.trim()).filter(Boolean)) {
    if (current && `${current}${sentence}`.length > 110) {
      paragraphs.push(current);
      current = sentence;
      continue;
    }
    current = current ? `${current}${sentence}` : sentence;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
}

function hasMarkdownBlockSyntax(block: string): boolean {
  return block.split("\n").some((line) => {
    return /^\s*(```|~~~|#{1,6}\s|[-*+]\s+|\d+\.\s+|>\s+|\|.+\||!\[[^\]]*\]\(|\[[^\]]+\]:)/u.test(line);
  });
}

function normalizeInlineMathDelimiters(line: string): string {
  const parts = line.split(/(`+[^`]*`+)/gu);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\\\[/gu, "$$").replace(/\\\]/gu, "$$").replace(/\\\(/gu, "$").replace(/\\\)/gu, "$");
    })
    .join("");
}

function eventView(event: OperatorAgUiEvent): { label: string; detail?: string; tone: "info" | "route" | "success" | "error" } | null {
  switch (event.type) {
    case EventType.RUN_STARTED:
      return { label: "开始执行任务", detail: event.runId, tone: "info" };
    case EventType.ACTIVITY_SNAPSHOT:
      return event.activityType === OPERATOR_PROGRESS_ACTIVITY_TYPE
        ? null
        : { label: "Agent 活动", detail: event.activityType, tone: "info" };
    case EventType.ACTIVITY_DELTA:
      return null;
    case EventType.STEP_STARTED:
      return { label: "开始步骤", detail: stepLabel(event.stepName), tone: "route" };
    case EventType.STEP_FINISHED:
      return { label: "完成步骤", detail: stepLabel(event.stepName), tone: "success" };
    case EventType.CUSTOM:
      return customEventView(event);
    case EventType.RUN_FINISHED:
      return { label: "任务执行完成", tone: "success" };
    case EventType.RUN_ERROR:
      return { label: "任务执行失败", detail: event.message, tone: "error" };
    case EventType.TEXT_MESSAGE_START:
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_END:
    case EventType.TEXT_MESSAGE_CHUNK:
      return null;
    default:
      return null;
  }
}

function customEventView(event: Extract<OperatorAgUiEvent, { type: EventType.CUSTOM }>) {
  if (event.name === "operator.selected_skills") {
    const skills = Array.isArray(event.value) ? event.value : [];
    if (!skills.length) return null;
    return {
      label: "已选择执行范围",
      detail: skills
        .map((skill) => (isRecord(skill) ? skill.skill : undefined))
        .filter(Boolean)
        .join("、"),
      tone: "route" as const
    };
  }
  if (event.name === "operator.skill_run") {
    const value = isRecord(event.value) ? event.value : {};
    return {
      label: "执行范围运行结果",
      detail: [value.skill, value.status].filter(Boolean).join("："),
      tone: value.status === "failed" ? ("error" as const) : ("success" as const)
    };
  }
  if (event.name === "operator.agent_trace") {
    const value = isRecord(event.value) ? event.value : {};
    const kind = typeof value.kind === "string" ? value.kind : "observation";
    const label = typeof value.label === "string" ? traceLabel(value.label) : "Agent 运行轨迹";
    const detail = [value.tool, value.detail].filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join("：");
    return {
      label,
      detail,
      tone: kind === "error" ? ("error" as const) : kind === "action" ? ("route" as const) : ("info" as const)
    };
  }
  return null;
}

function stepLabel(stepName: string): string {
  const labels: Record<string, string> = {
    scope_selection: "范围选择",
    acp_main_agent: "通用智能体"
  };
  return labels[stepName] ?? stepName;
}

function traceLabel(label: string): string {
  const labels: Record<string, string> = {
    "Main agent attempt": "尝试候选 Agent",
    "Main agent unavailable": "候选 Agent 不可用",
    "Main agent failed": "候选 Agent 执行失败",
    "ACP stream started": "ACP 实时流已启动",
    "Agent output started": "Agent 开始输出",
    "Agent output": "Agent 输出片段",
    "Agent output finished": "Agent 输出结束",
    "Agent tool call": "Agent 调用工具",
    "Agent tool running": "Agent 工具执行中",
    "Agent tool finished": "Agent 工具完成",
    "Agent tool failed": "Agent 工具失败",
    "Agent stream error": "Agent 实时流错误"
  };
  return labels[label] ?? label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
