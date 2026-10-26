import type { ArtifactRecord } from "@operator/core";
import type { OperatorConversationMessage as OperatorChatMessage } from "@operator/contracts";
import { summarizeLegacyMastraChatResult } from "../chat-result";
import type { LegacyMastraChatResult } from "./legacy-mastra-chat-result";

export type OperatorRuntimeSummaryResult = LegacyMastraChatResult;

export function summarizeOperatorRuntimeResult(
  result: OperatorRuntimeSummaryResult,
  options: {
    artifacts?: ArtifactRecord[];
    messages?: OperatorChatMessage[];
  } = {}
): string {
  return summarizeLegacyMastraChatResult(result, options);
}
