"use client";

import { EventType } from "@ag-ui/core";
import { useChat } from "@ai-sdk/react";
import {
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState
} from "@assistant-ui/react";
import { AssistantChatTransport, useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ClipboardCheck,
  Copy,
  FilePenLine,
  FileSearch,
  FileText,
  Paperclip,
  Scale,
  SearchCheck,
  ShieldCheck,
  Square,
  UserRound,
  X
} from "lucide-react";
import { type KeyboardEvent, type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DataPart, FilePart, MarkdownTextPart, ReasoningPart } from "@/components/message-content";
import { AnyFileAttachmentAdapter } from "@/components/operator-thread/attachment-adapter";
import {
  fallbackRunningEvents,
  fetchHistoryMessages,
  fetchTaskSnapshot,
  historyMessagesToUiMessages,
  type HistoryMessage,
  isRunningTaskPhase,
  normalizeSnapshotEvents,
  normalizeSnapshotMessages,
  operatorThreadUiMessagesEqual,
  preloadHistoryMessages,
  type OperatorThreadUiMessage,
  snapshotAgUiPayload,
  snapshotMessagePayload,
  snapshotPhase,
  snapshotRunId,
  type RestoredRunState
} from "@/components/operator-thread/history";
import { RunCompletionSubscriber } from "@/components/operator-thread/run-completion-subscriber";
import {
  AG_UI_EVENT_PART_NAME,
  AG_UI_EVENT_PART_TYPE,
  isOperatorAgUiEvent,
  OPERATOR_PROGRESS_ACTIVITY_TYPE,
  type OperatorAgUiEvent
} from "@/lib/ag-ui";
import type { ScopeGroup, ScopeItem } from "@/lib/scopes";
import { type ScopeGuide, getScopeGuide } from "@/lib/scope-guides";
import { promptRequiresAttachment, sampleScopePrompts } from "@/lib/scope-prompts";

export type { HistoryMessage };
export { preloadHistoryMessages };

function useDynamicOperatorChatTransport(resolveApi: () => string): AssistantChatTransport<OperatorThreadUiMessage> {
  const resolveApiRef = useRef(resolveApi);
  resolveApiRef.current = resolveApi;
  const transportRef = useRef<AssistantChatTransport<OperatorThreadUiMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new AssistantChatTransport<OperatorThreadUiMessage>({
      api: resolveApiRef.current(),
      prepareSendMessagesRequest: async (options) => ({
        api: resolveApiRef.current(),
        body: {
          ...options.body,
          id: options.id,
          messages: options.messages,
          trigger: options.trigger,
          messageId: options.messageId,
          metadata: options.requestMetadata
        }
      })
    });
  }

  return transportRef.current;
}

export function OperatorThread({
  activeScope,
  activeGroup,
  active = true,
  blankContent = false,
  composerHost,
  groups,
  homeMode = false,
  initialMessages,
  localHistoryMode = false,
  onScopeChange,
  onGroupChange,
  onUserSubmit,
  taskId
}: {
  activeScope?: ScopeItem;
  activeGroup?: ScopeGroup;
  active?: boolean;
  blankContent?: boolean;
  composerHost?: HTMLElement | null;
  groups: ScopeGroup[];
  homeMode?: boolean;
  initialMessages?: HistoryMessage[];
  localHistoryMode?: boolean;
  onScopeChange: (scopeId: string) => void;
  onGroupChange: (groupId: string) => void;
  onUserSubmit?: (text: string) => void;
  taskId: string;
}) {
  const initialMessagesRef = useRef(initialMessages);
  const [historyMessages, setHistoryMessages] = useState<HistoryMessage[]>(() => initialMessages ?? []);
  const [reconciledMessages, setReconciledMessages] = useState<HistoryMessage[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(() => !homeMode && !initialMessages);
  const [hydrated, setHydrated] = useState(false);
  const [runStartedAfterMs, setRunStartedAfterMs] = useState<number | null>(null);
  const [restoredRun, setRestoredRun] = useState<RestoredRunState | null>(null);
  const [scrollButtonHost, setScrollButtonHost] = useState<HTMLDivElement | null>(null);
  const [suggestionSeed, setSuggestionSeed] = useState(0);
  const activeScopeId = activeScope?.id;
  const activeScopeRef = useRef<ScopeItem | undefined>(activeScope);
  const taskIdRef = useRef(taskId);
  activeScopeRef.current = activeScope;
  taskIdRef.current = taskId;
  const attachmentAdapter = useMemo(() => new AnyFileAttachmentAdapter(), []);
  const transport = useDynamicOperatorChatTransport(() => operatorChatApi(taskIdRef.current, activeScopeRef.current));
  const visibleHistoryMessages = reconciledMessages ?? historyMessages;
  const chatSeedMessages = useMemo(
    () =>
      historyMessagesToUiMessages(visibleHistoryMessages, {
        restoredRun: reconciledMessages ? null : restoredRun,
        taskId
      }),
    [reconciledMessages, restoredRun, taskId, visibleHistoryMessages]
  );
  const chat = useChat<OperatorThreadUiMessage>({
    id: taskId,
    messages: chatSeedMessages,
    transport
  });
  const runtime = useAISDKRuntime(chat, {
    adapters: {
      attachments: attachmentAdapter
    }
  });
  transport.setRuntime(runtime);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!active) {
      setHistoryLoading(false);
      return;
    }
    if (homeMode) {
      setHistoryMessages([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    const loadHistory = () => {
      setHistoryLoading(true);
      fetchHistoryMessages(taskId, localHistoryMode)
        .then((messages) => {
          if (!cancelled) setHistoryMessages(messages);
        })
        .catch(() => {
          if (!cancelled && !initialMessagesRef.current) setHistoryMessages([]);
        })
        .finally(() => {
          if (!cancelled) setHistoryLoading(false);
        });
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) loadHistory();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") loadHistory();
    };

    loadHistory();
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", loadHistory);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", loadHistory);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active, homeMode, localHistoryMode, taskId]);

  useEffect(() => {
    if (!active || homeMode || runStartedAfterMs !== null) return;
    let cancelled = false;
    fetchTaskSnapshot(taskId, localHistoryMode)
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        const requestMessages = normalizeSnapshotMessages(snapshotMessagePayload(snapshot));
        if (requestMessages.length) {
          setHistoryMessages((current) => (current.length ? current : requestMessages));
        }
        const phase = snapshotPhase(snapshot);
        const events = normalizeSnapshotEvents(snapshotAgUiPayload(snapshot));
        if (isRunningTaskPhase(phase)) {
          setRestoredRun({ phase, events: events.length ? events : fallbackRunningEvents(taskId, snapshotRunId(snapshot)) });
          return;
        }
        setRestoredRun(null);
      })
      .catch(() => {
        if (!cancelled) setRestoredRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, homeMode, localHistoryMode, runStartedAfterMs, taskId]);

  useEffect(() => {
    setSuggestionSeed((value) => value + 1);
    setReconciledMessages(null);
    setRunStartedAfterMs(null);
    setRestoredRun(null);
  }, [activeScopeId, taskId]);

  useEffect(() => {
    if (!active || homeMode) return;
    if (runStartedAfterMs !== null && !reconciledMessages) return;
    if (operatorThreadUiMessagesEqual(chat.messages, chatSeedMessages)) return;
    chat.setMessages(chatSeedMessages);
  }, [active, chat, chatSeedMessages, homeMode, reconciledMessages, runStartedAfterMs]);

  const handleUserSubmit = useCallback(
    (text: string) => {
      setReconciledMessages(null);
      setRestoredRun(null);
      setRunStartedAfterMs(Date.now());
      onUserSubmit?.(text);
    },
    [onUserSubmit]
  );
  const handleRunReconciled = useCallback((messages: HistoryMessage[]) => {
    if (!messages.length) return;
    setHistoryMessages(messages);
    setReconciledMessages(messages);
    setRestoredRun(null);
    setHistoryLoading(false);
  }, []);
  const handleScopeChange = useCallback(
    (scopeId: string) => {
      activeScopeRef.current = scopeId ? findScopeById(groups, scopeId) : undefined;
      onScopeChange(scopeId);
    },
    [groups, onScopeChange]
  );
  const handleGroupChange = useCallback(
    (groupId: string) => {
      activeScopeRef.current = undefined;
      onGroupChange(groupId);
    },
    [onGroupChange]
  );

  const suggestionTaskKey = homeMode ? "home" : taskId;
  const suggestions = useMemo(
    () => sampleScopePrompts(activeScopeId, `${suggestionTaskKey}:${activeScopeId ?? "default"}:${suggestionSeed}`),
    [activeScopeId, suggestionSeed, suggestionTaskKey]
  );
  const scopeGuide = getScopeGuide(activeScope);
  const rootClassName = [
    "thread-root",
    homeMode ? "home-thread" : "",
    composerHost ? "has-external-composer" : "",
    scopeGuide ? "has-scope-guide" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const scrollToBottomButton = (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button className="scroll-button" type="button" aria-label="滚动到底部">
        <ArrowDown size={16} />
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );

  const composerFooter = (
    <ThreadPrimitive.ViewportFooter className="composer-footer">
      <ScopeDock
        activeScope={activeScope}
        activeGroup={activeGroup}
        groups={groups}
        onScopeChange={handleScopeChange}
        onGroupChange={handleGroupChange}
      />
      <Composer activeScope={activeScope} onUserSubmit={handleUserSubmit} />
    </ThreadPrimitive.ViewportFooter>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RunCompletionSubscriber
        active={active}
        homeMode={homeMode}
        localHistoryMode={localHistoryMode}
        onComplete={handleRunReconciled}
        reconciled={Boolean(reconciledMessages)}
        restoredRunning={Boolean(restoredRun && isRunningTaskPhase(restoredRun.phase))}
        startedAfterMs={runStartedAfterMs}
        taskId={taskId}
      />
      <ThreadPrimitive.Root className={rootClassName}>
        <div className="thread-scroll-button-host" ref={setScrollButtonHost} />
        <ThreadPrimitive.Viewport className="thread-viewport">
          {blankContent ? (
            <div className="thread-switch-blank" aria-hidden="true" />
          ) : (
            <>
              <AuiIf condition={(state) => state.thread.messages.length === 0 && historyLoading}>
                <div className="thread-loading" aria-hidden="true" />
              </AuiIf>

              <AuiIf condition={(state) => state.thread.messages.length === 0 && !historyLoading}>
                <ScopeWelcome
                  activeScope={activeScope}
                  guide={scopeGuide}
                  homeMode={homeMode}
                  hydrated={hydrated}
                  onUserSubmit={handleUserSubmit}
                  suggestions={suggestions}
                />
              </AuiIf>

              <div className="messages">
                <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
              </div>
            </>
          )}

          {!blankContent && scrollButtonHost ? createPortal(scrollToBottomButton, scrollButtonHost) : null}

          {composerHost ? (active ? createPortal(composerFooter, composerHost) : null) : composerFooter}
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function HistoryThreadView({
  active = true,
  initialMessages,
  localHistoryMode = false,
  taskId
}: {
  active?: boolean;
  initialMessages?: HistoryMessage[];
  localHistoryMode?: boolean;
  taskId: string;
}) {
  const initialMessagesRef = useRef(initialMessages);
  const [historyMessages, setHistoryMessages] = useState<HistoryMessage[]>(() => initialMessages ?? []);
  const [historyLoading, setHistoryLoading] = useState(() => !initialMessages);

  useEffect(() => {
    if (!active) {
      setHistoryLoading(false);
      return;
    }
    if (initialMessagesRef.current) {
      setHistoryMessages(initialMessagesRef.current);
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    fetchHistoryMessages(taskId, localHistoryMode)
      .then((messages) => {
        if (!cancelled) setHistoryMessages(messages);
      })
      .catch(() => {
        if (!cancelled) setHistoryMessages([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, localHistoryMode, taskId]);

  return (
    <div className="thread-root history-thread">
      <div className="thread-viewport">
        {historyMessages.length === 0 && historyLoading ? <div className="thread-loading" aria-hidden="true" /> : null}

        {historyMessages.length === 0 && !historyLoading ? <div className="thread-loading" aria-hidden="true" /> : null}

        <div className="messages">
          {historyMessages.map((message) => (
            <HistoryThreadMessage key={message.id} message={message} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ScopeWelcome({
  activeScope,
  guide,
  homeMode,
  hydrated,
  onUserSubmit,
  suggestions
}: {
  activeScope?: ScopeItem;
  guide?: ScopeGuide;
  homeMode: boolean;
  hydrated: boolean;
  onUserSubmit?: (text: string) => void;
  suggestions: string[];
}) {
  const title = activeScope ? activeScope.displayName : homeMode ? "你想完成什么任务？" : "通用智能体";
  if (!guide) {
    return (
      <div className="thread-welcome">
        <Bot size={28} />
        <h2>{title}</h2>
        {activeScope?.description ? <p>{activeScope.description}</p> : null}
        <SuggestionChips hydrated={hydrated} onUserSubmit={onUserSubmit} suggestions={suggestions} />
      </div>
    );
  }

  return (
    <div className="thread-welcome scope-welcome">
      <div className="scope-welcome-header">
        <div className="scope-welcome-icon">
          <Scale size={22} />
        </div>
        <div>
          <h2>{title}</h2>
          <p>{guide.summary}</p>
        </div>
      </div>

      {guide.notice ? <p className="scope-notice">{guide.notice}</p> : null}

      <div className="scope-output-list" aria-label="可交付产物">
        {guide.outputs.map((output) => (
          <span key={output}>{output}</span>
        ))}
      </div>

      <div className="scope-task-grid" aria-label="常见任务">
        {guide.tasks.map((task, index) => {
          const TaskIcon = legalTaskIcons[index % legalTaskIcons.length];
          return (
            <ThreadPrimitive.Suggestion key={task.id} className="scope-task-card" prompt={task.prompt} method="replace">
              <span className="scope-task-icon">
                <TaskIcon size={17} />
              </span>
              <strong>{task.title}</strong>
              <span>{task.description}</span>
              <small>产出：{task.outputs.join(" / ")}</small>
            </ThreadPrimitive.Suggestion>
          );
        })}
      </div>

      <div className="scope-example-block">
        <div className="scope-section-title">你可以这样说</div>
        <SuggestionChips hydrated={hydrated} onUserSubmit={onUserSubmit} suggestions={suggestions} />
      </div>

      <details className="scope-advanced">
        <summary>高级选项</summary>
        <div>
          {guide.advanced.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </details>
    </div>
  );
}

function SuggestionChips({
  hydrated,
  onUserSubmit,
  suggestions
}: {
  hydrated: boolean;
  onUserSubmit?: (text: string) => void;
  suggestions: string[];
}) {
  if (!hydrated) return null;
  return (
    <div className="suggestions">
      {suggestions.map((suggestion) => {
        const needsAttachment = promptRequiresAttachment(suggestion);
        return (
          <ThreadPrimitive.Suggestion
            key={suggestion}
            prompt={suggestion}
            method="replace"
            autoSend={!needsAttachment}
            onClick={needsAttachment ? undefined : () => onUserSubmit?.(suggestion)}
          >
            {suggestion}
          </ThreadPrimitive.Suggestion>
        );
      })}
    </div>
  );
}

const legalTaskIcons = [FileSearch, FilePenLine, SearchCheck, ShieldCheck, ClipboardCheck, FileText];

function operatorChatApi(taskId: string, activeScope: ScopeItem | undefined): string {
  const params = new URLSearchParams({ taskId });
  if (activeScope) params.set("scope", activeScope.id);
  return `/api/operator/chat?${params.toString()}`;
}

function findScopeById(groups: ScopeGroup[], scopeId: string): ScopeItem | undefined {
  for (const group of groups) {
    const scope = group.items.find((item) => item.id === scopeId);
    if (scope) return scope;
  }
  return undefined;
}

function ScopeDock({
  activeScope,
  activeGroup,
  groups,
  onScopeChange,
  onGroupChange
}: {
  activeScope?: ScopeItem;
  activeGroup?: ScopeGroup;
  groups: ScopeGroup[];
  onScopeChange: (scopeId: string) => void;
  onGroupChange: (groupId: string) => void;
}) {
  const visibleItems = activeGroup?.items ?? [];

  return (
    <section className="composer-scopes" aria-label="执行范围">
      <div className="group-tabs">
        {groups.map((group) => (
          <button
            key={group.id}
            className={group.id === activeGroup?.id ? "group-tab active" : "group-tab"}
            type="button"
            onClick={() => onGroupChange(group.id)}
          >
            {group.label}
          </button>
        ))}
      </div>
      <div className="scope-tags">
        {visibleItems.map((item) => (
          <ScopeTag
            key={`${item.kind}:${item.id}`}
            item={item}
            active={item.id === activeScope?.id}
            onClick={() => onScopeChange(item.id === activeScope?.id ? "" : item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ScopeTag({ item, active, onClick }: { item: ScopeItem; active: boolean; onClick: () => void }) {
  const unavailable = item.kind === "skill" && item.available === false;
  return (
    <button
      className={[active ? "scope-tag active" : "scope-tag", unavailable ? "unavailable" : ""].filter(Boolean).join(" ")}
      type="button"
      onClick={onClick}
      disabled={unavailable}
      data-scope-id={item.id}
      title={unavailable ? (item.unavailableReason ?? "该执行范围尚未安装") : undefined}
    >
      <span>{item.displayName}</span>
      <small>{unavailable ? "未安装" : kindLabel(item.kind)}</small>
    </button>
  );
}

function kindLabel(kind: ScopeItem["kind"]) {
  switch (kind) {
    case "agent":
      return "agent";
    case "workflow":
      return "workflow";
    case "tool":
      return "tool";
    case "skill":
      return "技能";
  }
}

function HistoryThreadMessage({ message }: { message: HistoryMessage }) {
  if (message.role === "system") return null;
  if (message.role === "user") {
    return (
      <div className="message user-message">
        <div className="message-icon">
          <UserRound size={16} />
        </div>
        <div className="message-bubble">
          <HistoryMessageContent text={message.content} />
        </div>
      </div>
    );
  }
  return (
    <div className="message assistant-message">
      <div className="message-icon">
        <Bot size={16} />
      </div>
      <div className="message-body">
        <HistoryMessageContent text={message.content} />
        <AssistantAnswerFooter text={message.content} />
      </div>
    </div>
  );
}

function HistoryMessageContent({ text }: { text: string }) {
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    setEnhanced(false);
    const timer = window.setTimeout(() => setEnhanced(true), 80);
    return () => window.clearTimeout(timer);
  }, [text]);

  if (enhanced) return <MarkdownTextPart text={text} />;
  return <div className="markdown-body history-plain-text">{text}</div>;
}

function ThreadMessage() {
  const role = useAuiState((state) => state.message.role);
  const content = useAuiState((state) => state.message.content);
  const elapsed = useMemo(() => extractRunElapsed(content), [content]);
  if (role === "user") {
    return (
      <MessagePrimitive.Root className="message user-message">
        <div className="message-icon">
          <UserRound size={16} />
        </div>
        <div className="message-bubble">
          <MessagePrimitive.Parts components={messagePartComponents} />
        </div>
      </MessagePrimitive.Root>
    );
  }
  return (
    <MessagePrimitive.Root className="message assistant-message">
      <div className="message-icon">
        <Bot size={16} />
      </div>
      <div className="message-body">
        <MessagePrimitive.Unstable_PartsGrouped groupingFunction={groupOperatorStatusParts} components={groupedMessagePartComponents} />
        <AssistantAnswerFooter elapsed={elapsed} text={assistantAnswerTextFromParts(content)} />
      </div>
    </MessagePrimitive.Root>
  );
}

const messagePartComponents = {
  Text: MarkdownTextPart,
  Reasoning: ReasoningPart,
  File: FilePart,
  data: {
    Fallback: DataPart
  }
} satisfies Parameters<typeof MessagePrimitive.Parts>[0]["components"];

const groupedMessagePartComponents = {
  ...messagePartComponents,
  Group: MessagePartGroup
} satisfies Parameters<typeof MessagePrimitive.Unstable_PartsGrouped>[0]["components"];

type MessagePartGroupItem = {
  groupKey: string | undefined;
  indices: number[];
};

function groupOperatorStatusParts(parts: readonly unknown[]): MessagePartGroupItem[] {
  const groups: MessagePartGroupItem[] = [];
  let eventIndices: number[] = [];

  const flushEvents = () => {
    if (!eventIndices.length) return;
    groups.push({ groupKey: `operator-status-${groups.length}`, indices: eventIndices });
    eventIndices = [];
  };

  parts.forEach((part, index) => {
    if (isOperatorEventPart(part)) {
      eventIndices.push(index);
      return;
    }
    flushEvents();
    groups.push({ groupKey: undefined, indices: [index] });
  });
  flushEvents();

  return groups;
}

function MessagePartGroup({ groupKey, children }: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
  if (!groupKey?.startsWith("operator-status")) return <>{children}</>;
  return (
    <div className="agent-event-panel" role="status" aria-live="polite">
      {children}
    </div>
  );
}

type RunElapsed = {
  startedAtMs: number;
  elapsedMs: number;
  running: boolean;
};

function RunElapsedFooter({ elapsed }: { elapsed: RunElapsed | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!elapsed?.running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [elapsed?.running, elapsed?.startedAtMs]);

  if (!elapsed) return null;
  const elapsedMs = elapsed.running ? Math.max(elapsed.elapsedMs, now - elapsed.startedAtMs) : elapsed.elapsedMs;
  return (
    <div className="run-elapsed-footer">
      {elapsed.running ? "运行中" : "已结束"} · {formatElapsed(elapsedMs)}
    </div>
  );
}

function AssistantAnswerFooter({ elapsed = null, text }: { elapsed?: RunElapsed | null; text: string }) {
  const [copied, setCopied] = useState(false);
  const copyText = text.trim();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!copyText && !elapsed) return null;

  const handleCopy = async () => {
    if (!copyText) return;
    await copyTextToClipboard(copyText);
    setCopied(true);
  };

  return (
    <div className="assistant-answer-footer">
      <RunElapsedFooter elapsed={elapsed} />
      {copyText ? (
        <button className="assistant-copy-button" type="button" onClick={handleCopy} aria-label="复制回答" title="复制回答">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      ) : null}
    </div>
  );
}

function extractRunElapsed(parts: readonly unknown[]): RunElapsed | null {
  let startedAtMs: number | undefined;
  let elapsedMs = 0;
  let running = false;

  for (const part of parts) {
    const event = operatorEventFromPart(part);
    if (!event) continue;
    if (event.type === EventType.RUN_STARTED) {
      startedAtMs = parseEventTime(event.timestamp);
      elapsedMs = 0;
      running = true;
    } else if (event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === OPERATOR_PROGRESS_ACTIVITY_TYPE) {
      const startedAt = numberValue(event.content.startedAt);
      const progressElapsed = numberValue(event.content.elapsedMs);
      startedAtMs = startedAtMs ?? (startedAt === undefined ? undefined : startedAt);
      elapsedMs = Math.max(0, progressElapsed ?? elapsedMs);
      running = true;
    } else if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) {
      if (startedAtMs !== undefined) elapsedMs = Math.max(0, parseEventTime(event.timestamp) - startedAtMs);
      running = false;
    }
  }

  return startedAtMs === undefined ? null : { startedAtMs, elapsedMs, running };
}

function assistantAnswerTextFromParts(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => {
      if (!isRecord(part)) return [];
      if (part.type === "text" && typeof part.text === "string") return [part.text];
      if (part.type === "reasoning" || part.type === "file") return [];
      if (typeof part.content === "string" && part.type !== "data") return [part.content];
      return [];
    })
    .join("\n\n")
    .trim();
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function isOperatorEventPart(part: unknown): boolean {
  return Boolean(operatorEventFromPart(part));
}

function operatorEventFromPart(part: unknown): OperatorAgUiEvent | undefined {
  if (!isRecord(part)) return undefined;
  const data =
    part.type === "data" && part.name === AG_UI_EVENT_PART_NAME ? part.data : part.type === AG_UI_EVENT_PART_TYPE ? part.data : undefined;
  return isOperatorAgUiEvent(data) ? data : undefined;
}

function parseEventTime(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `已耗时 ${seconds}秒`;
  return `已耗时 ${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function Composer({ activeScope, onUserSubmit }: { activeScope?: ScopeItem; onUserSubmit?: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const submitDraft = () => {
    onUserSubmit?.(inputRef.current?.value ?? draft);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      submitDraft();
    }
  };

  return (
    <ComposerPrimitive.Root className="composer-root">
      <div className="composer-shell">
        <div className="composer-field">
          <div className="composer-attachments">
            <ComposerPrimitive.Attachments>{() => <ComposerAttachment />}</ComposerPrimitive.Attachments>
          </div>
          <ComposerPrimitive.Input
            ref={inputRef}
            className="composer-input"
            placeholder={activeScope ? `使用 ${activeScope.displayName} 处理任务` : "输入任务需求"}
            rows={1}
            autoFocus
            onInput={(event) => setDraft(event.currentTarget.value)}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="composer-actions">
          <ComposerPrimitive.AddAttachment asChild>
            <button className="tool-button" type="button" aria-label="添加附件" title="添加附件">
              <Paperclip size={17} />
            </button>
          </ComposerPrimitive.AddAttachment>
          <AuiIf condition={(state) => !state.thread.isRunning}>
            <ComposerPrimitive.Send asChild>
              <button className="send-button" type="button" aria-label="发送任务" onClick={submitDraft}>
                <ArrowUp size={18} />
              </button>
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <button className="send-button" type="button" aria-label="停止任务">
                <Square size={14} />
              </button>
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ComposerAttachment() {
  return (
    <AttachmentPrimitive.Root className="attachment-chip">
      <FileText size={14} />
      <span>
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove className="attachment-remove" type="button" aria-label="移除附件">
        <X size={13} />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}
