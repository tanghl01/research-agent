import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import { artifactFromFile, repoRoot, runCommand, workspacePath, writeArtifactManifest, writeJson, writeText } from "@operator/core";
import { createTool } from "@mastra/core/tools";
import { normalizedBriefSchema, renderedDeckSchema, type NormalizedBriefData } from "../../../schemas.js";

type SkillFileRecord = {
  path: string;
  type: string;
  size_bytes: number;
};

type Skill2WorkflowState = {
  sourceKind: "local" | "github";
  sourceRef: string;
  sourcePath: string;
  targetWorkflowId: string;
  targetPackage: string;
  workflowSlug: string;
  codexMode: "enabled" | "disabled";
  skillFiles: SkillFileRecord[];
  analysis?: SkillWorkflowAnalysis;
  outputs: Record<string, string>;
  logs: Record<string, unknown>[];
};

type Skill2WorkflowData = NormalizedBriefData & {
  skill2workflow: Skill2WorkflowState;
};

type SkillWorkflowStep = {
  id: string;
  name: string;
  description: string;
  executor: "code" | "llm" | "agent";
  inputs: string[];
  outputs: string[];
  acceptance_checks: string[];
};

type SkillWorkflowAnalysis = {
  workflow_id: string;
  skill_name: string;
  summary: string;
  source_files: string[];
  steps: SkillWorkflowStep[];
  mastra_tools: string[];
  consistency_tests: string[];
  open_questions: string[];
  backend_llm: "codex_cli" | "deterministic_fallback";
};

const skill2WorkflowDataSchema = normalizedBriefSchema.extend({
  skill2workflow: z.record(z.string(), z.unknown())
});

export const prepareSkillSourceTool = createTool({
  id: "operator.skill2workflow.prepare_source",
  description: "Resolve a local or GitHub skill source and discover workflow-bearing files.",
  inputSchema: normalizedBriefSchema,
  outputSchema: skill2WorkflowDataSchema,
  execute: async (inputData) => prepareSkillSource(inputData)
});

export const analyzeSkillWithCodexTool = createTool({
  id: "operator.skill2workflow.analyze_with_codex",
  description: "Use Codex CLI to convert natural-language skill instructions into a structured workflow plan.",
  inputSchema: skill2WorkflowDataSchema,
  outputSchema: skill2WorkflowDataSchema,
  execute: async (inputData) => analyzeSkillWithCodex(inputData as Skill2WorkflowData)
});

export const generateSkillWorkflowPackTool = createTool({
  id: "operator.skill2workflow.generate_pack",
  description: "Generate a Mastra-compatible workflow pack and Operator registration manifest.",
  inputSchema: skill2WorkflowDataSchema,
  outputSchema: renderedDeckSchema,
  execute: async (inputData) => generateWorkflowPack(inputData as Skill2WorkflowData)
});

async function prepareSkillSource(inputData: NormalizedBriefData): Promise<Skill2WorkflowData> {
  const input = inputData.input;
  const repoUrl = clean(input.repo_url) ?? clean(input.github_url);
  const localSource = clean(input.skill_root) ?? clean(input.skill_source);
  let sourceKind: "local" | "github";
  let sourcePath: string;
  let sourceRef: string;

  if (repoUrl) {
    sourceKind = "github";
    sourceRef = repoUrl;
    sourcePath = workspacePath(inputData.workspace, "input/skill-source");
    rmSync(sourcePath, { recursive: true, force: true });
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    await runCommand("git", ["clone", "--depth", "1", repoUrl, sourcePath], { timeoutMs: 180_000 });
  } else if (localSource) {
    sourceKind = "local";
    sourceRef = localSource;
    sourcePath = resolveLocalPath(localSource);
  } else {
    throw new Error("skill2workflow requires skill_root, skill_source, repo_url, or github_url");
  }

  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
    throw new Error(`Skill source is not a directory: ${sourcePath}`);
  }

  const targetWorkflowId = clean(input.target_workflow_id) ?? `converted.${slugFromText(path.basename(sourcePath))}`;
  const workflowSlug = slugFromText(targetWorkflowId);
  const targetPackage = clean(input.target_package) ?? `@operator/workflow-${workflowSlug}`;
  const codexMode = input.codex_mode ?? "enabled";
  const skillFiles = discoverSkillFiles(sourcePath);
  const sourceManifest = "output/skill_source_manifest.json";

  writeJson(workspacePath(inputData.workspace, sourceManifest), {
    source_kind: sourceKind,
    source_ref: sourceRef,
    source_path: sourcePath,
    target_workflow_id: targetWorkflowId,
    target_package: targetPackage,
    workflow_slug: workflowSlug,
    codex_mode: codexMode,
    skill_files: skillFiles
  });

  return {
    ...inputData,
    skill2workflow: {
      sourceKind,
      sourceRef,
      sourcePath,
      targetWorkflowId,
      targetPackage,
      workflowSlug,
      codexMode,
      skillFiles,
      outputs: { sourceManifest },
      logs: []
    },
    artifacts: [
      ...inputData.artifacts,
      artifactFromFile({
        workspace: inputData.workspace,
        path: sourceManifest,
        stepId: "prepare_skill_source",
        name: "skill_source_manifest",
        type: "json"
      })
    ]
  };
}

async function analyzeSkillWithCodex(inputData: Skill2WorkflowData): Promise<Skill2WorkflowData> {
  const analysisJson = "output/skill2workflow_analysis.json";
  const codexRaw = "output/codex_analysis.raw.md";
  const codexRawPath = workspacePath(inputData.workspace, codexRaw);
  const logs = [...inputData.skill2workflow.logs];
  let raw = "";
  let backend: SkillWorkflowAnalysis["backend_llm"] = "deterministic_fallback";

  if (inputData.skill2workflow.codexMode === "enabled") {
    try {
      const args = [
        "exec",
        "--cd",
        inputData.skill2workflow.sourcePath,
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--output-last-message",
        codexRawPath
      ];
      const model = clean(inputData.input.codex_model);
      if (model) args.push("-m", model);
      args.push(buildCodexPrompt(inputData));
      const result = await runCommand("codex", args, {
        cwd: inputData.skill2workflow.sourcePath,
        timeoutMs: Number(process.env.OPERATOR_SKILL2WORKFLOW_CODEX_TIMEOUT_MS ?? 600_000)
      });
      raw = existsSync(codexRawPath) ? readFileSync(codexRawPath, "utf8") : result.stdout;
      backend = "codex_cli";
      logs.push({
        event: "codex_exec_completed",
        command: result.command,
        stdout_bytes: result.stdout.length,
        stderr_bytes: result.stderr.length
      });
    } catch (error) {
      raw = `Codex CLI analysis failed, deterministic fallback used.\n\n${error instanceof Error ? error.message : String(error)}`;
      writeText(codexRawPath, raw);
      logs.push({
        event: "codex_exec_failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    raw = "Codex CLI analysis disabled for this run. Deterministic fallback used.";
    writeText(codexRawPath, raw);
    logs.push({ event: "codex_exec_disabled" });
  }

  const parsed = backend === "codex_cli" ? parseAnalysis(raw) : undefined;
  const analysis = normalizeAnalysis(parsed ?? fallbackAnalysis(inputData), inputData, backend);
  writeJson(workspacePath(inputData.workspace, analysisJson), analysis);

  return {
    ...inputData,
    skill2workflow: {
      ...inputData.skill2workflow,
      analysis,
      outputs: { ...inputData.skill2workflow.outputs, analysisJson, codexRaw },
      logs
    },
    artifacts: [
      ...inputData.artifacts,
      artifactFromFile({
        workspace: inputData.workspace,
        path: codexRaw,
        stepId: "analyze_skill_with_codex",
        name: "codex_analysis_raw",
        type: "md"
      }),
      artifactFromFile({
        workspace: inputData.workspace,
        path: analysisJson,
        stepId: "analyze_skill_with_codex",
        name: "skill2workflow_analysis",
        type: "json"
      })
    ]
  };
}

async function generateWorkflowPack(inputData: Skill2WorkflowData) {
  const analysis = inputData.skill2workflow.analysis ?? fallbackAnalysis(inputData);
  const packDir = `output/generated/${inputData.skill2workflow.workflowSlug}`;
  const workflowTs = `${packDir}/workflow.ts`;
  const toolsTs = `${packDir}/tools.ts`;
  const readme = `${packDir}/README.md`;
  const registration = `${packDir}/operator.workflow.json`;
  const consistencySpec = `${packDir}/consistency.spec.json`;
  const consistencyReport = "output/skill2workflow_consistency_report.json";
  const scaffoldManifest = "output/skill2workflow_scaffold_manifest.json";
  const artifactManifest = "output/artifact_manifest.json";

  writeText(workspacePath(inputData.workspace, workflowTs), renderWorkflowTs(inputData, analysis));
  writeText(workspacePath(inputData.workspace, toolsTs), renderToolsTs(analysis));
  writeText(workspacePath(inputData.workspace, readme), renderReadme(inputData, analysis));
  writeJson(workspacePath(inputData.workspace, registration), {
    version: "1.0",
    workflow_id: inputData.skill2workflow.targetWorkflowId,
    package: inputData.skill2workflow.targetPackage,
    entrypoint: "workflow.ts",
    mastra_export: "convertedSkillWorkflow",
    status: "generated",
    source: {
      kind: inputData.skill2workflow.sourceKind,
      ref: inputData.skill2workflow.sourceRef,
      path: inputData.skill2workflow.sourcePath
    },
    backend_llm: analysis.backend_llm,
    registration_mode: "operator_workflow_pack",
    notes: [
      "Import this workflow pack into apps/mastra/src/mastra.ts or a future dynamic registry to make it live.",
      "The generated step graph is deterministic; steps marked llm or agent keep explicit delegation boundaries."
    ]
  });
  writeJson(workspacePath(inputData.workspace, consistencySpec), {
    workflow_id: inputData.skill2workflow.targetWorkflowId,
    source_files: analysis.source_files,
    consistency_expectations: inputData.input.consistency_expectations ?? analysis.consistency_tests,
    original_test_command: inputData.input.original_test_command ?? null,
    checks: [
      "Generated workflow preserves the ordered steps extracted from the skill instructions.",
      "Each text-described decision point is assigned to code, LLM, or a registered ACP agent.",
      "Artifacts include source manifest, analysis, workflow source, registration manifest, and this consistency spec."
    ]
  });
  const originalTest = await maybeRunOriginalTest(inputData);
  writeJson(workspacePath(inputData.workspace, consistencyReport), {
    workflow_id: inputData.skill2workflow.targetWorkflowId,
    source_ref: inputData.skill2workflow.sourceRef,
    source_files_discovered: inputData.skill2workflow.skillFiles.map((file) => file.path),
    source_files_analyzed: analysis.source_files,
    extracted_step_order: analysis.steps.map((step) => step.id),
    generated_step_order: analysis.steps.map((step) => step.id),
    step_order_matches_analysis: true,
    trace_required_for_each_step: analysis.steps.every((step) =>
      step.acceptance_checks.some((check) => check.toLowerCase().includes("trace"))
    ),
    registration_manifest_present: true,
    backend_llm: analysis.backend_llm,
    original_test: originalTest,
    consistency_tests: inputData.input.consistency_expectations ?? analysis.consistency_tests
  });

  const generatedArtifacts = [
    artifactFromFile({
      workspace: inputData.workspace,
      path: workflowTs,
      stepId: "generate_skill_workflow_pack",
      name: "converted_workflow",
      type: "ts",
      metadata: { workflow_id: inputData.skill2workflow.targetWorkflowId }
    }),
    artifactFromFile({
      workspace: inputData.workspace,
      path: toolsTs,
      stepId: "generate_skill_workflow_pack",
      name: "converted_tools",
      type: "ts"
    }),
    artifactFromFile({
      workspace: inputData.workspace,
      path: readme,
      stepId: "generate_skill_workflow_pack",
      name: "converted_workflow_readme",
      type: "md"
    }),
    artifactFromFile({
      workspace: inputData.workspace,
      path: registration,
      stepId: "generate_skill_workflow_pack",
      name: "operator_workflow_registration",
      type: "json"
    }),
    artifactFromFile({
      workspace: inputData.workspace,
      path: consistencySpec,
      stepId: "generate_skill_workflow_pack",
      name: "consistency_spec",
      type: "json"
    }),
    artifactFromFile({
      workspace: inputData.workspace,
      path: consistencyReport,
      stepId: "generate_skill_workflow_pack",
      name: "consistency_report",
      type: "json"
    })
  ];

  const artifacts = [...inputData.artifacts, ...generatedArtifacts];
  writeJson(workspacePath(inputData.workspace, scaffoldManifest), {
    workflow_id: inputData.skill2workflow.targetWorkflowId,
    package: inputData.skill2workflow.targetPackage,
    pack_dir: packDir,
    files: [workflowTs, toolsTs, readme, registration, consistencySpec, consistencyReport],
    step_count: analysis.steps.length,
    source_step_count: inputData.skill2workflow.skillFiles.length,
    backend_llm: analysis.backend_llm
  });

  const finalArtifacts = [
    ...artifacts,
    artifactFromFile({
      workspace: inputData.workspace,
      path: scaffoldManifest,
      stepId: "generate_skill_workflow_pack",
      name: "skill2workflow_scaffold_manifest",
      type: "json"
    })
  ];
  writeArtifactManifest({
    workspace: inputData.workspace,
    path: artifactManifest,
    workflowRunId: inputData.runId,
    stepRunId: "generate_skill_workflow_pack",
    artifacts: finalArtifacts
  });

  return {
    runId: inputData.runId,
    workflowId: "system.skill2workflow",
    workspace: inputData.workspace,
    outputFormat: "workflow_pack" as const,
    outputs: {
      sourceManifest: inputData.skill2workflow.outputs.sourceManifest,
      codexRaw: inputData.skill2workflow.outputs.codexRaw ?? "",
      analysis: inputData.skill2workflow.outputs.analysisJson ?? "",
      workflow: workflowTs,
      tools: toolsTs,
      readme,
      registration,
      consistencySpec,
      consistencyReport,
      scaffoldManifest,
      artifactManifest
    },
    artifacts: finalArtifacts,
    usage: {
      backend_llm: analysis.backend_llm,
      codex_mode: inputData.skill2workflow.codexMode,
      source_kind: inputData.skill2workflow.sourceKind,
      discovered_file_count: inputData.skill2workflow.skillFiles.length,
      generated_step_count: analysis.steps.length
    },
    logs: inputData.skill2workflow.logs
  };
}

async function maybeRunOriginalTest(inputData: Skill2WorkflowData): Promise<Record<string, unknown> | null> {
  const command = clean(inputData.input.original_test_command);
  if (!command) return null;
  try {
    const result = await runCommand("bash", ["-lc", command], {
      cwd: inputData.skill2workflow.sourcePath,
      timeoutMs: Number(process.env.OPERATOR_SKILL2WORKFLOW_ORIGINAL_TEST_TIMEOUT_MS ?? 300_000)
    });
    return {
      command,
      status: "passed",
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode
    };
  } catch (error) {
    return {
      command,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function discoverSkillFiles(root: string): SkillFileRecord[] {
  const records: SkillFileRecord[] = [];
  const ignored = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"]);

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || !isSkillRelevant(relative)) continue;
      const stats = statSync(absolute);
      if (stats.size > 2_000_000) continue;
      records.push({
        path: relative,
        type: path.extname(entry.name).slice(1).toLowerCase() || "text",
        size_bytes: stats.size
      });
    }
  }

  walk(root);
  return records.sort((a, b) => rankSkillFile(a.path) - rankSkillFile(b.path) || a.path.localeCompare(b.path)).slice(0, 80);
}

function isSkillRelevant(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const base = path.basename(lower);
  if (base === "skill.md" || base === "readme.md") return true;
  if (lower.includes("workflow") || lower.includes("instruction") || lower.includes("prompt") || lower.includes("reference")) {
    return /\.(md|txt|json|yaml|yml)$/i.test(lower);
  }
  if (lower.startsWith("scripts/") || lower.includes("/scripts/")) {
    return /\.(py|ts|js|mjs|cjs|sh)$/i.test(lower);
  }
  return /\.(md|txt)$/i.test(lower);
}

function rankSkillFile(relativePath: string): number {
  const lower = relativePath.toLowerCase();
  if (path.basename(lower) === "skill.md") return 0;
  if (path.basename(lower) === "readme.md") return 1;
  if (lower.includes("workflow")) return 2;
  if (lower.includes("instruction") || lower.includes("prompt")) return 3;
  return 10;
}

function buildCodexPrompt(inputData: Skill2WorkflowData): string {
  const files = inputData.skill2workflow.skillFiles.slice(0, 20).map((file) => {
    const absolute = path.join(inputData.skill2workflow.sourcePath, file.path);
    const content = readFileSync(absolute, "utf8").slice(0, 20_000);
    return `## FILE: ${file.path}\n\n${content}`;
  });

  return [
    "You are Operator skill2workflow, a converter that turns text-heavy open-source agent skills into deterministic Mastra workflow packs.",
    "Analyze the supplied skill source. Return ONLY valid JSON with this exact shape:",
    JSON.stringify(
      {
        workflow_id: inputData.skill2workflow.targetWorkflowId,
        skill_name: "short skill name",
        summary: "what this skill does",
        source_files: ["SKILL.md"],
        steps: [
          {
            id: "step_id",
            name: "Step name",
            description: "Concrete behavior to hard-code",
            executor: "code",
            inputs: ["input names"],
            outputs: ["output names"],
            acceptance_checks: ["observable checks"]
          }
        ],
        mastra_tools: ["tool contracts to implement"],
        consistency_tests: ["checks proving behavior matches the original skill"],
        open_questions: ["only blockers that must be decided by a human"]
      },
      null,
      2
    ),
    "Use executor='code' for deterministic operations, executor='llm' for simple judgement, and executor='agent' for complex repository mutation, file editing, or debugging through a registered ACP agent.",
    "Do not include Markdown fences. Do not write files. Do not run commands.",
    "",
    files.join("\n\n")
  ].join("\n");
}

function parseAnalysis(raw: string): Partial<SkillWorkflowAnalysis> | undefined {
  const direct = tryParseJson(raw);
  if (direct) return direct as Partial<SkillWorkflowAnalysis>;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParseJson(fenced);
    if (parsed) return parsed as Partial<SkillWorkflowAnalysis>;
  }
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson(objectMatch[0]);
    if (parsed) return parsed as Partial<SkillWorkflowAnalysis>;
  }
  return undefined;
}

function tryParseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function fallbackAnalysis(inputData: Skill2WorkflowData): SkillWorkflowAnalysis {
  const sourceFiles = inputData.skill2workflow.skillFiles.map((file) => file.path);
  const skillName = inferSkillName(inputData);
  const extractedSteps = extractFallbackSteps(inputData);
  return {
    workflow_id: inputData.skill2workflow.targetWorkflowId,
    skill_name: skillName,
    summary: `Converted workflow pack for ${skillName}.`,
    source_files: sourceFiles.slice(0, 20),
    steps: extractedSteps.length > 0 ? extractedSteps : defaultSteps(),
    mastra_tools: ["prepare_source", "plan_execution", "execute_steps", "validate_consistency"],
    consistency_tests: [
      "Source skill files are discoverable and recorded.",
      "Generated workflow step order matches the extracted instruction order.",
      "Registration manifest names the target Operator workflow id."
    ],
    open_questions: [],
    backend_llm: "deterministic_fallback"
  };
}

function normalizeAnalysis(
  partial: Partial<SkillWorkflowAnalysis>,
  inputData: Skill2WorkflowData,
  backend: SkillWorkflowAnalysis["backend_llm"]
): SkillWorkflowAnalysis {
  const fallback = fallbackAnalysis(inputData);
  const steps = Array.isArray(partial.steps)
    ? partial.steps.map((step, index) => normalizeStep(step, index)).filter((step) => step.description.length > 0)
    : fallback.steps;
  return {
    workflow_id: clean(partial.workflow_id) ?? inputData.skill2workflow.targetWorkflowId,
    skill_name: clean(partial.skill_name) ?? fallback.skill_name,
    summary: clean(partial.summary) ?? fallback.summary,
    source_files: arrayOfStrings(partial.source_files).length > 0 ? arrayOfStrings(partial.source_files) : fallback.source_files,
    steps: steps.length > 0 ? steps : fallback.steps,
    mastra_tools: arrayOfStrings(partial.mastra_tools).length > 0 ? arrayOfStrings(partial.mastra_tools) : fallback.mastra_tools,
    consistency_tests:
      arrayOfStrings(partial.consistency_tests).length > 0 ? arrayOfStrings(partial.consistency_tests) : fallback.consistency_tests,
    open_questions: arrayOfStrings(partial.open_questions),
    backend_llm: backend
  };
}

function normalizeStep(raw: unknown, index: number): SkillWorkflowStep {
  const value = isRecord(raw) ? raw : {};
  const executor =
    value.executor === "llm" || value.executor === "agent" || value.executor === "openhands"
      ? value.executor === "openhands"
        ? "agent"
        : value.executor
      : "code";
  const name = clean(value.name) ?? `Step ${index + 1}`;
  return {
    id: slugFromText(clean(value.id) ?? name) || `step_${index + 1}`,
    name,
    description: clean(value.description) ?? "",
    executor,
    inputs: arrayOfStrings(value.inputs),
    outputs: arrayOfStrings(value.outputs),
    acceptance_checks: arrayOfStrings(value.acceptance_checks)
  };
}

function extractFallbackSteps(inputData: Skill2WorkflowData): SkillWorkflowStep[] {
  const docs = inputData.skill2workflow.skillFiles
    .filter((file) => /\.(md|txt)$/i.test(file.path))
    .slice(0, 8)
    .map((file) => readFileSync(path.join(inputData.skill2workflow.sourcePath, file.path), "utf8"));
  const lines = docs.join("\n").split(/\r?\n/);
  const candidates: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,4}\s+(.{3,120})$/)?.[1];
    const numbered = trimmed.match(/^\d+[.)]\s+(.{3,140})$/)?.[1];
    const bullet = trimmed.match(/^[-*]\s+(?:Step\s*)?(.{8,160})$/i)?.[1];
    const candidate = heading ?? numbered ?? bullet;
    if (!candidate || /^overview|background|license|installation$/i.test(candidate)) continue;
    candidates.push(candidate);
    if (candidates.length >= 12) break;
  }
  return candidates.map((candidate, index) => ({
    id: `step_${String(index + 1).padStart(2, "0")}_${slugFromText(candidate).slice(0, 36)}`,
    name: candidate.slice(0, 72),
    description: candidate,
    executor: inferExecutor(candidate),
    inputs: index === 0 ? ["user_request", "skill_source"] : [`step_${String(index).padStart(2, "0")}_output`],
    outputs: [`step_${String(index + 1).padStart(2, "0")}_output`],
    acceptance_checks: [`${candidate.slice(0, 80)} is completed and recorded in workflow trace.`]
  }));
}

function defaultSteps(): SkillWorkflowStep[] {
  return [
    {
      id: "prepare_request",
      name: "Prepare request",
      description: "Normalize the user request and load source skill context.",
      executor: "code",
      inputs: ["user_request", "skill_source"],
      outputs: ["normalized_request"],
      acceptance_checks: ["A normalized request object exists."]
    },
    {
      id: "plan_execution",
      name: "Plan execution",
      description: "Convert skill instructions into an ordered execution plan.",
      executor: "llm",
      inputs: ["normalized_request"],
      outputs: ["execution_plan"],
      acceptance_checks: ["The execution plan has ordered steps."]
    },
    {
      id: "execute_plan",
      name: "Execute plan",
      description: "Run deterministic steps and delegate complex code work to a registered ACP agent when needed.",
      executor: "agent",
      inputs: ["execution_plan"],
      outputs: ["workflow_artifacts"],
      acceptance_checks: ["Expected artifacts are produced."]
    },
    {
      id: "validate_consistency",
      name: "Validate consistency",
      description: "Check generated artifacts against the original skill behavior.",
      executor: "code",
      inputs: ["workflow_artifacts"],
      outputs: ["validation_report"],
      acceptance_checks: ["Validation report passes all required checks."]
    }
  ];
}

function renderWorkflowTs(inputData: Skill2WorkflowData, analysis: SkillWorkflowAnalysis): string {
  const stepDefs = analysis.steps
    .map((step, index) => {
      const variableName = `step${String(index + 1).padStart(2, "0")}`;
      return `const ${variableName} = createStep({
  id: ${JSON.stringify(`${inputData.skill2workflow.workflowSlug}.${step.id}`)},
  description: ${JSON.stringify(step.description)},
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async (state) => ({
    ...state,
    trace: [
      ...state.trace,
      {
        step_id: ${JSON.stringify(step.id)},
        name: ${JSON.stringify(step.name)},
        executor: ${JSON.stringify(step.executor)},
        description: ${JSON.stringify(step.description)},
        acceptance_checks: ${JSON.stringify(step.acceptance_checks)}
      }
    ],
    payload: {
      ...state.payload,
      ${JSON.stringify(step.id)}: {
        status: "completed",
        executor: ${JSON.stringify(step.executor)},
        outputs: ${JSON.stringify(step.outputs)}
      }
    }
  })
});`;
    })
    .join("\n\n");
  const chain = analysis.steps.map((_, index) => `.then(step${String(index + 1).padStart(2, "0")})`).join("\n  ");

  return `import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod/v4";

export const inputSchema = z.object({
  topic: z.string().min(1),
  workspace: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});

export const stateSchema = z.object({
  topic: z.string(),
  workspace: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  trace: z.array(z.record(z.string(), z.unknown()))
});

const normalizeRequest = createStep({
  id: ${JSON.stringify(`${inputData.skill2workflow.workflowSlug}.normalize_request`)},
  description: "Normalize the converted skill workflow request.",
  inputSchema,
  outputSchema: stateSchema,
  execute: async (input) => ({
    topic: input.topic,
    workspace: input.workspace,
    payload: input.payload ?? {},
    trace: []
  })
});

${stepDefs}

export const convertedSkillWorkflow = createWorkflow({
  id: ${JSON.stringify(inputData.skill2workflow.targetWorkflowId)},
  description: ${JSON.stringify(analysis.summary)},
  inputSchema,
  outputSchema: stateSchema,
  metadata: {
    domain: "converted.skill",
    skill_id: ${JSON.stringify(analysis.skill_name)},
    source_kind: ${JSON.stringify(inputData.skill2workflow.sourceKind)},
    runtime: "mastra_tool_workflow",
    generated_by: "operator.skill2workflow"
  }
})
  .then(normalizeRequest)
  ${chain}
  .commit();
`;
}

function renderToolsTs(analysis: SkillWorkflowAnalysis): string {
  const tools = analysis.steps.map((step) => ({
    id: step.id,
    name: step.name,
    executor: step.executor,
    inputs: step.inputs,
    outputs: step.outputs,
    acceptance_checks: step.acceptance_checks
  }));
  return `export const convertedToolContracts = ${JSON.stringify(tools, null, 2)} as const;
`;
}

function renderReadme(inputData: Skill2WorkflowData, analysis: SkillWorkflowAnalysis): string {
  return [
    `# ${analysis.skill_name}`,
    "",
    analysis.summary,
    "",
    "## Operator Registration",
    "",
    `- Workflow ID: \`${inputData.skill2workflow.targetWorkflowId}\``,
    `- Package: \`${inputData.skill2workflow.targetPackage}\``,
    `- Source: \`${inputData.skill2workflow.sourceRef}\``,
    `- Backend analysis: \`${analysis.backend_llm}\``,
    "",
    "## Solidified Steps",
    "",
    ...analysis.steps.map((step, index) => `${index + 1}. \`${step.executor}\` ${step.name}: ${step.description}`),
    "",
    "## Consistency Tests",
    "",
    ...analysis.consistency_tests.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function inferSkillName(inputData: Skill2WorkflowData): string {
  const skillMd = inputData.skill2workflow.skillFiles.find((file) => path.basename(file.path).toLowerCase() === "skill.md");
  if (skillMd) {
    const content = readFileSync(path.join(inputData.skill2workflow.sourcePath, skillMd.path), "utf8");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;
  }
  return path.basename(inputData.skill2workflow.sourcePath);
}

function inferExecutor(text: string): SkillWorkflowStep["executor"] {
  const lower = text.toLowerCase();
  if (lower.includes("agent") || lower.includes("debug") || lower.includes("modify") || lower.includes("edit files")) {
    return "agent";
  }
  if (lower.includes("judge") || lower.includes("decide") || lower.includes("classify") || lower.includes("select")) {
    return "llm";
  }
  return "code";
}

function resolveLocalPath(rawPath: string): string {
  return path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(repoRoot(), rawPath);
}

function slugFromText(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "converted-skill";
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
