import { z } from "zod";
import { ArtifactContractSchema } from "./artifacts.js";
import { MessageContractSchema } from "./messages.js";
import { ProductEventSchema } from "./run-events.js";
import { RunStatusSchema } from "./run-status.js";

export const TaskRunSummarySchema = z.object({
  runId: z.string().min(1),
  status: RunStatusSchema,
  startedAt: z.string().min(1).optional(),
  finishedAt: z.string().min(1).optional(),
  error: z.record(z.unknown()).nullable().optional(),
  output: z.record(z.unknown()).default({})
});

export type TaskRunSummary = z.infer<typeof TaskRunSummarySchema>;

export const TaskSnapshotSchema = z.object({
  taskId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
  exists: z.boolean(),
  latestRun: TaskRunSummarySchema.optional(),
  messages: z.array(MessageContractSchema).default([]),
  events: z.array(ProductEventSchema).default([]),
  productEvents: z.array(ProductEventSchema).default([]),
  agUiEvents: z.array(z.unknown()).default([]),
  artifacts: z.array(ArtifactContractSchema).default([]),
  backend: z.enum(["server", "local", "legacy"]).optional(),
  compatibility: z.record(z.unknown()).optional()
});

export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
