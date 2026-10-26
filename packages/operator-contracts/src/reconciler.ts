import { z } from "zod";

export const RunReconcileJobPayloadSchema = z.object({
  taskId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
});

export type RunReconcileJobPayload = z.infer<typeof RunReconcileJobPayloadSchema>;

export const ReconcileDecisionSchema = z.object({
  taskId: z.string().min(1),
  runId: z.string().min(1).optional(),
  action: z.enum(["repaired", "skipped"]),
  reason: z.string().min(1),
  evidence: z
    .array(
      z.object({
        source: z.enum(["task_snapshot", "chat_result", "admin", "query"]),
        ref: z.string().min(1)
      })
    )
    .default([])
});

export type ReconcileDecision = z.infer<typeof ReconcileDecisionSchema>;
