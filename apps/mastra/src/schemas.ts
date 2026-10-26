import { z } from "zod/v4";

export const operatorTaskInputSchema = z.object({
  topic: z.string().min(1),
  audience: z.string().optional(),
  purpose: z.string().optional(),
  style: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  output_format: z.string().optional(),
  slide_count: z.number().int().positive().max(40).optional(),
  template_slug: z.string().optional(),
  template_mode: z.enum(["built_in_template", "custom_template", "original"]).optional(),
  user_template_path: z.string().optional(),
  selected_slides: z.array(z.number().int().positive()).optional(),
  style_variant: z.string().optional(),
  skill_source: z.string().optional(),
  skill_root: z.string().optional(),
  repo_url: z.string().optional(),
  github_url: z.string().optional(),
  target_workflow_id: z.string().optional(),
  target_package: z.string().optional(),
  codex_mode: z.enum(["enabled", "disabled"]).optional(),
  codex_model: z.string().optional(),
  original_test_command: z.string().optional(),
  consistency_expectations: z.array(z.string()).optional(),
  result_bundle_path: z.string().optional(),
  ara_repo_path: z.string().optional(),
  ara_python: z.string().optional(),
  paper_engine: z.enum(["native_ts", "legacy_ara_python"]).optional(),
  paper_domain: z.string().optional(),
  project_id: z.string().optional(),
  domain_id: z.string().optional(),
  venue_id: z.string().optional(),
  papers_path: z.string().optional(),
  memory_path: z.string().optional(),
  use_literature_memory: z.boolean().optional(),
  reference_audit_path: z.string().optional(),
  release_bundle_path: z.string().optional(),
  private_workspace: z.string().optional(),
  evidence_goal: z.enum(["private-handoff", "release-ready", "gap-closure", "evidence-progress"]).optional(),
  max_iterations: z.number().int().positive().max(20).optional(),
  max_dispatches_per_iteration: z.number().int().min(0).max(20).optional(),
  max_total_dispatches: z.number().int().min(0).max(100).optional(),
  max_stagnant_iterations: z.number().int().min(0).max(20).optional(),
  time_budget_seconds: z.number().positive().optional(),
  dispatch_timeout_seconds: z.number().positive().optional(),
  plan_only: z.boolean().optional(),
  run_improvement_loop: z.boolean().optional(),
  generate_manuscript: z.boolean().optional(),
  manuscript_title: z.string().optional(),
  manuscript_author: z.string().optional(),
  draft_notice: z.string().optional(),
  min_reference_count: z.number().int().positive().optional(),
  min_figure_count: z.number().int().min(0).optional(),
  min_word_count: z.number().int().positive().optional(),
  min_section_words: z.number().int().positive().optional(),
  min_pages: z.number().int().positive().optional(),
  min_formula_count: z.number().int().min(0).optional(),
  min_theorem_like_count: z.number().int().min(0).optional(),
  min_citation_count: z.number().int().min(0).optional(),
  min_tikz_figure_count: z.number().int().min(0).optional(),
  min_table_count: z.number().int().min(0).optional(),
  min_data_figure_count: z.number().int().min(0).optional(),
  max_meta_narrative_mentions: z.number().int().min(0).optional(),
  skip_pdf_compile: z.boolean().optional(),
  skip_chinese_companion: z.boolean().optional(),
  workspace: z.string().optional(),
  run_id: z.string().optional(),
  workflow_id: z.string().optional()
});

export const artifactSchema = z.object({
  name: z.string(),
  type: z.string(),
  path: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  sha256: z.string(),
  step_id: z.string(),
  metadata: z.record(z.string(), z.unknown())
});

export const briefSchema = z.object({
  topic: z.string(),
  audience: z.string(),
  purpose: z.string(),
  style: z.string(),
  constraints: z.array(z.string()),
  quality_bar: z.array(z.string())
});

export const normalizedBriefSchema = z.object({
  runId: z.string(),
  workspace: z.string(),
  input: operatorTaskInputSchema,
  brief: briefSchema,
  outputs: z.object({
    briefJson: z.string(),
    briefMarkdown: z.string()
  }),
  artifacts: z.array(artifactSchema)
});

export const renderedDeckSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  workspace: z.string(),
  outputFormat: z.enum(["pptx", "html", "workflow_pack", "pdf", "research"]),
  outputs: z.record(z.string(), z.string()),
  artifacts: z.array(artifactSchema),
  usage: z.record(z.string(), z.unknown()),
  logs: z.array(z.record(z.string(), z.unknown()))
});

export const workflowDeliverySchema = renderedDeckSchema.extend({
  validation: z.object({
    validated: z.literal(true),
    checks: z.array(z.record(z.string(), z.unknown()))
  })
});

export const pptWorkflowInputSchema = operatorTaskInputSchema;

export type OperatorTaskInputData = z.infer<typeof operatorTaskInputSchema>;
export type PptWorkflowInputData = OperatorTaskInputData;
export type NormalizedBriefData = z.infer<typeof normalizedBriefSchema>;
export type RenderedDeckData = z.infer<typeof renderedDeckSchema>;
export type WorkflowDeliveryData = z.infer<typeof workflowDeliverySchema>;
