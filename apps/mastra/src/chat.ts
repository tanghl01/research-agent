import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  createOperatorMessageId,
  ensureOperatorMessageIds,
  stableOperatorMessageId,
  type OperatorConversationMessage,
  type OperatorConversationMessageInput
} from "@operator/contracts";
import { artifactFromFile, loadDotenv, repoRoot, resolveWorkspace, workspacePath, writeArtifactManifest, writeJson } from "@operator/core";
import {
  type OperatorAgentAttachment,
  type OperatorAgentDecision,
  type OperatorAgentRuntimeKind,
  type OperatorAgentTraceEvent,
  type OperatorAgentTraceHandler,
  runOperatorAgent,
  selectMainAgentCandidateIds
} from "./agents/runtime.js";
import { withMastraOperatorSpan } from "./observability.js";
import type { OperatorOutputFormat, OperatorSkillScope, OperatorWorkflowScope } from "./product-scopes/catalog.js";
import { resolveOperatorScope } from "./product-scopes/router.js";
import { runWorkflow } from "./runner.js";
import type { WorkflowDeliveryData } from "./schemas.js";
import { listResolvedOperatorSkills, type ResolvedOperatorSkill } from "./skills/registry.js";
import { workflowInputForScope } from "./workflows/scope-inputs.js";
import { listMastraWorkspaceSkills } from "./workspace.js";

export type OperatorChatMessage = OperatorConversationMessage;
export type OperatorChatMessageInput = OperatorConversationMessageInput;
export type OperatorChatAttachment = OperatorAgentAttachment;

export type OperatorChatOptions = {
  prompt?: string;
  messages?: OperatorChatMessageInput[];
  attachments?: OperatorChatAttachment[];
  workspace?: string;
  runId?: string;
  scopeId?: string;
  timeoutMs?: number;
  onAgentTrace?: OperatorAgentTraceHandler;
};

export type OperatorChatSkillArtifact = {
  path: string;
  name?: string;
  type?: string;
  description?: string;
};

export type OperatorChatSkillRun = {
  skill: string;
  output_format: OperatorOutputFormat;
  status: "succeeded" | "failed";
  reason?: string;
  artifacts: OperatorChatSkillArtifact[];
  evidence?: {
    skill_md_sha256?: string;
    artifact_checks?: Array<{
      path: string;
      size_bytes: number;
    }>;
  };
  error?: string;
  conversation_id?: string;
};

export type LegacyMastraChatResult = {
  run_id: string;
  status: "succeeded" | "failed";
  response?: string;
  workspace: string;
  agent: {
    id: string;
    role: "default_main_execution_agent";
    runtime: OperatorAgentRuntimeKind;
    execution_status: OperatorAgentDecision<unknown>["status"];
    endpoint?: string;
    conversation_id?: string;
    conversation_ids: string[];
    trace: OperatorAgentTraceEvent[];
    fallback_used: boolean;
    error_code?: string;
    error_detail?: string;
    error?: string;
  };
  selected_skills: Array<{
    skill: string;
    output_format: OperatorOutputFormat;
    reason?: string;
  }>;
  runs: OperatorChatSkillRun[];
  outputs: {
    chatRequest: string;
    chatPlan: string;
    chatResult: string;
    artifactManifest: string;
  };
};

type WorkspaceFileSnapshot = Map<
  string,
  {
    sizeBytes: number;
    mtimeMs: number;
  }
>;

export async function runOperatorChat(options: OperatorChatOptions): Promise<LegacyMastraChatResult> {
  return withMastraOperatorSpan(
    "operator.mastra.chat",
    {
      "operator.run_id": options.runId ?? "",
      "operator.scope_id": options.scopeId ?? "",
      "operator.message_count": options.messages?.length ?? (options.prompt ? 1 : 0),
      "operator.attachment_count": options.attachments?.length ?? 0
    },
    () => runOperatorChatImpl(options)
  );
}

async function runOperatorChatImpl(options: OperatorChatOptions): Promise<LegacyMastraChatResult> {
  loadDotenv();
  const runId = options.runId ?? `chat_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const workspace = resolveWorkspace(options.workspace, runId);
  const directArtifactBaseline = snapshotWorkspaceFiles(workspace);
  const messages = normalizeMessages(options);
  const imageGenerationRequested = chatRequestsImageGeneration(messages);
  const attachments = options.attachments ?? [];
  const runtimeContext = chatRuntimeContext({ workspace, runId, imageGenerationRequested });
  const outputs = chatOutputPaths(runId);
  const resolvedScope = resolveOperatorScope(options.scopeId);
  const scopedAgent = resolvedScope.kind === "agent" ? resolvedScope.scope : undefined;
  const scopedSkill = resolvedScope.kind === "skill" ? resolvedScope.scope : undefined;
  const scopedWorkflow = resolvedScope.kind === "workflow" ? resolvedScope.scope : undefined;
  const availableSkills = scopedSkill ? await listMastraWorkspaceSkills() : [];
  const resolvedSkills = scopedSkill ? listResolvedOperatorSkills() : [];
  const selectedResolvedSkill = scopedSkill ? resolvedSkills.find((skill) => skill.mastraName === scopedSkill.mastraName) : undefined;
  const selectedWorkspaceSkill = scopedSkill ? availableSkills.find((skill) => skill.name === scopedSkill.mastraName) : undefined;
  const candidateAgentIds = selectMainAgentCandidateIds(scopedAgent?.id);
  const scopedSkillUnavailable = Boolean(scopedSkill && !selectedResolvedSkill);
  const selectedSkills = scopedSkill
    ? [
        {
          skill: scopedSkill.mastraName,
          output_format: scopedSkill.outputFormat,
          reason: scopedSkillUnavailable
            ? "User selected this skill scope, but the selected skill source is unavailable in this runtime."
            : "User selected this skill scope. The selected skill package is exposed to the main agent for this run."
        }
      ]
    : [];

  writeJson(workspacePath(workspace, outputs.chatRequest), {
    run_id: runId,
    mode: "main_agent",
    scope_id: options.scopeId,
    selected_agent_id: scopedAgent?.id,
    selected_workflow_id: scopedWorkflow?.workflowId,
    candidate_agent_ids: candidateAgentIds,
    selected_acp_agent_id: scopedAgent?.id,
    candidate_acp_agent_ids: candidateAgentIds,
    runtime_context: runtimeContext,
    image_generation_requested: imageGenerationRequested,
    messages,
    uploaded_attachments: attachments.map(({ contentBase64, ...attachment }) => attachment),
    exposed_skill_scope: exposedSkillScope(scopedSkill, selectedResolvedSkill, selectedWorkspaceSkill),
    exposed_workflow_scope: exposedWorkflowScope(scopedWorkflow)
  });

  writeRunningChatPlan({
    runId,
    workspace,
    outputs,
    phase: scopedWorkflow ? "workflow" : "main_agent",
    scopedWorkflow,
    scopedAgentId: scopedAgent?.id,
    candidateAgentIds,
    selectedSkills,
    scopedSkillUnavailable: scopedSkillUnavailable ? scopedSkill?.mastraName : undefined
  });

  try {
    if (scopedWorkflow) {
      const workflowRun = await runWorkflow({
        workspace,
        workflowId: scopedWorkflow.workflowId,
        input: workflowInputForScope(scopedWorkflow, messages, workspace, runId)
      });
      const delivery = workflowRun.result;
      const workflowStatus = workflowRun.status === "succeeded" && delivery ? "succeeded" : "failed";
      const error =
        workflowStatus === "succeeded"
          ? undefined
          : (workflowRun.error ?? `Mastra workflow did not produce a validated result: ${scopedWorkflow.workflowId}`);
      const runArtifacts = delivery ? artifactsFromDelivery(delivery) : [];
      const response = delivery ? renderWorkflowResponse(scopedWorkflow.displayName, delivery) : undefined;
      const trace: OperatorAgentTraceEvent[] = [
        {
          kind: workflowStatus === "succeeded" ? "result" : "error",
          label: "Mastra workflow",
          detail: scopedWorkflow.workflowId,
          timestamp: new Date().toISOString()
        }
      ];

      writeJson(workspacePath(workspace, outputs.chatPlan), {
        run_id: runId,
        phase: "workflow",
        workflow_id: scopedWorkflow.workflowId,
        scope_id: scopedWorkflow.id,
        mastra_key: scopedWorkflow.mastraKey,
        execution_status: workflowStatus === "succeeded" ? "used" : "failed",
        runtime: "mastra-workflow",
        selected_workflow: exposedWorkflowScope(scopedWorkflow),
        selected_skills: [],
        response,
        error
      });

      return writeChatResult({
        runId,
        workspace,
        agentId: scopedWorkflow.id,
        runtime: "mastra-workflow",
        executionStatus: workflowStatus === "succeeded" ? "used" : "failed",
        conversationIds: [],
        trace,
        fallbackUsed: false,
        selectedSkills: [],
        directArtifactBaseline,
        outputs,
        runs: [
          {
            skill: scopedWorkflow.id,
            output_format: scopedWorkflow.outputContract?.required_output_format ?? "pdf",
            status: workflowStatus,
            reason: "User selected this Mastra workflow scope.",
            artifacts: runArtifacts,
            error
          }
        ],
        response,
        error
      });
    }

    const agentMessages = [
      {
        id: stableOperatorChatMessageId(runId, { role: "system", content: "operator-system-context" }, 0),
        role: "system" as const,
        content: agentSystemContext({
          scopedSkillUnavailable,
          selectedSkill: scopedSkill,
          selectedResolvedSkill,
          selectedWorkspaceSkill,
          imageGenerationRequested
        })
      },
      ...messages
    ];

    const execution = await runOperatorAgent({
      agentId: scopedAgent?.id,
      messages: agentMessages,
      attachments,
      runtimeContext,
      timeoutMs: options.timeoutMs,
      onTrace: options.onAgentTrace
    });
    const response = execution.status === "used" ? execution.value.trim() : undefined;
    const error = execution.status === "used" && response ? undefined : (execution.error ?? "Main agent did not produce a final response.");

    writeJson(workspacePath(workspace, outputs.chatPlan), {
      run_id: runId,
      phase: "main_agent",
      agent_id: execution.agentId,
      runtime: execution.runtime,
      selected_agent_id: scopedAgent?.id,
      candidate_agent_ids: candidateAgentIds,
      attempted_agent_ids: execution.attemptedAgentIds ?? [],
      selected_acp_agent_id: scopedAgent?.id,
      candidate_acp_agent_ids: candidateAgentIds,
      attempted_acp_agent_ids: execution.attemptedAgentIds ?? [],
      execution_status: execution.status,
      endpoint: execution.endpoint,
      conversation_id: execution.conversationId,
      trace: execution.trace ?? [],
      fallback_used: execution.fallbackUsed ?? false,
      response,
      error_code: execution.errorCode,
      error_detail: execution.errorDetail,
      selected_skills: selectedSkills,
      error,
      scoped_skill_unavailable: scopedSkillUnavailable ? scopedSkill?.mastraName : undefined
    });

    return writeChatResult({
      runId,
      workspace,
      agentId: execution.agentId,
      runtime: execution.runtime,
      executionStatus: execution.status,
      endpoint: execution.endpoint,
      conversationIds: execution.conversationId ? [execution.conversationId] : [],
      trace: execution.trace ?? [],
      fallbackUsed: execution.fallbackUsed ?? false,
      errorCode: execution.errorCode,
      errorDetail: execution.errorDetail,
      selectedSkills,
      runs: [],
      directArtifactBaseline,
      outputs,
      response,
      error
    });
  } catch (error) {
    return writeUnexpectedChatFailure({
      runId,
      workspace,
      outputs,
      phase: scopedWorkflow ? "workflow" : "main_agent",
      agentId: scopedWorkflow?.id ?? scopedAgent?.id ?? candidateAgentIds[0] ?? "operator-chat",
      runtime: scopedWorkflow ? "mastra-workflow" : "mastra-acp-agent",
      selectedSkills,
      directArtifactBaseline,
      error
    });
  }
}

function writeRunningChatPlan(params: {
  runId: string;
  workspace: string;
  outputs: LegacyMastraChatResult["outputs"];
  phase: "workflow" | "main_agent";
  scopedWorkflow?: OperatorWorkflowScope;
  scopedAgentId?: string;
  candidateAgentIds: string[];
  selectedSkills: LegacyMastraChatResult["selected_skills"];
  scopedSkillUnavailable?: string;
}): void {
  const now = new Date().toISOString();
  writeJson(workspacePath(params.workspace, params.outputs.chatPlan), {
    run_id: params.runId,
    phase: params.phase,
    workflow_id: params.scopedWorkflow?.workflowId,
    scope_id: params.scopedWorkflow?.id,
    mastra_key: params.scopedWorkflow?.mastraKey,
    selected_workflow: exposedWorkflowScope(params.scopedWorkflow),
    agent_id: params.scopedAgentId,
    selected_agent_id: params.scopedAgentId,
    candidate_agent_ids: params.candidateAgentIds,
    selected_acp_agent_id: params.scopedAgentId,
    candidate_acp_agent_ids: params.candidateAgentIds,
    attempted_agent_ids: [],
    attempted_acp_agent_ids: [],
    runtime: params.phase === "workflow" ? "mastra-workflow" : undefined,
    execution_status: "running",
    selected_skills: params.selectedSkills,
    scoped_skill_unavailable: params.scopedSkillUnavailable,
    started_at: now,
    updated_at: now
  });
}

function writeUnexpectedChatFailure(params: {
  runId: string;
  workspace: string;
  outputs: LegacyMastraChatResult["outputs"];
  phase: "workflow" | "main_agent";
  agentId: string;
  runtime: OperatorAgentRuntimeKind;
  selectedSkills: LegacyMastraChatResult["selected_skills"];
  directArtifactBaseline?: WorkspaceFileSnapshot;
  error: unknown;
}): LegacyMastraChatResult {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const trace: OperatorAgentTraceEvent[] = [
    {
      kind: "error",
      label: "Operator chat runtime failed",
      detail: message,
      timestamp: new Date().toISOString()
    }
  ];

  writeJson(workspacePath(params.workspace, params.outputs.chatPlan), {
    run_id: params.runId,
    phase: params.phase,
    agent_id: params.agentId,
    runtime: params.runtime,
    execution_status: "failed",
    trace,
    selected_skills: params.selectedSkills,
    error: message,
    updated_at: new Date().toISOString()
  });

  return writeChatResult({
    runId: params.runId,
    workspace: params.workspace,
    agentId: params.agentId,
    runtime: params.runtime,
    executionStatus: "failed",
    conversationIds: [],
    trace,
    selectedSkills: params.selectedSkills,
    runs: [],
    directArtifactBaseline: params.directArtifactBaseline,
    outputs: params.outputs,
    error: message
  });
}

function agentSystemContext(params: {
  scopedSkillUnavailable: boolean;
  selectedSkill?: OperatorSkillScope;
  selectedResolvedSkill?: ResolvedOperatorSkill;
  selectedWorkspaceSkill?: Awaited<ReturnType<typeof listMastraWorkspaceSkills>>[number];
  imageGenerationRequested?: boolean;
}): string {
  const selectedSkillContext =
    params.selectedSkill && !params.scopedSkillUnavailable
      ? [
          "",
          "Selected skill scope:",
          JSON.stringify(
            {
              id: params.selectedSkill.id,
              name: params.selectedSkill.mastraName,
              description: params.selectedSkill.description,
              output_format: params.selectedSkill.outputFormat,
              output_contract: params.selectedSkill.outputContract,
              selection_guidance: params.selectedSkill.selectionGuidance,
              execution_guidance: params.selectedSkill.executionGuidance,
              workspace_skill: params.selectedWorkspaceSkill,
              resolved_source: params.selectedResolvedSkill ? resolvedSkillSummary([params.selectedResolvedSkill])[0] : undefined
            },
            null,
            2
          )
        ]
      : [];

  return [
    "You are the Operator general execution agent.",
    "Use your own planning and runtime tools to handle the user's request.",
    "When creating artifacts, write them inside runtime_context.workspace_absolute.",
    "Verify generated files exist before claiming completion.",
    params.imageGenerationRequested
      ? "This request needs image generation or image asset creation. Use the runtime's built-in image generation feature when available; do not require OPENAI_API_KEY or other app-level image API keys. Save generated image files inside runtime_context.workspace_absolute and mention workspace-relative file paths in the final response."
      : "",
    params.selectedSkill && !params.scopedSkillUnavailable
      ? "The user selected a skill scope. Read and follow the selected skill package instructions for this run."
      : "No Operator skill scope is selected for this run. Do not assume any Operator skill package is exposed; solve the task with your own standard runtime tools.",
    params.selectedSkill && !params.scopedSkillUnavailable
      ? "For project-level skill collections, inspect the root README first, then choose the relevant nested SKILL.md from resolved_source.subskills. Apply listed Operator adapter files and runtime commands when present."
      : "",
    params.scopedSkillUnavailable
      ? "The selected skill source is not installed in this runtime. Report the missing skill or satisfy the request with your own standard runtime tools if appropriate."
      : "",
    ...selectedSkillContext
  ]
    .filter(Boolean)
    .join("\n");
}

function exposedSkillScope(
  skill?: OperatorSkillScope,
  resolvedSkill?: ResolvedOperatorSkill,
  workspaceSkill?: Awaited<ReturnType<typeof listMastraWorkspaceSkills>>[number]
) {
  if (!skill) return undefined;
  return {
    id: skill.id,
    name: skill.mastraName,
    description: skill.description,
    output_format: skill.outputFormat,
    output_contract: skill.outputContract,
    available: Boolean(resolvedSkill),
    unavailable_reason: resolvedSkill ? undefined : "Skill source is unavailable.",
    workspace_skill: workspaceSkill,
    resolved_source: resolvedSkill ? resolvedSkillSummary([resolvedSkill])[0] : undefined
  };
}

function exposedWorkflowScope(workflow?: OperatorWorkflowScope) {
  if (!workflow) return undefined;
  return {
    id: workflow.id,
    workflow_id: workflow.workflowId,
    mastra_key: workflow.mastraKey,
    description: workflow.description,
    output_contract: workflow.outputContract
  };
}

function artifactsFromDelivery(delivery: WorkflowDeliveryData): OperatorChatSkillArtifact[] {
  return delivery.artifacts.map((artifact) => ({
    path: artifact.path,
    name: artifact.name,
    type: artifact.type,
    description: typeof artifact.metadata.description === "string" ? artifact.metadata.description : undefined
  }));
}

function renderWorkflowResponse(displayName: string, delivery: WorkflowDeliveryData): string {
  const reportPdf = delivery.outputs.reportPdf;
  const reportTex = delivery.outputs.reportTex;
  const reportMarkdown = delivery.outputs.reportMarkdown;
  const reportJson = delivery.outputs.reportJson;
  return [
    `${displayName}已生成。`,
    "",
    reportPdf ? `- PDF： [${path.basename(reportPdf)}](${reportPdf})` : undefined,
    reportTex ? `- LaTeX： [${path.basename(reportTex)}](${reportTex})` : undefined,
    reportMarkdown ? `- Markdown： [${path.basename(reportMarkdown)}](${reportMarkdown})` : undefined,
    reportJson ? `- 数据 JSON： [${path.basename(reportJson)}](${reportJson})` : undefined,
    "",
    `综合风险：${String(delivery.usage.risk_level ?? "见报告")}`,
    `产物校验：${delivery.validation.validated ? "通过" : "未通过"}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function normalizeMessages(options: OperatorChatOptions): OperatorChatMessage[] {
  if (options.messages?.length) return ensureOperatorChatMessageIds(options.messages, options.runId ?? options.workspace ?? "chat");
  if (options.prompt?.trim()) {
    return [
      {
        id: createOperatorChatMessageId("user"),
        role: "user",
        content: options.prompt.trim()
      }
    ];
  }
  throw new Error("runOperatorChat requires either prompt or messages");
}

export function createOperatorChatMessageId(prefix = "msg"): string {
  return createOperatorMessageId(prefix);
}

export function ensureOperatorChatMessageIds(messages: readonly OperatorChatMessageInput[], scope = "message"): OperatorChatMessage[] {
  return ensureOperatorMessageIds(messages, scope);
}

export function stableOperatorChatMessageId(scope: string, message: Pick<OperatorChatMessage, "role" | "content">, index: number): string {
  return stableOperatorMessageId(scope, message, index);
}

function chatRequestsImageGeneration(messages: OperatorChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return isImageGenerationRequest(messages[index].content);
  }
  return false;
}

function isImageGenerationRequest(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  if (
    !/(?:图|照片|插图|海报|封面|头像|logo|icon|image|picture|photo|illustration|poster|cover|avatar)/iu.test(normalized) &&
    !/(?:生图|出图|文生图|画一张|画一幅|绘图)/iu.test(normalized)
  ) {
    return false;
  }
  return [
    /(?:生图|出图|文生图|生成图|画图|绘图|画一张|画一幅)/iu,
    /(?:生成|创建|绘制|画|做|制作|设计|产出|输出).{0,60}(?:图片|图像|照片|插图|海报|封面|logo|图标|头像|icon|image|picture|photo|illustration|poster|cover|avatar)/iu,
    /(?:图片|图像|照片|插图|海报|封面|logo|图标|头像|icon|image|picture|photo|illustration|poster|cover|avatar).{0,60}(?:生成|创建|绘制|画|制作|设计|产出|输出|生图|出图)/iu,
    /(?:generate|create|draw|make|design|produce).{0,60}(?:image|picture|photo|illustration|poster|cover|logo|icon|avatar)/iu
  ].some((pattern) => pattern.test(normalized));
}

function chatRuntimeContext(params: { workspace: string; runId: string; imageGenerationRequested: boolean }) {
  const now = new Date();
  return {
    run_id: params.runId,
    workspace: params.workspace,
    workspace_absolute: path.isAbsolute(params.workspace) ? params.workspace : path.resolve(repoRoot(), params.workspace),
    image_generation_requested: params.imageGenerationRequested,
    current_date: now.toISOString().slice(0, 10),
    current_datetime: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

function resolvedSkillSummary(skills: ResolvedOperatorSkill[]) {
  return skills.map((skill) => ({
    skill: skill.mastraName,
    root: skill.root,
    source_root: skill.sourceRoot,
    source: skill.source,
    entrypoints: skill.entrypoints,
    subskill_id: skill.subskillId,
    adapters: skill.adapters,
    runtime: skill.runtime,
    install: {
      status: skill.capabilityReceipt.status,
      lifecycle_status: skill.capabilityReceipt.lifecycle_status,
      state_path: skill.capabilityReceipt.receipt_path,
      install_key: skill.capabilityReceipt.version_key,
      installed_at: skill.capabilityReceipt.completed_at
    },
    subskills: skill.subskills.map((subskill) => ({
      id: subskill.id,
      display_name: subskill.displayName,
      description: subskill.description,
      root: subskill.root,
      source_root: subskill.sourceRoot,
      entrypoints: subskill.entrypoints,
      required_paths: subskill.requiredPaths,
      adapters: subskill.adapters,
      runtime: subskill.runtime,
      execution: {
        evidence_entrypoint: subskill.executionTarget.execution.evidence_entrypoint,
        required_entrypoints: subskill.executionTarget.execution.required_entrypoints,
        required_commands: subskill.executionTarget.execution.required_commands,
        notes: subskill.executionTarget.execution.notes,
        agent_guard: subskill.executionTarget.execution.agent_guard
      }
    }))
  }));
}

function writeChatResult(params: {
  runId: string;
  workspace: string;
  agentId: string;
  runtime: OperatorAgentRuntimeKind;
  executionStatus: OperatorAgentDecision<unknown>["status"];
  endpoint?: string;
  conversationIds: string[];
  trace?: OperatorAgentTraceEvent[];
  fallbackUsed?: boolean;
  errorCode?: string;
  errorDetail?: string;
  selectedSkills: LegacyMastraChatResult["selected_skills"];
  runs: OperatorChatSkillRun[];
  directArtifactBaseline?: WorkspaceFileSnapshot;
  outputs: LegacyMastraChatResult["outputs"];
  response?: string;
  error?: string;
}): LegacyMastraChatResult {
  const status = !params.error && (params.runs.length > 0 || Boolean(params.response?.trim())) ? "succeeded" : "failed";
  const chatResult: LegacyMastraChatResult = {
    run_id: params.runId,
    status,
    response: params.response,
    workspace: params.workspace,
    agent: {
      id: params.agentId,
      role: "default_main_execution_agent",
      runtime: params.runtime,
      execution_status: params.executionStatus,
      endpoint: params.endpoint,
      conversation_id: params.conversationIds[0],
      conversation_ids: params.conversationIds,
      trace: params.trace ?? [],
      fallback_used: params.fallbackUsed ?? false,
      error_code: params.errorCode,
      error_detail: params.errorDetail,
      error: params.error
    },
    selected_skills: params.selectedSkills,
    runs: params.runs,
    outputs: params.outputs
  };

  writeJson(workspacePath(params.workspace, chatResult.outputs.chatResult), chatResult);
  const artifacts = [
    artifactFromFile({
      workspace: params.workspace,
      path: chatResult.outputs.chatRequest,
      stepId: "operator_chat",
      name: "chat_request"
    }),
    artifactFromFile({
      workspace: params.workspace,
      path: chatResult.outputs.chatPlan,
      stepId: "operator_chat",
      name: "chat_plan"
    }),
    artifactFromFile({
      workspace: params.workspace,
      path: chatResult.outputs.chatResult,
      stepId: "operator_chat",
      name: "chat_result"
    }),
    ...params.runs.flatMap((run) =>
      run.artifacts
        .filter((artifact) => existsSync(workspacePath(params.workspace, artifact.path)))
        .map((artifact) =>
          artifactFromFile({
            workspace: params.workspace,
            path: artifact.path,
            stepId: `skill_${run.skill}`,
            name: artifact.name,
            type: artifact.type,
            metadata: {
              skill: run.skill,
              output_format: run.output_format,
              description: artifact.description,
              conversation_id: run.conversation_id
            }
          })
        )
    ),
    ...collectDirectAgentArtifacts(params.workspace, params.runs, params.agentId, params.directArtifactBaseline, chatResult.outputs)
  ];
  writeArtifactManifest({
    workspace: params.workspace,
    path: chatResult.outputs.artifactManifest,
    workflowRunId: params.runId,
    stepRunId: "operator_chat",
    artifacts
  });

  return chatResult;
}

function collectDirectAgentArtifacts(
  workspace: string,
  runs: OperatorChatSkillRun[],
  agentId: string,
  baseline: WorkspaceFileSnapshot | undefined,
  outputs: LegacyMastraChatResult["outputs"]
) {
  const knownPaths = new Set([
    ...Object.values(outputs),
    "output/chat_request.json",
    "output/chat_plan.json",
    "output/chat_result.json",
    "output/artifact_manifest.json",
    ...runs.flatMap((run) => run.artifacts.map((artifact) => artifact.path))
  ]);
  return listWorkspaceFiles(workspace)
    .filter((artifactPath) => !knownPaths.has(artifactPath))
    .filter((artifactPath) => !isChatRuntimeMetadataPath(artifactPath))
    .filter((artifactPath) => !artifactPath.startsWith("attempts/"))
    .filter((artifactPath) => !artifactPath.startsWith("input/"))
    .filter((artifactPath) => isUserFacingArtifactPath(artifactPath))
    .filter((artifactPath) => isNewOrModifiedWorkspaceFile(workspace, artifactPath, baseline))
    .map((artifactPath) =>
      artifactFromFile({
        workspace,
        path: artifactPath,
        stepId: "operator_agent",
        name: path.basename(artifactPath),
        metadata: {
          source: agentId
        }
      })
    );
}

function chatOutputPaths(runId: string): LegacyMastraChatResult["outputs"] {
  const runDir = `runs/chat/${safeRunPathSegment(runId)}/output`;
  return {
    chatRequest: `${runDir}/chat_request.json`,
    chatPlan: `${runDir}/chat_plan.json`,
    chatResult: `${runDir}/chat_result.json`,
    artifactManifest: `${runDir}/artifact_manifest.json`
  };
}

function safeRunPathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 120) || "chat_run";
}

function isChatRuntimeMetadataPath(artifactPath: string): boolean {
  return /^runs\/chat\/[^/]+\/output\/(?:chat_request|chat_plan|chat_result|artifact_manifest)\.json$/u.test(artifactPath);
}

function isUserFacingArtifactPath(artifactPath: string): boolean {
  const segments = artifactPath.split("/");
  const ignoredSegments = new Set([
    ".cache",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "site-packages",
    "venv",
    "work"
  ]);
  return !segments.some((segment) => ignoredSegments.has(segment) || segment.endsWith(".dist-info"));
}

function snapshotWorkspaceFiles(workspace: string): WorkspaceFileSnapshot {
  const snapshot: WorkspaceFileSnapshot = new Map();
  for (const artifactPath of listWorkspaceFiles(workspace)) {
    const stats = safeWorkspaceStat(workspace, artifactPath);
    if (!stats) continue;
    snapshot.set(artifactPath, {
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs
    });
  }
  return snapshot;
}

function isNewOrModifiedWorkspaceFile(workspace: string, artifactPath: string, baseline?: WorkspaceFileSnapshot): boolean {
  if (!baseline) return true;
  const before = baseline.get(artifactPath);
  if (!before) return true;
  const after = safeWorkspaceStat(workspace, artifactPath);
  if (!after) return false;
  return before.sizeBytes !== after.size || before.mtimeMs !== after.mtimeMs;
}

function safeWorkspaceStat(workspace: string, artifactPath: string) {
  try {
    return statSync(workspacePath(workspace, artifactPath));
  } catch {
    return undefined;
  }
}

function listWorkspaceFiles(workspace: string, relativeDir = ""): string[] {
  const absoluteDir = workspacePath(workspace, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) return listWorkspaceFiles(workspace, relativePath);
    return entry.isFile() ? [relativePath] : [];
  });
}
