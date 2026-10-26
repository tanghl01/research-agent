import { z } from "zod";

export const ARTIFACT_FINALIZATION_STATUSES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export type ArtifactFinalizationStatus = (typeof ARTIFACT_FINALIZATION_STATUSES)[number];

export const ArtifactFinalizationStatusSchema = z.enum(ARTIFACT_FINALIZATION_STATUSES);

export const ArtifactCandidateSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({})
});

export type ArtifactCandidate = z.infer<typeof ArtifactCandidateSchema>;

export const ArtifactContractSchema = ArtifactCandidateSchema.extend({
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  href: z.string().min(1),
  downloadHref: z.string().min(1).optional(),
  createdAt: z.string().min(1)
});

export type ArtifactContract = z.infer<typeof ArtifactContractSchema>;

export const ArtifactFinalizationResultSchema = z.object({
  status: ArtifactFinalizationStatusSchema,
  runId: z.string().min(1),
  taskId: z.string().min(1),
  artifacts: z.array(ArtifactContractSchema).default([]),
  error: z.record(z.unknown()).optional()
});

export type ArtifactFinalizationResult = z.infer<typeof ArtifactFinalizationResultSchema>;
