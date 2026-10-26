import type { LegacyMastraChatResult, LegacyOperatorChatAttachment, LegacyOperatorChatMessage } from "./legacy-mastra-chat-result";

export type OperatorAgentInProcessRunParams = {
  messages: LegacyOperatorChatMessage[];
  attachments: LegacyOperatorChatAttachment[];
  runId: string;
  workspace: string;
  scopeId?: string;
  onAgentTrace?: (trace: unknown) => void;
};

export async function runOperatorAgentInProcess(params: OperatorAgentInProcessRunParams): Promise<LegacyMastraChatResult> {
  const { runOperatorChat } = await import("@operator/mastra-app/chat");
  return (await runOperatorChat({
    messages: params.messages,
    attachments: params.attachments,
    runId: params.runId,
    workspace: params.workspace,
    scopeId: params.scopeId,
    onAgentTrace: params.onAgentTrace
  })) as LegacyMastraChatResult;
}
