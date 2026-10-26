import type { OperatorConversationMessage, OperatorConversationMessageInput } from "@operator/contracts";

export type LegacyOperatorChatMessage = OperatorConversationMessage;
export type LegacyOperatorChatMessageInput = OperatorConversationMessageInput;

export type LegacyOperatorChatAttachment = {
  path: string;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  sha256?: string;
  contentBase64: string;
};

export type LegacyOperatorChatTraceEvent = {
  kind?: string;
  label?: string;
  tool?: string;
  detail?: string;
  timestamp?: string;
  [key: string]: unknown;
};

export type LegacyOperatorChatSkillArtifact = {
  path: string;
  name?: string;
  type?: string;
  description?: string;
};

export type LegacyOperatorChatSkillRun = {
  skill: string;
  output_format: string;
  status: "succeeded" | "failed";
  reason?: string;
  artifacts: LegacyOperatorChatSkillArtifact[];
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
    runtime: string;
    execution_status: "used" | "skipped" | "failed" | string;
    endpoint?: string;
    conversation_id?: string;
    conversation_ids: string[];
    trace: LegacyOperatorChatTraceEvent[];
    fallback_used: boolean;
    error_code?: string;
    error_detail?: string;
    error?: string;
  };
  selected_skills: Array<{
    skill: string;
    output_format: string;
    reason?: string;
  }>;
  runs: LegacyOperatorChatSkillRun[];
  outputs: {
    chatRequest: string;
    chatPlan: string;
    chatResult: string;
    artifactManifest: string;
  };
};

export function isLegacyMastraChatResult(value: unknown): value is LegacyMastraChatResult {
  return (
    isRecord(value) &&
    typeof value.run_id === "string" &&
    (value.status === "succeeded" || value.status === "failed") &&
    typeof value.workspace === "string" &&
    isRecord(value.agent) &&
    typeof value.agent.id === "string" &&
    Array.isArray(value.selected_skills) &&
    Array.isArray(value.runs)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
