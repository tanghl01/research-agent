import { z } from "zod";
import { ArtifactCandidateSchema } from "./artifacts.js";
import { OperatorErrorSchema } from "./errors.js";
import { ProductEventSchema } from "./run-events.js";
import { RunIdentitySchema } from "./run-identity.js";

export const RUNTIME_ATTEMPT_PROVIDERS = ["mastra", "acp", "workflow", "codex", "claude", "openhands", "deepseek", "other"] as const;
export const RUNTIME_ATTEMPT_STATUSES = ["started", "succeeded", "failed", "skipped"] as const;

export const RuntimeAttemptProviderSchema = z.enum(RUNTIME_ATTEMPT_PROVIDERS);
export const RuntimeAttemptStatusSchema = z.enum(RUNTIME_ATTEMPT_STATUSES);

export const RuntimeAttemptSchema = z.object({
  runtimeId: z.string().min(1),
  provider: RuntimeAttemptProviderSchema,
  status: RuntimeAttemptStatusSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  error: OperatorErrorSchema.optional()
});

export type RuntimeAttempt = z.infer<typeof RuntimeAttemptSchema>;

export const RuntimeAdapterResultSchema = z
  .object({
    identity: RunIdentitySchema,
    status: z.enum(["succeeded", "failed", "cancelled"]),
    response: z.string().optional(),
    output: z.record(z.unknown()).default({}),
    artifacts: z.array(ArtifactCandidateSchema).default([]),
    attempts: z.array(RuntimeAttemptSchema).default([]),
    trace: z.array(ProductEventSchema).default([]),
    error: OperatorErrorSchema.optional(),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1)
  })
  .refine((result) => result.status !== "failed" || result.error !== undefined, {
    message: "failed runtime results require OperatorError"
  });

export type RuntimeAdapterResult = z.infer<typeof RuntimeAdapterResultSchema>;
