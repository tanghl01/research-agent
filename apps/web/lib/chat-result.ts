import type { ArtifactRecord } from "@operator/core";
import type { OperatorConversationMessage as OperatorChatMessage } from "@operator/contracts";
import type { LegacyMastraChatResult } from "./operator-application/legacy-mastra-chat-result";
import { artifactHref, rewriteWorkspaceArtifactLinks } from "./artifact-links";

type SummarizeLegacyMastraChatOptions = {
  artifacts?: ArtifactRecord[];
  messages?: OperatorChatMessage[];
};

const SYSTEM_ARTIFACT_PATHS = new Set([
  "output/chat_request.json",
  "output/chat_plan.json",
  "output/chat_result.json",
  "output/artifact_manifest.json",
  "output/worker_request.json",
  "output/codex_stdout.log",
  "output/codex_stderr.log",
  "output/codex_last_message.txt"
]);

const PRIORITY_EXTENSIONS = [
  ".pptx",
  ".ppt",
  ".pdf",
  ".docx",
  ".doc",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".xlsx",
  ".xls",
  ".csv",
  ".zip",
  ".step",
  ".stp",
  ".cad",
  ".glb",
  ".gltf",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".md",
  ".txt",
  ".json",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css"
];

const CONDITIONAL_DELIVERABLE_EXTENSIONS = new Set([".md", ".txt", ".json", ".py", ".js", ".ts", ".tsx", ".jsx", ".css"]);
const DEFAULT_DELIVERABLE_EXTENSIONS = new Set(
  PRIORITY_EXTENSIONS.filter((extension) => !CONDITIONAL_DELIVERABLE_EXTENSIONS.has(extension))
);
const REPORT_EXTENSIONS = new Set([".md", ".pdf", ".docx", ".doc", ".html", ".htm"]);
const CODE_EXTENSIONS = new Set([".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css"]);

export function summarizeLegacyMastraChatResult(result: LegacyMastraChatResult, options: SummarizeLegacyMastraChatOptions = {}): string {
  const response = rewriteWorkspaceArtifactLinks(result.response?.trim(), result.workspace);
  const targetArtifacts = selectTargetArtifacts(result, options);
  const targetArtifactSection = renderTargetArtifactLinks(result, targetArtifacts, response);

  const lines: string[] = [];

  if (response) {
    lines.push(response);
  } else if (result.status !== "succeeded") {
    lines.push("任务执行失败。");
  }

  if (targetArtifactSection) {
    if (lines.length) lines.push("");
    lines.push(targetArtifactSection);
  }

  if (result.runs.length) {
    const targetPaths = new Set(targetArtifacts.map((artifact) => artifact.path));
    if (lines.length) lines.push("");
    lines.push("执行结果：");
    for (const run of result.runs) {
      lines.push(`- ${run.skill}：${run.status}`);
      for (const artifact of run.artifacts.filter((artifact) => !targetPaths.has(artifact.path))) {
        lines.push(`  - [${artifact.path}](${artifactHref(result.workspace, artifact.path, true)})`);
      }
      if (run.error) lines.push(`  - error: ${run.error}`);
    }
  }

  if (result.agent.error) {
    if (lines.length) lines.push("");
    lines.push(`错误：${result.agent.error}`);
  }

  if (result.agent.error_code || result.agent.error_detail) {
    lines.push(`智能体错误码：${[result.agent.error_code, result.agent.error_detail].filter(Boolean).join(" - ")}`);
  }

  return lines.length ? `${lines.join("\n")}\n` : "";
}

function selectTargetArtifacts(result: LegacyMastraChatResult, options: SummarizeLegacyMastraChatOptions): ArtifactRecord[] {
  const artifacts = dedupeArtifacts(options.artifacts ?? artifactsFromSkillRuns(result));
  const requestedExtensions = requestedArtifactExtensions(options.messages);
  const safeArtifacts = artifacts.filter(isSafeArtifact);
  const mentioned = safeArtifacts.filter((artifact) => isArtifactMentionedInResponse(artifact, result.response));
  const candidates = safeArtifacts.filter((artifact) => isPreferredDeliverableArtifact(artifact, requestedExtensions));
  return (mentioned.length ? mentioned : candidates)
    .sort((left, right) => compareArtifactsByPriority(left, right, requestedExtensions))
    .slice(0, 12);
}

function artifactsFromSkillRuns(result: LegacyMastraChatResult): ArtifactRecord[] {
  return result.runs.flatMap((run) =>
    run.artifacts.map((artifact) => ({
      name: artifact.name ?? artifact.path.split("/").at(-1) ?? artifact.path,
      type: artifact.type ?? (extensionOfPath(artifact.path).slice(1) || "file"),
      path: artifact.path,
      mime_type: "",
      size_bytes: 0,
      sha256: "",
      step_id: `skill_${run.skill}`,
      metadata: {
        skill: run.skill,
        description: artifact.description
      }
    }))
  );
}

function isSafeArtifact(artifact: ArtifactRecord): boolean {
  const normalizedPath = artifact.path.replace(/\\/gu, "/");
  const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
  if (!normalizedPath || basename.startsWith(".")) return false;
  if (SYSTEM_ARTIFACT_PATHS.has(normalizedPath)) return false;
  if (artifact.step_id === "operator_chat") return false;
  if (normalizedPath.startsWith("input/") || normalizedPath.startsWith("attempts/")) return false;
  if (/(?:^|\/)(?:worker_request|codex_stdout|codex_stderr|codex_last_message)\./u.test(normalizedPath)) return false;
  if (/(?:^|\/)(?:logs?|tmp|temp|cache|scratch)(?:\/|$)/iu.test(normalizedPath)) return false;
  if (/\.(?:log|tmp|lock|pyc|pyo)$/iu.test(normalizedPath)) return false;
  return true;
}

function isPreferredDeliverableArtifact(artifact: ArtifactRecord, requestedExtensions: Set<string>): boolean {
  const normalizedPath = artifact.path.replace(/\\/gu, "/");
  const extension = extensionOfArtifact(artifact);
  return DEFAULT_DELIVERABLE_EXTENSIONS.has(extension) || requestedExtensions.has(extension) || looksLikeFinalNamedArtifact(normalizedPath);
}

function requestedArtifactExtensions(messages: OperatorChatMessage[] | undefined): Set<string> {
  const text =
    [...(messages ?? [])]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.toLowerCase() ?? "";
  const extensions = new Set<string>();

  addWhen(extensions, /\.(pptx?|powerpoint)\b|ppt|幻灯片|演示文稿|课件/u.test(text), [".pptx", ".ppt"]);
  addWhen(extensions, /\bhtml?\b|网页|网站|web\s?page/u.test(text), [".html", ".htm"]);
  addWhen(extensions, /图片|图像|插图|配图|海报|示意图|流程图|\b(?:png|jpe?g|svg|webp|gif|image|figure)\b/u.test(text), [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg"
  ]);
  addWhen(extensions, /\bpdf\b|试卷|真题|论文|paper/u.test(text), [".pdf"]);
  addWhen(extensions, /word|docx?|文档/u.test(text), [".docx", ".doc"]);
  addWhen(extensions, /excel|xlsx?|表格|数据表|\bcsv\b/u.test(text), [".xlsx", ".xls", ".csv"]);
  addWhen(extensions, /数据集|数据文件|\b(?:dataset|data)\b/u.test(text), [".xlsx", ".xls", ".csv", ".json"]);
  addWhen(extensions, /压缩包|zip|打包/u.test(text), [".zip"]);
  addWhen(extensions, /\b(?:step|stp|cad|glb|gltf)\b|三维|3d|模型/u.test(text), [".step", ".stp", ".cad", ".glb", ".gltf"]);
  addWhen(extensions, /报告|文稿|markdown|\bmd\b/u.test(text), [...REPORT_EXTENSIONS]);
  addWhen(extensions, /文本文件|\btxt\b|plain text/u.test(text), [".txt"]);
  addWhen(extensions, /代码|脚本|程序|项目|加法器|\b(?:python|javascript|typescript|react|css)\b/u.test(text), [...CODE_EXTENSIONS]);

  return extensions;
}

function renderTargetArtifactLinks(result: LegacyMastraChatResult, artifacts: ArtifactRecord[], response: string | undefined): string {
  if (!artifacts.length) return "";
  const links = responseArtifactLinks(response);
  const rows = artifacts
    .map((artifact) => {
      const label = artifactDisplayName(artifact);
      const previewHref = artifactHref(result.workspace, artifact.path);
      const downloadHref = artifactHref(result.workspace, artifact.path, true);
      const linkParts = [
        links.includes(previewHref) ? undefined : `[预览 ${label}](${previewHref})`,
        links.includes(downloadHref) ? undefined : `[下载 ${label}](${downloadHref})`
      ].filter(Boolean);
      if (!linkParts.length) return undefined;
      const meta = [artifact.type, artifact.size_bytes ? formatBytes(artifact.size_bytes) : undefined].filter(Boolean).join("，");
      return `- ${linkParts.join(" / ")}${meta ? `（${meta}）` : ""}`;
    })
    .filter((row): row is string => Boolean(row));
  return rows.length ? ["目标产物：", ...rows].join("\n") : "";
}

function responseArtifactLinks(response: string | undefined): string[] {
  if (!response) return [];
  const links: string[] = [];
  for (const [, href] of response.matchAll(/\[[^\]]+\]\(([^)\n]+)\)/gu)) {
    links.push(normalizeResponseHref(href));
  }
  for (const [, , href] of response.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1/giu)) {
    links.push(normalizeResponseHref(href));
  }
  return links;
}

function normalizeResponseHref(href: string): string {
  return href.replace(/&amp;/gu, "&").trim();
}

function addWhen(target: Set<string>, condition: boolean, extensions: string[]): void {
  if (!condition) return;
  for (const extension of extensions) target.add(extension);
}

function dedupeArtifacts(artifacts: ArtifactRecord[]): ArtifactRecord[] {
  const byPath = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    if (!byPath.has(artifact.path)) byPath.set(artifact.path, artifact);
  }
  return [...byPath.values()];
}

function compareArtifactsByPriority(left: ArtifactRecord, right: ArtifactRecord, requestedExtensions: Set<string>): number {
  const leftPriority = priorityOf(left, requestedExtensions);
  const rightPriority = priorityOf(right, requestedExtensions);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (left.size_bytes !== right.size_bytes) return right.size_bytes - left.size_bytes;
  return left.path.localeCompare(right.path);
}

function priorityOf(artifact: ArtifactRecord, requestedExtensions: Set<string>): number {
  const extension = extensionOfArtifact(artifact);
  const requestedBoost = requestedExtensions.has(extension) ? -100 : 0;
  const index = PRIORITY_EXTENSIONS.indexOf(extension);
  return requestedBoost + (index === -1 ? PRIORITY_EXTENSIONS.length : index);
}

function isArtifactMentionedInResponse(artifact: ArtifactRecord, response: string | undefined): boolean {
  const text = response?.toLowerCase() ?? "";
  if (!text) return false;
  const normalizedPath = artifact.path.replace(/\\/gu, "/").toLowerCase();
  const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
  const name = artifact.name.toLowerCase();
  return text.includes(normalizedPath) || text.includes(basename) || Boolean(name && text.includes(name));
}

function looksLikeFinalNamedArtifact(artifactPath: string): boolean {
  return /(?:^|\/)(?:final|result|report|deck|slides?|presentation|poster|download|output)[^/]*\.[a-z0-9]+$/iu.test(artifactPath);
}

function artifactDisplayName(artifact: ArtifactRecord): string {
  const basename = artifact.path.split("/").at(-1) ?? artifact.path;
  const name = artifact.name && artifact.name !== basename ? `${artifact.name} (${basename})` : basename;
  return name.replace(/\]/gu, "\\]");
}

function extensionOfArtifact(artifact: ArtifactRecord): string {
  return extensionOfPath(artifact.path);
}

function extensionOfPath(filePath: string): string {
  const basename = filePath.split(/[\\/]/u).at(-1) ?? filePath;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(dot).toLowerCase() : "";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
