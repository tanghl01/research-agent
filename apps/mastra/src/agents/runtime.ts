import path from "node:path";
import { AcpAgent, type AcpAgentOptions } from "@mastra/acp";
import {
  DEFAULT_ACP_AGENT_FALLBACK_ORDER,
  DEFAULT_ACP_AGENT_ID,
  getAcpAgentCapabilityConfig,
  listAcpAgentCapabilityConfigs,
  requireEnabledCapability,
  repoRoot,
  type AcpAgentCapabilityConfig
} from "@operator/core";
import { operatorWorkspace } from "../workspace.js";

export const DEFAULT_MAIN_AGENT_ID = DEFAULT_ACP_AGENT_ID;

export const DEFAULT_MAIN_AGENT_FALLBACK_ORDER = DEFAULT_ACP_AGENT_FALLBACK_ORDER;

const DEFAULT_OPERATOR_AGENT_TIMEOUT_SECONDS = 3600;

export type OperatorAgentRuntimeKind = "mastra-acp-agent" | "mastra-workflow";

export type OperatorAgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type OperatorAgentAttachment = {
  path: string;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  sha256?: string;
  contentBase64: string;
};

export type OperatorAgentTraceEvent = {
  kind?: string;
  label?: string;
  tool?: string;
  detail?: string;
  timestamp?: string;
  [key: string]: unknown;
};

export type OperatorAgentTraceHandler = (event: OperatorAgentTraceEvent) => void;

export type OperatorAgentDecision<T> = {
  status: "used" | "skipped" | "failed";
  runtime: OperatorAgentRuntimeKind;
  agentId: string;
  value: T;
  endpoint?: string;
  conversationId?: string;
  trace?: OperatorAgentTraceEvent[];
  errorCode?: string;
  errorDetail?: string;
  error?: string;
  fallbackUsed?: boolean;
  attemptedAgentIds?: string[];
};

export type OperatorAcpAgentConfig = AcpAgentCapabilityConfig;

export type OperatorExternalAgentConfig = OperatorAcpAgentConfig;

const acpAgentCache = new Map<string, AcpAgent>();

export function listMastraAgentImplementations(): Record<string, never> {
  return {};
}

export async function runOperatorAgent(params: {
  agentId?: string;
  messages: OperatorAgentMessage[];
  attachments?: OperatorAgentAttachment[];
  fallback?: string;
  runtimeContext?: Record<string, unknown>;
  timeoutMs?: number;
  onTrace?: OperatorAgentTraceHandler;
}): Promise<OperatorAgentDecision<string>> {
  const fallback = params.fallback ?? "";
  const candidateIds = selectMainAgentCandidateIds(params.agentId);
  const configs = new Map(listEnabledExternalAgentConfigs().map((config) => [config.id, config]));
  const attemptedAgentIds: string[] = [];
  const trace: OperatorAgentTraceEvent[] = [];
  const noConfiguredAgentError =
    "No main agent is configured. Configure codex-acp or another ACP agent, or set OPERATOR_AGENT_FALLBACK_ORDER to registered agent ids.";
  let lastError = noConfiguredAgentError;

  for (const [candidateIndex, agentId] of candidateIds.entries()) {
    const config = configs.get(agentId);
    if (!config) {
      lastError = `Main agent is not registered or not configured: ${agentId}`;
      recordTrace(trace, agentTrace("error", "Main agent unavailable", lastError), params.onTrace);
      continue;
    }

    attemptedAgentIds.push(agentId);
    recordTrace(trace, agentTrace("action", "Main agent attempt", `${agentId} (${config.name})`), params.onTrace);
    const decision = await runAcpAgent({
      agentId,
      agent: getOrCreateAcpAgent(config, runtimeWorkspaceFromContext(params.runtimeContext)),
      messages: params.messages,
      attachments: params.attachments,
      fallback,
      runtimeContext: params.runtimeContext,
      timeoutMs: params.timeoutMs,
      onTrace: params.onTrace
    });

    if (decision.status === "used") {
      return {
        ...decision,
        trace: [...trace, ...(decision.trace ?? [])],
        fallbackUsed: candidateIndex > 0 || Boolean(decision.fallbackUsed),
        attemptedAgentIds
      };
    }

    lastError = decision.error ?? `Main agent failed: ${agentId}`;
    recordTrace(trace, agentTrace("error", "Main agent failed", `${agentId}: ${lastError}`), params.onTrace);
  }

  return {
    status: "failed",
    runtime: runtimeKindForAgent(candidateIds[0]),
    agentId: attemptedAgentIds.at(-1) ?? candidateIds[0] ?? "",
    value: fallback,
    trace,
    error: attemptedAgentIds.length ? lastError : noConfiguredAgentError,
    fallbackUsed: attemptedAgentIds.length > 1 || (attemptedAgentIds.length === 1 && attemptedAgentIds[0] !== candidateIds[0]),
    attemptedAgentIds
  };
}

export function listConfiguredExternalAgentConfigs(): OperatorExternalAgentConfig[] {
  return listAcpAgentCapabilityConfigs();
}

export function listEnabledExternalAgentConfigs(): OperatorExternalAgentConfig[] {
  return listConfiguredExternalAgentConfigs().filter((config) => {
    try {
      requireEnabledCapability(config.id);
      return true;
    } catch {
      return false;
    }
  });
}

export function getConfiguredExternalAgentConfig(agentId: string): OperatorExternalAgentConfig | undefined {
  return getAcpAgentCapabilityConfig(agentId);
}

export function selectMainAgentCandidateIds(explicitAgentId?: string): string[] {
  const explicit = explicitAgentId?.trim();
  if (explicit) return [explicit];

  const configuredDefault = process.env.OPERATOR_DEFAULT_AGENT_SCOPE || process.env.OPERATOR_DEFAULT_AGENT_ID;
  const configuredIds = listConfiguredExternalAgentConfigs().map((config) => config.id);
  const configuredFallbackIds = configuredMainAgentFallbackOrderFromEnv();
  const fallbackIds = configuredFallbackIds?.length ? configuredFallbackIds : [...DEFAULT_MAIN_AGENT_FALLBACK_ORDER];
  const defaultId = configuredDefault?.trim() || (configuredFallbackIds?.length ? fallbackIds[0] : DEFAULT_MAIN_AGENT_ID);
  return uniqueStrings([defaultId, ...fallbackIds, ...(configuredFallbackIds?.length ? [] : configuredIds)]);
}

export function configuredMainAgentFallbackOrder(): string[] {
  const configured = configuredMainAgentFallbackOrderFromEnv();
  return configured?.length ? uniqueStrings(configured) : [...DEFAULT_MAIN_AGENT_FALLBACK_ORDER];
}

function configuredMainAgentFallbackOrderFromEnv(): string[] | undefined {
  const configured =
    parseStringArrayEnv(process.env.OPERATOR_AGENT_FALLBACK_ORDER) ?? parseStringArrayEnv(process.env.OPERATOR_ACP_AGENT_FALLBACK_ORDER);
  return configured?.length ? uniqueStrings(configured) : undefined;
}

function parseStringArrayEnv(value: string | undefined): string[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("[")) return trimmed.split(/[,\s]+/u).filter(Boolean);
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error("fallback order must be a string array.");
  return parsed.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`fallback order item ${index} must be a non-empty string.`);
    return item.trim();
  });
}

async function runAcpAgent(params: {
  agentId: string;
  agent: AcpAgent;
  messages: OperatorAgentMessage[];
  attachments?: OperatorAgentAttachment[];
  fallback: string;
  runtimeContext?: Record<string, unknown>;
  timeoutMs?: number;
  onTrace?: OperatorAgentTraceHandler;
}): Promise<OperatorAgentDecision<string>> {
  return runWithTimeout(
    {
      runtime: "mastra-acp-agent",
      agentId: params.agentId,
      fallback: params.fallback,
      timeoutMs: params.timeoutMs
    },
    async (abortSignal, emitTrace) => {
      emitTrace(agentTrace("action", "ACP stream started", params.agentId));
      emitTrace(agentTrace("action", "Agent output started", "Receiving streamed ACP text."));
      const traceState: AcpStreamTraceState = {
        pendingText: "",
        lastTextTraceAt: 0,
        toolNames: new Map()
      };
      const stream = await params.agent.stream(formatAgentPrompt(params.messages, params.runtimeContext, params.attachments), {
        abortSignal
      });
      try {
        for await (const chunk of readMastraAcpStream(stream.fullStream)) {
          for (const traceEvent of traceEventsFromMastraAcpChunk(chunk, traceState)) emitTrace(traceEvent);
        }
      } catch (error) {
        await stream.text.catch(() => undefined);
        throw error;
      }
      const flushed = flushPendingAcpTextTrace(traceState);
      if (flushed) emitTrace(flushed);
      emitTrace(agentTrace("observation", "Agent output finished", "ACP text stream ended."));
      const text = selectFinalAcpOutputText(await stream.text);
      if (looksLikeAcpTransportFailure(text)) {
        throw new Error(compactText(text, 600) || "ACP agent transport failed.");
      }
      return text;
    },
    params.onTrace
  );
}

async function runWithTimeout(
  identity: {
    runtime: OperatorAgentRuntimeKind;
    agentId: string;
    fallback: string;
    timeoutMs?: number;
  },
  run: (abortSignal: AbortSignal, emitTrace: OperatorAgentTraceHandler) => Promise<string>,
  onTrace?: OperatorAgentTraceHandler
): Promise<OperatorAgentDecision<string>> {
  const timeoutMs =
    identity.timeoutMs ?? Number(process.env.OPERATOR_MASTRA_AGENT_TIMEOUT_SECONDS ?? DEFAULT_OPERATOR_AGENT_TIMEOUT_SECONDS) * 1000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Operator agent timed out after ${timeoutMs}ms.`)), timeoutMs);
  const trace: OperatorAgentTraceEvent[] = [];
  const emitTrace: OperatorAgentTraceHandler = (event) => recordTrace(trace, event, onTrace);
  try {
    const text = (await run(controller.signal, emitTrace)).trim();
    if (!text) {
      return {
        status: "failed",
        runtime: identity.runtime,
        agentId: identity.agentId,
        value: identity.fallback,
        trace,
        error: "Main agent did not produce a final response."
      };
    }
    return {
      status: "used",
      runtime: identity.runtime,
      agentId: identity.agentId,
      value: text,
      trace
    };
  } catch (error) {
    return {
      status: "failed",
      runtime: identity.runtime,
      agentId: identity.agentId,
      value: identity.fallback,
      trace,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getOrCreateAcpAgent(config: OperatorAcpAgentConfig, runtimeWorkspace?: string): AcpAgent {
  const configuredCwd = config.cwd ? resolveEnvValue(config.cwd) : undefined;
  const effectiveCwd = configuredCwd || runtimeWorkspace || repoRoot();
  const additionalDirectories = acpAdditionalDirectories(effectiveCwd, runtimeWorkspace);
  const persistSession = config.persistSession ?? false;
  const cacheKey = JSON.stringify({
    id: config.id,
    command: config.command,
    args: config.args ?? [],
    cwd: effectiveCwd,
    additionalDirectories,
    model: config.model,
    persistSession,
    env: config.env ?? {}
  });
  const cached = acpAgentCache.get(cacheKey);
  if (cached) return cached;

  const options: AcpAgentOptions = {
    id: config.id,
    name: config.name,
    description: config.description,
    command: config.command,
    args: config.args ?? [],
    cwd: effectiveCwd,
    env: { ...stringRecordFromProcessEnv(), ...resolveAgentEnv(config.env ?? {}) },
    model: config.model,
    persistSession,
    session: {
      cwd: effectiveCwd,
      additionalDirectories
    },
    workspace: operatorWorkspace
  };
  const agent = new AcpAgent(options);
  acpAgentCache.set(cacheKey, agent);
  return agent;
}

function runtimeWorkspaceFromContext(runtimeContext?: Record<string, unknown>): string | undefined {
  const workspace = runtimeContext?.workspace_absolute ?? runtimeContext?.workspace;
  return typeof workspace === "string" && workspace.trim() ? workspace.trim() : undefined;
}

function acpAdditionalDirectories(effectiveCwd: string, runtimeWorkspace?: string): string[] {
  return [repoRoot(), runtimeWorkspace]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => pathResolve(candidate))
    .filter((candidate, index, all) => candidate !== pathResolve(effectiveCwd) && all.indexOf(candidate) === index);
}

function pathResolve(value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot(), value);
}

function stringRecordFromProcessEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function resolveAgentEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, resolveEnvValue(value)]));
}

function resolveEnvValue(value: string): string {
  return value.replace(/\$(?:\{([A-Z0-9_]+)\}|([A-Z0-9_]+))/gu, (_match, braced: string, bare: string) => {
    const name = braced ?? bare;
    if (name === "OPERATOR_REPO_ROOT") return process.env.OPERATOR_REPO_ROOT ?? repoRoot();
    return process.env[name] ?? "";
  });
}

function formatAgentPrompt(
  messages: OperatorAgentMessage[],
  runtimeContext?: Record<string, unknown>,
  attachments?: OperatorAgentAttachment[]
): string {
  const context = runtimeContext
    ? [
        "Runtime context:",
        JSON.stringify(runtimeContext, null, 2),
        "Execution constraints: when creating, downloading, or modifying task artifacts, write them inside runtime_context.workspace_absolute or runtime_context.workspace only.",
        ""
      ].join("\n")
    : "";
  const attachmentContext = attachments?.length
    ? [
        "Uploaded attachments:",
        ...attachments.map((attachment) =>
          [
            `- ${attachment.filename}`,
            `path: ${attachment.path}`,
            attachment.mimeType ? `mime_type: ${attachment.mimeType}` : undefined,
            `size_bytes: ${attachment.sizeBytes}`
          ]
            .filter(Boolean)
            .join("; ")
        ),
        "Use the listed workspace-relative paths when the runtime has access to the task workspace.",
        ""
      ].join("\n")
    : "";
  const transcript = messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");
  return `${context}${attachmentContext}Conversation:\n${transcript}`;
}

function looksLikeAcpTransportFailure(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  return (
    normalized.includes("unexpected status 403 Forbidden") ||
    normalized.includes("Authentication required") ||
    normalized.includes("chatgpt.com/backend-api/codex/responses") ||
    normalized.includes("Cloudflare") ||
    normalized.includes("cf-ray")
  );
}

type AcpStreamTraceState = {
  pendingText: string;
  lastTextTraceAt: number;
  toolNames: Map<string, string>;
};

const CODEX_SKILL_CONTEXT_WARNING =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";
const CODEX_SKILL_CONTEXT_WARNING_PATTERN =
  /Warning:\s*Skill descriptions were shortened to fit the 2% skills context budget\.\s*Codex can still see every skill, but some descriptions are shorter\.\s*Disable unused skills or plugins to leave more room for the rest\.\s*/gu;
const FINAL_RESULT_MARKER_PATTERN = /(?:^|[\n\r。；;])\s*((?:最终(?:结果|答案|输出)|Final(?: result| answer| output)?)[:：]\s*[\s\S]*)$/iu;

function selectFinalAcpOutputText(text: string): string {
  const cleaned = stripForwardedCodexWarnings(text).trim();
  const finalResult = FINAL_RESULT_MARKER_PATTERN.exec(cleaned)?.[1]?.trim();
  return finalResult || cleaned;
}

async function* readMastraAcpStream(stream: ReadableStream<unknown>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function traceEventsFromMastraAcpChunk(chunk: unknown, state: AcpStreamTraceState): OperatorAgentTraceEvent[] {
  if (!isRecord(chunk)) return [];
  const type = optionalString(chunk.type);
  const payload = isRecord(chunk.payload) ? chunk.payload : {};
  if (type === "text-delta") return traceEventsFromAcpText(optionalString(payload.text) ?? "", state);
  if (type === "tool-call") {
    const toolCallId = optionalString(payload.toolCallId);
    const toolName = optionalString(payload.toolName) ?? "acp_tool";
    if (toolCallId) state.toolNames.set(toolCallId, toolName);
    return [agentTrace("action", "Agent tool call", [toolName, compactValue(payload.args, 180)].filter(Boolean).join(": "))];
  }
  if (type === "tool-result") {
    const toolCallId = optionalString(payload.toolCallId);
    const toolName = optionalString(payload.toolName) ?? (toolCallId ? state.toolNames.get(toolCallId) : undefined) ?? "acp_tool";
    const isError = payload.isError === true;
    return [
      agentTrace(
        isError ? "error" : "observation",
        isError ? "Agent tool failed" : "Agent tool finished",
        [toolName, compactValue(payload.result, 180)].filter(Boolean).join(": ")
      )
    ];
  }
  return [];
}

function traceEventsFromAcpText(text: string, state: AcpStreamTraceState): OperatorAgentTraceEvent[] {
  if (!text) return [];
  state.pendingText += text;
  state.pendingText = stripForwardedCodexWarnings(state.pendingText);
  if (isPendingForwardedCodexWarning(state.pendingText)) return [];
  const now = Date.now();
  if (state.pendingText.length < 120 && now - state.lastTextTraceAt < 2_000) return [];
  state.lastTextTraceAt = now;
  const detail = compactText(state.pendingText, 220);
  state.pendingText = "";
  return detail ? [agentTrace("observation", "Agent output", detail)] : [];
}

function flushPendingAcpTextTrace(state: AcpStreamTraceState): OperatorAgentTraceEvent | undefined {
  state.pendingText = stripForwardedCodexWarnings(state.pendingText);
  if (isPendingForwardedCodexWarning(state.pendingText)) state.pendingText = "";
  const detail = compactText(state.pendingText, 220);
  state.pendingText = "";
  if (!detail) return undefined;
  state.lastTextTraceAt = Date.now();
  return agentTrace("observation", "Agent output", detail);
}

export function stripForwardedCodexWarnings(text: string): string {
  return text.replace(CODEX_SKILL_CONTEXT_WARNING_PATTERN, "");
}

function isPendingForwardedCodexWarning(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return Boolean(normalized) && CODEX_SKILL_CONTEXT_WARNING.startsWith(normalized);
}

function compactValue(value: unknown, maxLength: number): string {
  if (typeof value === "string") return compactText(value, maxLength);
  if (value === undefined) return "";
  try {
    return compactText(JSON.stringify(value), maxLength);
  } catch {
    return compactText(String(value), maxLength);
  }
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/gu, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function runtimeKindForAgent(agentId: string | undefined): OperatorAgentRuntimeKind {
  const config = agentId ? getConfiguredExternalAgentConfig(agentId) : undefined;
  return config?.runtime ?? "mastra-acp-agent";
}

function agentTrace(kind: "action" | "error" | "observation", label: string, detail: string): OperatorAgentTraceEvent {
  return {
    kind,
    label,
    detail,
    timestamp: new Date().toISOString()
  };
}

function recordTrace(trace: OperatorAgentTraceEvent[], event: OperatorAgentTraceEvent, onTrace?: OperatorAgentTraceHandler): void {
  trace.push(event);
  try {
    onTrace?.(event);
  } catch {
    // Progress callbacks must not change task execution.
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
