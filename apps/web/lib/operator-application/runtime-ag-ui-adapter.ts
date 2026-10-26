import { EventType, type RunFinishedEvent, type StepFinishedEvent, type StepStartedEvent } from "@ag-ui/core";
import { agUiTimestamp, customEvent, runError, type OperatorAgUiEvent } from "../ag-ui";
import type { LegacyMastraChatResult } from "./legacy-mastra-chat-result";

export function buildRuntimeAgUiEvents(
  result: LegacyMastraChatResult,
  threadId: string,
  options: { includeTrace?: boolean } = {}
): OperatorAgUiEvent[] {
  const timestamp = agUiTimestamp();
  const events: OperatorAgUiEvent[] = [];
  const includeTrace = options.includeTrace ?? true;
  const defaultMainAgentRun = !result.selected_skills.length && !result.runs.length;
  const firstStepName = defaultMainAgentRun ? "acp_main_agent" : "scope_selection";

  events.push(stepStarted(firstStepName, timestamp));
  if (result.selected_skills.length) {
    events.push(customEvent("operator.selected_skills", result.selected_skills, timestamp));
  }
  events.push(stepFinished(firstStepName, timestamp));

  for (const run of result.runs) {
    events.push(customEvent("operator.skill_run", run, timestamp));
  }

  if (includeTrace) {
    for (const trace of result.agent.trace ?? []) {
      events.push(customEvent("operator.agent_trace", trace, timestamp));
    }
  }

  if (result.status === "succeeded") {
    events.push({
      type: EventType.RUN_FINISHED,
      threadId,
      runId: result.run_id,
      timestamp,
      outcome: { type: "success" },
      result
    } satisfies RunFinishedEvent);
  } else {
    events.push(runError(result.agent.error ?? "Operator task failed", "OPERATOR_TASK_FAILED", timestamp));
  }

  return events;
}

function stepStarted(stepName: string, timestamp: number): StepStartedEvent {
  return {
    type: EventType.STEP_STARTED,
    timestamp,
    stepName
  };
}

function stepFinished(stepName: string, timestamp: number): StepFinishedEvent {
  return {
    type: EventType.STEP_FINISHED,
    timestamp,
    stepName
  };
}
