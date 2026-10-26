import { z } from "zod";
import { OperatorErrorSchema } from "./errors.js";

export const RUN_STATUSES = ["queued", "running", "paused", "waiting", "skipped", "succeeded", "failed", "cancelled"] as const;

export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "skipped"] as const;
export const ACTIVE_RUN_STATUSES = ["queued", "running", "paused", "waiting"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

export const RunStatusSchema = z.enum(RUN_STATUSES);
export const TerminalRunStatusSchema = z.enum(TERMINAL_RUN_STATUSES);
export const ActiveRunStatusSchema = z.enum(ACTIVE_RUN_STATUSES);

const TERMINAL_STATUS_SET = new Set<RunStatus>(TERMINAL_RUN_STATUSES);
const ACTIVE_STATUS_SET = new Set<RunStatus>(ACTIVE_RUN_STATUSES);

const ALLOWED_TRANSITIONS: Record<ActiveRunStatus, ReadonlySet<RunStatus>> = {
  queued: new Set(["running", "cancelled"]),
  running: new Set(["waiting", "paused", "succeeded", "failed", "cancelled", "skipped"]),
  waiting: new Set(["running", "failed", "cancelled"]),
  paused: new Set(["running", "failed", "cancelled", "skipped"])
};

export const RunTerminalUpdateSchema = z.union([
  z
    .object({
      status: z.literal("succeeded"),
      output: z.record(z.unknown()).optional(),
      emptyOutputReason: z.string().min(1).optional()
    })
    .refine((value) => value.output !== undefined || value.emptyOutputReason !== undefined, {
      message: "succeeded runs require output or emptyOutputReason"
    }),
  z.object({
    status: z.literal("failed"),
    error: OperatorErrorSchema
  }),
  z.object({
    status: z.literal("cancelled"),
    actor: z.string().min(1),
    source: z.string().min(1).optional()
  }),
  z.object({
    status: z.literal("skipped"),
    reason: z.string().min(1)
  })
]);

export type RunTerminalUpdate = z.infer<typeof RunTerminalUpdateSchema>;

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUSES.includes(value as RunStatus);
}

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return TERMINAL_STATUS_SET.has(status);
}

export function isActiveRunStatus(status: RunStatus): status is ActiveRunStatus {
  return ACTIVE_STATUS_SET.has(status);
}

export function canTransitionRunStatus(from: RunStatus, to: RunStatus): boolean {
  if (from === to && isTerminalRunStatus(from)) return true;
  if (isTerminalRunStatus(from)) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRunStatus(from, to)) {
    throw new Error(`Invalid Operator run status transition: ${from} -> ${to}`);
  }
}
