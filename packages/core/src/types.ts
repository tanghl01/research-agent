export type PptWorkflowInput = {
  topic: string;
  audience?: string;
  purpose?: string;
  style?: string;
  constraints?: string[];
  output_format?: string;
  template_slug?: string;
  template_mode?: "built_in_template" | "custom_template" | "original";
  user_template_path?: string;
  selected_slides?: number[];
  style_variant?: string;
  skill_source?: string;
  skill_root?: string;
  repo_url?: string;
  github_url?: string;
  target_workflow_id?: string;
  target_package?: string;
  codex_mode?: "enabled" | "disabled";
  codex_model?: string;
  original_test_command?: string;
  consistency_expectations?: string[];
  workspace?: string;
  run_id?: string;
  workflow_id?: string;
};

export type PresentationBrief = {
  topic: string;
  audience: string;
  purpose: string;
  style: string;
  constraints: string[];
  quality_bar: string[];
};

export type ArtifactRecord = {
  name: string;
  type: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  step_id: string;
  metadata: Record<string, unknown>;
};

export type ValidationCheck = {
  type: string;
  status: "passed";
  path?: string;
  [key: string]: unknown;
};

export type WorkflowRoute = {
  key: string;
  workflow_id: string;
  reason: string;
  score: number;
  matched_terms: string[];
};

export type WorkflowRunSummary = {
  run_id: string;
  workflow_id: string;
  status: string;
  workspace: string;
  routing?: WorkflowRoute;
  result?: unknown;
  error?: unknown;
};
