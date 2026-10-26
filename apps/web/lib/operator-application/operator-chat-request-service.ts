import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ensureOperatorMessageIds,
  stableOperatorMessageId,
  type OperatorConversationMessage as OperatorChatMessage,
  type OperatorConversationMessageInput as OperatorChatMessageInput
} from "@operator/contracts";
import { rewriteWorkspaceArtifactLinks } from "../artifact-links";
import { mimeTypeFromFilename } from "../file-metadata";
import { compactOperatorMessages, mergeOperatorHistoricalMessages } from "../operator-message-history";
import { readLatestLocalChatRun, resolveLocalRunWorkspace } from "../operator-local-run-files";
import type { LegacyOperatorChatAttachment as OperatorChatAttachment } from "./legacy-mastra-chat-result";

const AGENT_ATTACHMENT_TOTAL_LIMIT_BYTES = 36 * 1024 * 1024;
const AGENT_ATTACHMENT_SINGLE_LIMIT_BYTES = 24 * 1024 * 1024;

export type NormalizedOperatorChatInput = {
  messages: OperatorChatMessage[];
  attachments: OperatorChatAttachment[];
};

type AttachmentCollectionState = {
  workspaceAbsolute: string;
  attachments: OperatorChatAttachment[];
  seenPayloads: Set<string>;
  nextIndex: number;
  forwardedBytes: number;
};

export function normalizeOperatorChatInput(messages: unknown[], workspaceAbsolute: string): NormalizedOperatorChatInput {
  const state: AttachmentCollectionState = {
    workspaceAbsolute,
    attachments: [],
    seenPayloads: new Set(),
    nextIndex: 1,
    forwardedBytes: 0
  };
  const normalizedMessages = compactOperatorMessages(
    messages
      .map((message, index) => {
        if (!isRecord(message)) return undefined;
        const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
        const content = extractMessageText(message, state);
        if (!content.trim()) return undefined;
        const input = {
          id: typeof message.id === "string" ? message.id : undefined,
          role,
          content: content.trim()
        } satisfies OperatorChatMessageInput;
        return {
          ...input,
          id: input.id?.trim() || stableOperatorMessageId(workspaceAbsolute, input, index)
        } satisfies OperatorChatMessage;
      })
      .filter((message): message is OperatorChatMessage => Boolean(message))
      .filter((message) => !shouldDropHistoryMessage(message))
  );
  return { messages: normalizedMessages, attachments: state.attachments };
}

export function mergeWorkspaceAttachments(
  workspaceAbsolute: string,
  currentAttachments: OperatorChatAttachment[]
): OperatorChatAttachment[] {
  const byPath = new Map(currentAttachments.map((attachment) => [attachment.path, attachment]));
  let forwardedBytes = currentAttachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);
  for (const filePath of listFiles(path.join(workspaceAbsolute, "input/attachments"))) {
    const relativePath = toPosix(path.relative(workspaceAbsolute, filePath));
    if (byPath.has(relativePath)) continue;
    const stats = statSync(filePath);
    if (stats.size > AGENT_ATTACHMENT_SINGLE_LIMIT_BYTES || forwardedBytes + stats.size > AGENT_ATTACHMENT_TOTAL_LIMIT_BYTES) {
      continue;
    }
    const content = readFileSync(filePath);
    const filename = displayFilenameFromStoredAttachment(relativePath);
    byPath.set(relativePath, {
      path: relativePath,
      filename,
      mimeType: mimeTypeFromFilename(filename),
      sizeBytes: stats.size,
      sha256: createHash("sha256").update(content).digest("hex"),
      contentBase64: content.toString("base64")
    });
    forwardedBytes += stats.size;
  }
  return [...byPath.values()];
}

export function mergeHistoricalMessages(workspace: string, currentMessages: OperatorChatMessage[]): OperatorChatMessage[] {
  const latest = readLatestLocalChatRun(workspace);
  const request = latest?.request;
  const result = latest?.result;
  const persistedMessages = ensureOperatorMessageIds(request?.messages ?? [], `${workspace}:${latest?.runId ?? "history"}`);
  const history = compactOperatorMessages(
    persistedMessages
      .map((message) => rewriteMessageArtifactLinks(message, workspace))
      .filter((message) => !shouldDropHistoryMessage(message))
  );
  const resultResponse = result?.status === "succeeded" ? rewriteWorkspaceArtifactLinks(result.response?.trim(), workspace) : undefined;
  if (resultResponse) {
    const lastAssistant = [...history]
      .reverse()
      .find((message) => message.role === "assistant")
      ?.content.trim();
    if (lastAssistant !== resultResponse) {
      history.push({
        id: stableOperatorMessageId(`${workspace}:result`, { role: "assistant", content: resultResponse }, history.length),
        role: "assistant",
        content: resultResponse
      });
    }
  }
  return mergeOperatorHistoricalMessages(history, currentMessages);
}

export function resolveRunWorkspaceId(taskId: string): string {
  const workspace = resolveLocalRunWorkspace(taskId);
  return path.basename(workspace);
}

export function resolveServerRunWorkspace(params: { userId: string; projectId: string; conversationId: string; runId: string }): string {
  return [
    "tmp/runs/web/users",
    safeWorkspaceSegment(params.userId),
    "projects",
    safeWorkspaceSegment(params.projectId),
    "conversations",
    safeWorkspaceSegment(params.conversationId),
    "runs",
    safeWorkspaceSegment(params.runId)
  ].join("/");
}

export function titleFromMessages(messages: OperatorChatMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUserMessage) return undefined;
  const normalized = firstUserMessage.content.replace(/\s+/gu, " ").trim();
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

export function titleFromRawMessages(messages: unknown[]): string | undefined {
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
    if (role !== "user") continue;
    const fragments: string[] = [];
    collectRawText(message.content, fragments);
    collectRawText(message.parts, fragments);
    const normalized = fragments.join(" ").replace(/\s+/gu, " ").trim();
    if (normalized) return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
  }
  return undefined;
}

function extractMessageText(message: Record<string, unknown>, state: AttachmentCollectionState): string {
  const fragments: string[] = [];
  collectMessageContent(message.content, fragments, state);
  collectMessageContent(message.parts, fragments, state);
  collectAttachments(message.attachments, fragments, state);
  return fragments.filter((fragment) => fragment.trim()).join("\n\n");
}

function collectMessageContent(value: unknown, fragments: string[], state: AttachmentCollectionState) {
  if (typeof value === "string") {
    fragments.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMessagePart(item, fragments, state);
  }
}

function collectRawText(value: unknown, fragments: string[]): void {
  if (typeof value === "string") {
    fragments.push(value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      fragments.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    if (typeof item.text === "string") fragments.push(item.text);
    if (typeof item.content === "string") fragments.push(item.content);
  }
}

function collectMessagePart(part: unknown, fragments: string[], state: AttachmentCollectionState) {
  if (!isRecord(part)) return;
  if (part.type === "text" && typeof part.text === "string") {
    fragments.push(part.text);
    return;
  }
  if (typeof part.content === "string") {
    fragments.push(part.content);
    return;
  }
  if (isForwardableFilePart(part)) {
    const attachmentText = attachmentPartText(part, state);
    if (attachmentText) fragments.push(attachmentText);
  }
}

function collectAttachments(value: unknown, fragments: string[], state: AttachmentCollectionState) {
  if (!Array.isArray(value)) return;
  for (const attachment of value) {
    if (!isRecord(attachment)) continue;
    collectMessageContent(attachment.content, fragments, state);
    if (!Array.isArray(attachment.content) && isForwardableFilePart(attachment)) {
      const summary = attachmentPartText(attachment, state);
      if (summary) fragments.push(summary);
    }
  }
}

function isForwardableFilePart(part: Record<string, unknown>): boolean {
  if (part.type !== "file" && part.type !== "image") return false;
  return typeof part.url === "string" || typeof part.data === "string" || typeof part.image === "string";
}

function attachmentPartText(part: Record<string, unknown>, state: AttachmentCollectionState): string {
  const filename = stringValue(part.filename) ?? stringValue(part.name) ?? "attachment";
  const mediaType = stringValue(part.mediaType) ?? stringValue(part.mimeType) ?? stringValue(part.contentType);
  const rawData = stringValue(part.url) ?? stringValue(part.data) ?? stringValue(part.image);
  const decoded = rawData ? decodeDataUrl(rawData, mediaType) : undefined;
  if (decoded && !state.seenPayloads.has(rawData ?? "")) {
    state.seenPayloads.add(rawData ?? "");
    const saved = persistUploadedAttachment(state, {
      filename,
      mimeType: decoded.mimeType,
      buffer: decoded.buffer
    });
    const decodedText = decodeTextBuffer(decoded.buffer, decoded.mimeType);
    const textPreview = decodedText ? clampText(decodedText, 200_000) : undefined;
    const truncationMessage =
      decodedText && textPreview && decodedText.length > textPreview.length
        ? `\n[Text attachment preview truncated to ${textPreview.length} characters.]`
        : "";
    const binaryAttachmentText = saved.forwarded
      ? [
          `Uploaded file is available in the agent runtime workspace at: ${saved.attachment.path}`,
          "Read this file directly when the user's request depends on the attachment."
        ].join("\n")
      : [
          `Uploaded file was saved in the Operator task workspace at: ${saved.attachment.path}`,
          "This file exceeds the external agent forwarding limit, so the default external worker may not be able to read it directly."
        ].join("\n");
    return [
      `<attachment name="${filename}" mime="${decoded.mimeType}" path="${saved.attachment.path}" size_bytes="${decoded.buffer.byteLength}">`,
      textPreview ?? binaryAttachmentText,
      truncationMessage,
      "</attachment>"
    ]
      .filter(Boolean)
      .join("\n");
  }

  const decodedText = rawData ? decodeTextDataUrl(rawData, mediaType) : undefined;
  if (decodedText) {
    return [`<attachment name="${filename}"${mediaType ? ` mime="${mediaType}"` : ""}>`, decodedText, "</attachment>"].join("\n");
  }

  const sourceUrl = rawData && !rawData.startsWith("data:") ? rawData : undefined;
  return [`[附件：${filename}`, mediaType ? `，类型：${mediaType}` : "", sourceUrl ? `，位置：${sourceUrl}` : "", "]"].join("");
}

function persistUploadedAttachment(
  state: AttachmentCollectionState,
  params: { filename: string; mimeType: string; buffer: Buffer }
): { attachment: OperatorChatAttachment; forwarded: boolean } {
  const safeName = safeFilename(params.filename);
  const sha256 = createHash("sha256").update(params.buffer).digest("hex");
  const existingPath = findExistingAttachmentPath(state.workspaceAbsolute, sha256, safeName);
  const index = String(state.nextIndex++).padStart(3, "0");
  const relativePath = existingPath ?? `input/attachments/${index}-${sha256.slice(0, 10)}-${safeName}`;
  const target = safeWorkspacePath(state.workspaceAbsolute, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  if (!existsSync(target)) writeFileSync(target, params.buffer);

  const attachment: OperatorChatAttachment = {
    path: relativePath,
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    sha256,
    contentBase64: params.buffer.toString("base64")
  };
  const forwarded = shouldForwardAttachment(state, attachment.sizeBytes);
  if (forwarded) {
    state.forwardedBytes += attachment.sizeBytes;
    state.attachments.push(attachment);
  }
  return { attachment, forwarded };
}

function shouldForwardAttachment(state: AttachmentCollectionState, sizeBytes: number): boolean {
  return sizeBytes <= AGENT_ATTACHMENT_SINGLE_LIMIT_BYTES && state.forwardedBytes + sizeBytes <= AGENT_ATTACHMENT_TOTAL_LIMIT_BYTES;
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return listFiles(absolutePath);
    return entry.isFile() ? [absolutePath] : [];
  });
}

function findExistingAttachmentPath(workspaceAbsolute: string, sha256: string, safeName: string): string | undefined {
  const hashPrefix = sha256.slice(0, 10);
  return listFiles(path.join(workspaceAbsolute, "input/attachments"))
    .map((filePath) => toPosix(path.relative(workspaceAbsolute, filePath)))
    .find((relativePath) => path.posix.basename(relativePath).includes(`${hashPrefix}-${safeName}`));
}

function decodeDataUrl(value: string, fallbackMime?: string): { mimeType: string; buffer: Buffer } | undefined {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/su.exec(value);
  if (!match) return undefined;
  const mimeType = match[1] || fallbackMime || "application/octet-stream";
  const modifiers = match[2] ?? "";
  const payload = match[3] ?? "";
  try {
    const buffer = modifiers.includes(";base64") ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mimeType, buffer };
  } catch {
    return undefined;
  }
}

function decodeTextDataUrl(value: string, fallbackMime?: string): string | undefined {
  const decoded = decodeDataUrl(value, fallbackMime);
  return decoded ? decodeTextBuffer(decoded.buffer, decoded.mimeType) : undefined;
}

function decodeTextBuffer(buffer: Buffer, mimeType: string): string | undefined {
  if (!isTextMime(mimeType)) return undefined;
  return buffer.toString("utf8");
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function isTextMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/markdown",
      "application/xml",
      "application/javascript",
      "application/x-ndjson",
      "image/svg+xml"
    ].includes(normalized)
  );
}

function displayFilenameFromStoredAttachment(relativePath: string): string {
  const basename = path.posix.basename(relativePath);
  return basename.replace(/^\d+-[a-f0-9]{10}-/u, "") || basename;
}

function safeFilename(filename: string): string {
  const basename = path
    .basename(filename)
    .replace(/[^\p{L}\p{N}._() -]+/gu, "_")
    .replace(/\s+/gu, " ")
    .trim();
  return basename && basename !== "." && basename !== ".." ? basename.slice(0, 180) : "attachment";
}

function safeWorkspaceSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.:-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || "unknown";
}

function safeWorkspacePath(workspaceAbsolute: string, relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/gu, "/"));
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Unsafe uploaded attachment path: ${relativePath}`);
  }
  const workspaceRoot = path.resolve(workspaceAbsolute);
  const absolute = path.resolve(workspaceRoot, normalized);
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
  if (absolute !== workspaceRoot && !absolute.startsWith(rootWithSep)) {
    throw new Error(`Uploaded attachment path escapes workspace: ${relativePath}`);
  }
  return absolute;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shouldDropHistoryMessage(message: OperatorChatMessage): boolean {
  if (message.role !== "assistant") return false;
  const normalized = message.content.replace(/\s+/gu, " ").trim();
  if (!normalized) return true;
  if (/^(?:\[附件：[^\]]+\]\s*)+$/u.test(normalized)) return true;
  return (
    normalized.includes("任务执行失败") ||
    normalized.includes("ACP main agent") ||
    normalized.includes("OpenHands Agent Server") ||
    normalized.includes("unexpected status 403 Forbidden") ||
    normalized.includes("Authentication required")
  );
}

function rewriteMessageArtifactLinks(message: OperatorChatMessage, workspace: string): OperatorChatMessage {
  if (message.role !== "assistant") return message;
  return {
    ...message,
    content: rewriteWorkspaceArtifactLinks(message.content, workspace) ?? message.content
  };
}
