#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "../..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has("--json");
const watch = args.has("--watch");
const verify = args.has("--verify") || args.has("--supervise");
const supervise = args.has("--supervise");
const strict = args.has("--strict");
const withBuild = args.has("--with-build");
const durationMs = optionNumber("--duration-min", supervise ? 60 : 0) * 60_000;
const intervalMs = optionNumber("--interval-sec", supervise ? 120 : 30) * 1_000;

const checks = [
  {
    id: "conversation-shell",
    level: "critical",
    label: "single-screen chat workbench",
    goal: "The first viewport is a usable agent workspace, not a landing page.",
    files: ["components/operator-app-shell.tsx", "components/operator-workbench.tsx", "app/layout.tsx", "styles/shell.css"],
    patterns: ["OperatorAppShell", "operator-shell", "height: 100dvh", "overflow: hidden", "新任务", "搜索"],
    fix: "Keep the shell constrained to one viewport and expose primary navigation as real controls."
  },
  {
    id: "parallel-task-threads",
    level: "critical",
    label: "parallel task thread preservation",
    goal: "Switching to a new task must not unmount, cancel, or erase an existing running task.",
    files: ["components/operator-workbench.tsx", "components/operator-thread.tsx", "app/globals.css", "e2e/operator-workbench.spec.ts"],
    patterns: ["thread-stack", "thread-frame", "renderedThreadIds", "onUserSubmit", "does not cancel or erase"],
    fix: "Keep per-task thread runtimes mounted and hide inactive tasks instead of replacing the active thread component."
  },
  {
    id: "assistant-runtime",
    level: "critical",
    label: "assistant-ui runtime integration",
    goal: "Chat rendering and composer behavior are delegated to a maintained chat framework.",
    files: ["components/operator-thread.tsx"],
    patterns: ["useAISDKRuntime", "useChat<", "AssistantRuntimeProvider", "AssistantChatTransport", "ThreadPrimitive.Messages"],
    fix: "Use AI SDK chat state with assistant-ui primitives for thread, message, composer, attachments, and transport."
  },
  {
    id: "composer-actions",
    level: "critical",
    label: "agent composer controls",
    goal: "Users can send, stop, attach files, and select execution scopes without switching pages.",
    files: ["components/operator-thread.tsx"],
    patterns: ["ComposerPrimitive.Send", "ComposerPrimitive.Cancel", "ComposerPrimitive.AddAttachment", "AnyFileAttachmentAdapter"],
    fix: "Expose send/cancel/attachment controls through framework primitives."
  },
  {
    id: "message-rendering",
    level: "critical",
    label: "markdown, math, code, files, reasoning",
    goal: "Assistant messages support the standard chatbot content surface.",
    files: ["components/message-content.tsx", "app/layout.tsx"],
    patterns: ["remarkMath", "rehypeKatex", "CodeBlock", "复制代码", "ReasoningPart", "FilePart", "katex.min.css"],
    fix: "Render Markdown through remark/rehype plugins and provide code copy and file chips."
  },
  {
    id: "event-translation",
    level: "critical",
    label: "readable agent events",
    goal: "Raw operator-event payloads never leak into the user-facing thought/progress column.",
    files: ["lib/ag-ui.ts", "components/message-content.tsx", "../mastra/src/agents/runtime.ts"],
    patterns: ["operator.agent_trace", "OperatorEventPart", "eventView", "Agent 运行轨迹", "EventType.RUN_ERROR"],
    fix: "Translate AG-UI/custom agent events into concise localized progress rows."
  },
  {
    id: "history-navigation",
    level: "critical",
    label: "stable task history",
    goal: "Task history is searchable, deduplicated, grouped, and each item opens its task.",
    files: [
      "components/operator-workbench.tsx",
      "app/api/operator/chat/route.ts",
      "app/api/operator/tasks/route.ts",
      "app/api/operator/task-messages/route.ts",
      "lib/operator-server-data.ts",
      "lib/task-history.ts"
    ],
    patterns: [
      "mergeTasks",
      "task-date-group",
      "historyDateLabel",
      "KeyboardEvent",
      "operator.history.scrollTop",
      "rememberHistoryScroll",
      "resolveRunWorkspaceId"
    ],
    fix: "Preserve task ids, group by recency, support search focus shortcuts, and load persisted messages."
  },
  {
    id: "scope-availability",
    level: "critical",
    label: "runtime skill availability",
    goal: "The UI and backend must not route users into skills whose source is not installed.",
    files: [
      "../../packages/operator-contracts/src/product-scopes.ts",
      "../mastra/src/product-scopes/catalog.ts",
      "lib/operator-application/mastra-scope-runtime-adapter.ts",
      "../mastra/src/chat.ts",
      "components/operator-thread.tsx",
      "app/api/operator/scopes/route.ts",
      "styles/thread.css"
    ],
    patterns: [
      "listUserScopeSelectionCatalog",
      "listProductUserScopeSelectionCatalog",
      "loadMastraRuntimeUserScopeCatalog",
      "scopedSkillUnavailable",
      ".scope-tag.unavailable",
      "disabled={unavailable}"
    ],
    fix: "Keep the user-facing product catalog in contracts, expose runtime availability through the Mastra adapter, disable unavailable skills in the UI, and plan only against executable skills."
  },
  {
    id: "workspace-drawer",
    level: "critical",
    label: "editable file workspace",
    goal: "The right drawer opens files from the conversation into a focused display and editing workspace.",
    files: ["components/task-preview.tsx", "app/api/operator/task-detail/route.ts", "app/globals.css"],
    patterns: ["document-workspace", "文件工作区", "ArtifactPreviewSection", "编辑文件内容", "task-detail"],
    fix: "Keep the drawer focused on selected files instead of exposing raw task logs or process artifacts."
  },
  {
    id: "artifact-preview",
    level: "standard",
    label: "artifact preview and download",
    goal: "Generated files can be selected, opened, downloaded, copied, and previewed when safe.",
    files: ["components/task-preview.tsx", "app/api/operator/artifact/route.ts", "lib/chat-result.ts"],
    patterns: ["downloadHref", "artifact-preview-code", "artifact-preview-media", "复制", "content-disposition"],
    fix: "Provide href/download links and inline preview for text, Markdown, JSON, image, and SVG artifacts."
  },
  {
    id: "responsive-workspace",
    level: "standard",
    label: "responsive drawer behavior",
    goal: "Preview remains usable on tablet and mobile instead of disappearing.",
    files: ["styles/responsive.css", "components/operator-workbench.tsx"],
    patterns: ["@media (max-width: 1120px)", "position: fixed", "width: min(430px", "onClose"],
    fix: "Render the workspace as a right drawer on medium screens and full-screen panel on mobile."
  },
  {
    id: "regression-tests",
    level: "critical",
    label: "Playwright coverage for platform flows",
    goal: "Automated browser tests cover chat rendering, math/code, history, preview, and controls.",
    files: ["package.json", "playwright.config.ts", "e2e/operator-chat.spec.ts", "e2e/operator-workbench.spec.ts"],
    patterns: ["test:e2e", "katex", "添加附件", "文件工作区", "编辑文件内容", "从对话中点击", "scope-tag.unavailable", "PARALLEL_DONE"],
    fix: "Add behavior assertions for the flows that define the mainstream frontend target."
  },
  {
    id: "standard-infra-backends",
    level: "critical",
    label: "standard infrastructure backends",
    goal: "Production behavior uses Redis, BullMQ, and rate-limiter-flexible instead of local in-memory substitutes.",
    files: [
      "lib/api/security.ts",
      "lib/operator-task-events.ts",
      "../../packages/queue/src/redis-adapter.ts",
      "../../docs/runbooks/Operator_Environment_Variables.md"
    ],
    patterns: [
      "RateLimiterRedis",
      "RATE_LIMITER_BACKEND_REQUIRED",
      "OPERATOR_ALLOW_MEMORY_RATE_LIMITER",
      "REDIS_URL is required for production Operator task AG-UI events.",
      "REDIS_URL is required for production Operator job queues."
    ],
    fix: "Keep local memory backends limited to explicit dev/test modes and fail fast in production when Redis is missing."
  },
  {
    id: "observable-server-state",
    level: "critical",
    label: "observable server state failures",
    goal: "Server persistence, task reconciliation, and backend queries must not hide critical failures behind empty catch blocks.",
    files: [
      "lib/operator-application/observability.ts",
      "lib/operator-application/server-run-session-service.ts",
      "app/api/operator/chat/route.ts",
      "app/api/operator/task-events/route.ts",
      "lib/operator-server-data.ts"
    ],
    patterns: [
      "recordOperatorException",
      "initializeServerChatPersistence",
      "server_run_persistence_init_failed",
      "task_events.reconciliation_enqueue_failed",
      'withOperatorSpan("operator.backend.list_tasks"'
    ],
    fix: "Record non-blocking infrastructure failures through OpenTelemetry and fail fast when the enabled backend cannot create standard state."
  }
];

function runStaticAudit() {
  return checks.map((check) => {
    const missingFiles = check.files.filter((file) => !existsSync(resolvePath(file)));
    const haystack = check.files
      .filter((file) => existsSync(resolvePath(file)))
      .map((file) => readFileSync(resolvePath(file), "utf8"))
      .join("\n");
    const missingPatterns = check.patterns.filter((pattern) => !haystack.includes(pattern));
    return {
      ...check,
      ok: missingFiles.length === 0 && missingPatterns.length === 0,
      missingFiles,
      missingPatterns
    };
  });
}

function runVerification() {
  const commands = [
    {
      id: "typecheck",
      label: "TypeScript typecheck",
      command: "pnpm",
      args: ["--dir", webRoot, "exec", "tsc", "--noEmit"]
    },
    {
      id: "playwright",
      label: "Playwright platform flows",
      command: "pnpm",
      args: ["--dir", webRoot, "exec", "playwright", "test", "--workers=1"]
    }
  ];

  if (withBuild || strict) {
    commands.push({
      id: "build",
      label: "Next production build",
      command: "pnpm",
      args: ["--dir", webRoot, "exec", "next", "build", "--webpack"]
    });
  }

  return commands.map((item) => {
    const startedAt = Date.now();
    const result = spawnSync(item.command, item.args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: json ? "pipe" : "inherit"
    });
    return {
      ...item,
      ok: result.status === 0,
      durationMs: Date.now() - startedAt,
      status: result.status,
      signal: result.signal,
      stdout: json ? result.stdout : undefined,
      stderr: json ? result.stderr : undefined
    };
  });
}

function runAuditCycle() {
  const staticResults = runStaticAudit();
  const verificationResults = verify ? runVerification() : [];
  const criticalOk = staticResults.filter((item) => item.level === "critical").every((item) => item.ok);
  const standardOk = staticResults.every((item) => item.ok);
  const verificationOk = verificationResults.every((item) => item.ok);
  const ok = strict ? standardOk && verificationOk : criticalOk && verificationOk;
  return {
    ok,
    strict,
    verified: verify,
    score: score(staticResults),
    staticResults,
    verificationResults,
    nextActions: nextActions(staticResults, verificationResults)
  };
}

function printReport(report) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Operator mainstream agent frontend audit");
  console.log(`target: single-screen chat, readable agent progress, history, workspace, artifacts, responsive behavior`);
  console.log(
    `score: ${report.score.passed}/${report.score.total} checks (${report.score.criticalPassed}/${report.score.criticalTotal} critical)`
  );

  for (const result of report.staticResults) {
    const mark = result.ok ? "PASS" : result.level === "critical" ? "FAIL" : "WARN";
    console.log(`${mark} ${result.id} - ${result.label}`);
    if (result.ok) continue;
    console.log(`  goal: ${result.goal}`);
    if (result.missingFiles.length) console.log(`  missing files: ${result.missingFiles.join(", ")}`);
    if (result.missingPatterns.length) console.log(`  missing patterns: ${result.missingPatterns.join(", ")}`);
    console.log(`  fix: ${result.fix}`);
  }

  for (const result of report.verificationResults) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(`${mark} ${result.id} - ${result.label} (${Math.round(result.durationMs / 1000)}s)`);
  }

  if (report.nextActions.length) {
    console.log("next actions:");
    for (const action of report.nextActions) console.log(`- ${action}`);
  }
}

async function main() {
  if (watch || supervise) {
    const startedAt = Date.now();
    let attempt = 1;
    while (true) {
      console.log(`\nagent frontend audit attempt ${attempt}`);
      const report = runAuditCycle();
      printReport(report);
      if (supervise && report.ok) {
        process.exitCode = 0;
        return;
      }
      if (supervise && Date.now() - startedAt >= durationMs) {
        process.exitCode = 1;
        return;
      }
      await sleep(intervalMs);
      attempt += 1;
    }
  }

  const report = runAuditCycle();
  printReport(report);
  process.exitCode = report.ok ? 0 : 1;
}

function score(results) {
  const critical = results.filter((item) => item.level === "critical");
  return {
    passed: results.filter((item) => item.ok).length,
    total: results.length,
    criticalPassed: critical.filter((item) => item.ok).length,
    criticalTotal: critical.length
  };
}

function nextActions(staticResults, verificationResults) {
  const actions = [
    ...staticResults.filter((item) => !item.ok).map((item) => `${item.id}: ${item.fix}`),
    ...verificationResults
      .filter((item) => !item.ok)
      .map((item) => `${item.id}: inspect the failing command output and update the relevant frontend flow.`)
  ];
  return actions.slice(0, 6);
}

function optionNumber(name, fallback) {
  const prefix = `${name}=`;
  const match = rawArgs.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const value = Number(match.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolvePath(file) {
  return path.resolve(webRoot, file);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
