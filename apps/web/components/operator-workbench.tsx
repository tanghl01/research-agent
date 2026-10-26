"use client";

import { FileText, HardDrive, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { AccountArea, type AccountSession } from "@/components/operator-account-area";
import { ArtifactPreview } from "@/components/task-preview";
import { HistoryThreadView, preloadHistoryMessages, OperatorThread, type HistoryMessage } from "@/components/operator-thread";
import { createTask, loadTasks, type OperatorTask } from "@/lib/tasks";
import { compactTaskTitle, groupTasksByDate, inferTaskSource, mergeTasks, persistTasks } from "@/lib/task-history";
import { flattenScopeCatalog, type ScopeCatalog, type ScopeGroup, groupScopes } from "@/lib/scopes";
import type { OperatorTaskDataSource } from "@/lib/operator-server-data";

type OperatorWorkbenchProps = {
  initialCatalog?: ScopeCatalog;
  initialHistoryMessages?: Record<string, HistoryMessage[]>;
  initialTaskSource?: OperatorTaskDataSource;
  initialTasks?: OperatorTask[];
  taskId?: string;
};

type TaskDataSource = OperatorTaskDataSource;
type PreviewArtifactSelection = {
  href: string;
  filename?: string;
};

const emptyInitialHistoryMessages: Record<string, HistoryMessage[]> = {};
const emptyInitialTasks: OperatorTask[] = [];

export function OperatorWorkbench({
  initialCatalog,
  initialHistoryMessages,
  initialTaskSource,
  initialTasks,
  taskId
}: OperatorWorkbenchProps) {
  const initialTaskList = initialTasks ?? emptyInitialTasks;
  const initialTaskSourceValue = initialTaskSource ?? inferTaskSource(initialTaskList);
  const initialThreadMessages = initialHistoryMessages ?? emptyInitialHistoryMessages;
  const [tasks, setTasks] = useState<OperatorTask[]>(() => initialTaskList);
  const [taskSource, setTaskSource] = useState<TaskDataSource>(() => initialTaskSourceValue);
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [catalog, setCatalog] = useState<ScopeCatalog | null>(() => initialCatalog ?? null);
  const [activeGroupId, setActiveGroupId] = useState("office");
  const [activeScopeIds, setActiveScopeIds] = useState<Record<string, string | undefined>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewArtifactSelection, setPreviewArtifactSelection] = useState<PreviewArtifactSelection | undefined>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(() => taskId);
  const [homeDraftTask, setHomeDraftTask] = useState<OperatorTask>(() => createTask());
  const [mountedThreadIds, setMountedThreadIds] = useState<string[]>(() => [taskId ?? homeDraftTask.id]);
  const [runtimeThreadIds, setRuntimeThreadIds] = useState<string[]>(() => (taskId ? [homeDraftTask.id, taskId] : [homeDraftTask.id]));
  const [blankThreadId, setBlankThreadId] = useState<string | undefined>(() => taskId);
  const [composerHost, setComposerHost] = useState<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef(0);
  const localMigrationAttemptedRef = useRef(false);

  useEffect(() => {
    setSelectedTaskId(taskId);
    setBlankThreadId(taskId);
    if (taskId) {
      setRuntimeThreadIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
    }
  }, [taskId]);

  useEffect(() => {
    const handlePopState = () => {
      const nextTaskId = taskIdFromPathname(window.location.pathname);
      setSelectedTaskId(nextTaskId);
      setBlankThreadId(nextTaskId ?? homeDraftTask.id);
      if (nextTaskId) {
        setRuntimeThreadIds((current) => (current.includes(nextTaskId) ? current : [...current, nextTaskId]));
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [homeDraftTask.id]);

  useEffect(() => {
    if (initialTaskSourceValue === "server") {
      setTasks(initialTaskList);
    } else {
      const cachedTasks = mergeTasks(loadTasks(), initialTaskList);
      setTasks((current) => {
        const next = mergeTasks(current, cachedTasks);
        persistTasks("local", next);
        return next;
      });
    }
    let cancelled = false;
    const refreshTasks = () => {
      fetch("/api/operator/tasks")
        .then((response) => response.json())
        .then((payload: { source?: TaskDataSource; tasks?: OperatorTask[] }) => {
          if (cancelled) return;
          if (payload.source === "server") {
            const browserLocalTasks = loadTasks();
            if (browserLocalTasks.length) {
              setTaskSource("local");
              setTasks(browserLocalTasks);
              return;
            }
            setTaskSource("server");
            setTasks(payload.tasks ?? []);
            return;
          }
          setTaskSource("local");
          setTasks(() => {
            const next = mergeTasks(loadTasks(), payload.tasks ?? []);
            persistTasks("local", next);
            return next;
          });
        })
        .catch(() => undefined);
    };
    const refreshDelayMs = initialTaskList.length ? 800 : 0;
    const refreshTimer = window.setTimeout(refreshTasks, refreshDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
    };
  }, [initialTaskList, initialTaskSourceValue]);

  useEffect(() => {
    if (!accountSession?.backend.enabled) return;
    if (!accountSession.authenticated) {
      setTaskSource("local");
      setTasks(loadTasks());
      localMigrationAttemptedRef.current = false;
      return;
    }

    let cancelled = false;
    const loadRemoteTasks = () =>
      fetch("/api/operator/tasks", { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { source?: TaskDataSource; tasks?: OperatorTask[] }) => {
          if (cancelled) return;
          setTaskSource(payload.source ?? "server");
          setTasks(payload.tasks ?? []);
        })
        .catch(() => undefined);

    const localTasks = loadTasks();
    const migrateLocalTasks = accountSession.bootstrapAvailable && localTasks.length && !localMigrationAttemptedRef.current;
    if (!migrateLocalTasks) {
      void loadRemoteTasks();
      return () => {
        cancelled = true;
      };
    }

    localMigrationAttemptedRef.current = true;
    fetch("/api/operator/session/migrate-local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tasks: localTasks.map(({ id, title }) => ({ id, title })) })
    })
      .then((response) => response.json())
      .then((payload: { migrated?: number }) => {
        if (cancelled) return;
        if ((payload.migrated ?? 0) > 0) persistTasks("local", []);
        return loadRemoteTasks();
      })
      .catch(() => {
        if (!cancelled) void loadRemoteTasks();
      });
    return () => {
      cancelled = true;
    };
  }, [accountSession?.authenticated, accountSession?.bootstrapAvailable, accountSession?.backend.enabled]);

  useEffect(() => {
    if (initialCatalog) return;
    let cancelled = false;
    fetch("/api/operator/scopes")
      .then((response) => response.json())
      .then((payload: { catalog: ScopeCatalog }) => {
        if (!cancelled) setCatalog(payload.catalog);
      })
      .catch(() => {
        if (!cancelled && !initialCatalog) setCatalog({ agents: [], skills: [], workflows: [], tools: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [initialCatalog]);

  useEffect(() => {
    if (!selectedTaskId || tasks.some((task) => task.id === selectedTaskId)) return;
    const task = {
      id: selectedTaskId,
      title: "新任务",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const next = [task, ...tasks];
    setTasks(next);
    persistTasks(taskSource, next);
  }, [selectedTaskId, taskSource, tasks]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const handleOpenArtifact = (event: Event) => {
      const detail = (event as CustomEvent<{ href?: string; filename?: string }>).detail;
      if (!detail?.href) return;
      setPreviewArtifactSelection({ href: detail.href, filename: detail.filename });
      setPreviewOpen(true);
    };
    window.addEventListener("operator-open-artifact", handleOpenArtifact);
    return () => window.removeEventListener("operator-open-artifact", handleOpenArtifact);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const groups = useMemo<ScopeGroup[]>(() => {
    if (!catalog) return [];
    return groupScopes(catalog);
  }, [catalog]);

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const currentThreadId = selectedTaskId ?? homeDraftTask.id;
  useEffect(() => {
    setMountedThreadIds((current) => (current.includes(currentThreadId) ? current : [...current, currentThreadId]));
  }, [currentThreadId]);

  useEffect(() => {
    if (blankThreadId !== currentThreadId) return;
    const timer = window.setTimeout(() => {
      setBlankThreadId((current) => (current === currentThreadId ? undefined : current));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [blankThreadId, currentThreadId]);

  const visibleTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) => task.title.toLowerCase().includes(query));
  }, [searchQuery, tasks]);
  const groupedTasks = useMemo(() => groupTasksByDate(visibleTasks), [visibleTasks]);
  const isServerGuest = Boolean(accountSession?.backend.enabled && accountSession.authenticated && accountSession.user?.isGuest);
  const localHistoryMode = taskSource === "local";

  useLayoutEffect(() => {
    const taskList = taskListRef.current;
    if (!taskList) return;
    const stored = Number(window.sessionStorage.getItem("operator.history.scrollTop") ?? historyScrollRef.current);
    if (!Number.isFinite(stored) || stored <= 0) return;
    window.requestAnimationFrame(() => {
      taskList.scrollTop = stored;
    });
  }, [selectedTaskId, groupedTasks.length, visibleTasks.length]);

  const handleNewTask = () => {
    const nextDraft = createTask();
    flushSync(() => {
      setHomeDraftTask(nextDraft);
      setRuntimeThreadIds((current) => (current.includes(nextDraft.id) ? current : [...current, nextDraft.id]));
      setSelectedTaskId(undefined);
      setBlankThreadId(nextDraft.id);
      setPreviewOpen(false);
      setPreviewArtifactSelection(undefined);
      setHistoryOpen(false);
      setSearchOpen(false);
      setSearchQuery("");
    });
    window.history.pushState(null, "", "/");
  };

  const handleUserSubmit = (threadId: string, text: string) => {
    setRuntimeThreadIds((current) => (current.includes(threadId) ? current : [...current, threadId]));
    const title = compactTaskTitle(text) ?? "新任务";
    const task = {
      id: threadId,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setTasks((current) => {
      const next = mergeTasks([task], current);
      persistTasks(taskSource, next);
      return next;
    });
    if (!selectedTaskId && threadId === homeDraftTask.id) {
      setSelectedTaskId(threadId);
      window.history.replaceState(null, "", taskPath(threadId));
    }
  };

  const renderedThreadIds = mountedThreadIds.includes(currentThreadId) ? mountedThreadIds : [...mountedThreadIds, currentThreadId];
  const shellClassName = [
    "operator-shell",
    sidebarCollapsed ? "sidebar-collapsed" : "",
    previewOpen ? "has-preview" : "",
    historyOpen ? "history-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName}>
      <aside className="sidebar">
        <div className="brand-row">
          <Link
            className="brand-link"
            href="/"
            aria-label="回到首页"
            onClick={(event) => {
              event.preventDefault();
              setSelectedTaskId(undefined);
              setBlankThreadId(homeDraftTask.id);
              setPreviewArtifactSelection(undefined);
              window.history.pushState(null, "", "/");
            }}
          >
            <img className="brand-mark" src="/brand/operator-logo.svg" alt="" />
            <span>算子</span>
          </Link>
          <button
            className="icon-button sidebar-collapse-button"
            type="button"
            aria-label={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <button className="nav-item" type="button" onClick={handleNewTask}>
            <Plus size={18} />
            <span>新任务</span>
          </button>
          <button
            className={searchOpen ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => {
              setSearchOpen((value) => !value);
              setHistoryOpen(true);
            }}
          >
            <Search size={18} />
            <span>搜索</span>
          </button>
          <a className="nav-item drive-nav-item" href="/drive">
            <HardDrive size={18} />
            <span>云盘</span>
          </a>
        </nav>

        <section className="history-block" aria-label="任务历史">
          <div className="history-heading">
            <div className="section-label">任务</div>
            {searchQuery ? (
              <span>
                {visibleTasks.length}/{tasks.length}
              </span>
            ) : null}
          </div>
          {searchOpen ? (
            <label className="history-search">
              <Search size={15} />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索任务历史"
                aria-label="搜索任务历史"
              />
            </label>
          ) : null}
          <div
            className="task-list"
            ref={taskListRef}
            onScroll={(event) => {
              const nextScroll = event.currentTarget.scrollTop;
              historyScrollRef.current = nextScroll;
              window.sessionStorage.setItem("operator.history.scrollTop", String(nextScroll));
            }}
          >
            {isServerGuest && tasks.length === 0 ? (
              <div className="history-auth-prompt">
                <strong>访客任务已自动保存</strong>
                <span>当前历史保存在这个浏览器的访客身份下，登录后可继续保留。</span>
              </div>
            ) : tasks.length === 0 ? (
              <button className="empty-task" type="button" onClick={handleNewTask}>
                创建第一个任务
              </button>
            ) : visibleTasks.length === 0 ? (
              <div className="history-empty">没有匹配的任务</div>
            ) : (
              groupedTasks.map((group) => (
                <div className="task-date-group" key={group.label}>
                  <div className="task-date-label">{group.label}</div>
                  {group.tasks.map((task) => (
                    <a
                      key={task.id}
                      className={task.id === selectedTaskId ? "task-item active" : "task-item"}
                      href={`/tasks/${encodeURIComponent(task.id)}`}
                      onFocus={() => preloadHistoryMessages(task.id, localHistoryMode)}
                      onClick={(event) => {
                        rememberHistoryScroll(taskListRef.current, historyScrollRef);
                        if (
                          event.defaultPrevented ||
                          event.button !== 0 ||
                          event.metaKey ||
                          event.altKey ||
                          event.ctrlKey ||
                          event.shiftKey
                        ) {
                          return;
                        }
                        event.preventDefault();
                        flushSync(() => {
                          setSelectedTaskId(task.id);
                          setBlankThreadId(task.id);
                          setRuntimeThreadIds((current) => (current.includes(task.id) ? current : [...current, task.id]));
                          setPreviewArtifactSelection(undefined);
                          setHistoryOpen(false);
                        });
                        window.history.pushState(null, "", taskPath(task.id));
                      }}
                      onMouseEnter={() => preloadHistoryMessages(task.id, localHistoryMode)}
                      onTouchStart={() => preloadHistoryMessages(task.id, localHistoryMode)}
                    >
                      <FileText size={16} />
                      <span>{task.title}</span>
                    </a>
                  ))}
                </div>
              ))
            )}
          </div>
        </section>

        <AccountArea placement="sidebar" onSessionChange={setAccountSession} />
      </aside>
      {historyOpen ? (
        <button className="mobile-history-backdrop" type="button" aria-label="关闭历史栏" onClick={() => setHistoryOpen(false)} />
      ) : null}

      <main className="workspace">
        <div className="workspace-floating-actions">
          <AccountArea placement="topbar" onSessionChange={setAccountSession} />
          <button
            className="icon-button"
            type="button"
            aria-label={previewOpen ? "关闭预览区" : "打开预览区"}
            title={previewOpen ? "关闭预览区" : "打开预览区"}
            onClick={() => {
              setPreviewArtifactSelection(undefined);
              setPreviewOpen((value) => !value);
            }}
          >
            {previewOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
          </button>
        </div>

        <div className="thread-stack">
          {renderedThreadIds.map((threadId) => {
            const scopeId = activeScopeIds[threadId];
            const threadScope = catalog && scopeId ? flattenScopeCatalog(catalog).find((item) => item.id === scopeId) : undefined;
            const isActiveThread = threadId === currentThreadId;
            const isHomeThread = !selectedTaskId && isActiveThread;
            const shouldUseRuntime = isHomeThread || runtimeThreadIds.includes(threadId);
            const shouldBlankContent = isActiveThread && blankThreadId === threadId;
            return (
              <div
                key={threadId}
                className={isActiveThread ? "thread-frame active" : "thread-frame"}
                aria-hidden={isActiveThread ? undefined : true}
              >
                {shouldUseRuntime ? (
                  <OperatorThread
                    active={isActiveThread}
                    activeScope={threadScope}
                    activeGroup={activeGroup}
                    blankContent={shouldBlankContent}
                    composerHost={composerHost}
                    groups={groups}
                    homeMode={isHomeThread}
                    onScopeChange={(scopeId) => {
                      flushSync(() => {
                        setActiveScopeIds((current) => ({
                          ...current,
                          [threadId]: scopeId || undefined
                        }));
                      });
                    }}
                    onGroupChange={(groupId) => {
                      flushSync(() => {
                        setActiveGroupId(groupId);
                        setActiveScopeIds((current) => ({
                          ...current,
                          [threadId]: undefined
                        }));
                      });
                    }}
                    onUserSubmit={(text) => handleUserSubmit(threadId, text)}
                    initialMessages={initialThreadMessages[threadId]}
                    localHistoryMode={localHistoryMode}
                    taskId={threadId}
                  />
                ) : (
                  <HistoryThreadView
                    active={isActiveThread}
                    initialMessages={initialThreadMessages[threadId]}
                    localHistoryMode={localHistoryMode}
                    taskId={threadId}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="workspace-composer" ref={setComposerHost} />
      </main>

      {previewOpen ? (
        <ArtifactPreview
          localHistoryMode={localHistoryMode}
          taskId={selectedTaskId}
          selectedFilename={previewArtifactSelection?.filename}
          selectedHref={previewArtifactSelection?.href}
          onClose={() => {
            setPreviewOpen(false);
            setPreviewArtifactSelection(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function rememberHistoryScroll(taskList: HTMLDivElement | null, scrollRef: MutableRefObject<number>) {
  const nextScroll = taskList?.scrollTop ?? scrollRef.current;
  scrollRef.current = nextScroll;
  window.sessionStorage.setItem("operator.history.scrollTop", String(nextScroll));
}

function taskPath(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

function taskIdFromPathname(pathname: string): string | undefined {
  const match = /^\/tasks\/([^/?#]+)/u.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}
