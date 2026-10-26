import { z } from "zod/v4";
import { artifactSchema, operatorTaskInputSchema } from "../../../schemas.js";

export const araJsonRecordSchema = z.record(z.string(), z.unknown());

export const araPaperQualityPolicySchema = z.object({
  minReferenceCount: z.number().int().positive(),
  minFigureCount: z.number().int().min(0),
  minWordCount: z.number().int().positive(),
  minSectionWords: z.number().int().positive(),
  minPages: z.number().int().positive(),
  minFormulaCount: z.number().int().min(0),
  minTheoremLikeCount: z.number().int().min(0),
  minCitationCount: z.number().int().min(0),
  minTikzFigureCount: z.number().int().min(0),
  minTableCount: z.number().int().min(0),
  minDataFigureCount: z.number().int().min(0),
  maxMetaNarrativeMentions: z.number().int().min(0)
});

export const araPaperRuntimeConfigSchema = z.object({
  repoPath: z.string(),
  pythonCommand: z.string(),
  resultBundlePath: z.string(),
  projectId: z.string(),
  topic: z.string(),
  domainId: z.string().optional(),
  venueId: z.string(),
  outputDir: z.string(),
  evidenceScoreDir: z.string(),
  handoffDir: z.string(),
  loopDir: z.string(),
  manuscriptProjectsDir: z.string(),
  nativeManuscriptDir: z.string(),
  paperEngine: z.enum(["native_ts", "legacy_ara_python"]),
  paperDomain: z.string(),
  authorName: z.string(),
  draftNotice: z.string(),
  qualityPolicy: araPaperQualityPolicySchema,
  privateWorkspace: z.string().optional(),
  papersPath: z.string().optional(),
  memoryPath: z.string().optional(),
  useLiteratureMemory: z.boolean(),
  referenceAuditPath: z.string().optional(),
  releaseBundlePath: z.string().optional(),
  runImprovementLoop: z.boolean(),
  planOnly: z.boolean(),
  evidenceGoal: z.enum(["private-handoff", "release-ready", "gap-closure", "evidence-progress"]),
  maxIterations: z.number().int().positive(),
  maxDispatchesPerIteration: z.number().int().min(0),
  maxTotalDispatches: z.number().int().min(0).optional(),
  maxStagnantIterations: z.number().int().min(0),
  timeBudgetSeconds: z.number().positive().optional(),
  dispatchTimeoutSeconds: z.number().positive(),
  generateManuscript: z.boolean(),
  manuscriptTitle: z.string().optional(),
  skipPdfCompile: z.boolean(),
  skipChineseCompanion: z.boolean()
});

export const araPaperPipelineStateSchema = z.object({
  runId: z.string(),
  workflowId: z.literal("research.paper-from-results"),
  workspace: z.string(),
  outputFormat: z.literal("research"),
  input: operatorTaskInputSchema,
  ara: araPaperRuntimeConfigSchema,
  outputs: z.record(z.string(), z.string()),
  artifacts: z.array(artifactSchema),
  usage: z.record(z.string(), z.unknown()),
  logs: z.array(araJsonRecordSchema),
  status: z.string(),
  validationResult: araJsonRecordSchema.optional(),
  draftingContext: araJsonRecordSchema.optional(),
  evidenceScore: araJsonRecordSchema.optional(),
  handoffResult: araJsonRecordSchema.optional(),
  improvementLoopResult: araJsonRecordSchema.optional(),
  manuscriptResult: araJsonRecordSchema.optional(),
  qualityReport: araJsonRecordSchema.optional()
});

export type AraPaperPipelineState = z.infer<typeof araPaperPipelineStateSchema>;
