import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import {
  artifactFromFile,
  relativeToWorkspace,
  repoRoot,
  resolveWorkspace,
  runCommand,
  validateFileExists,
  writeJson,
  writeText,
  workspacePath,
  type ArtifactRecord
} from "@operator/core";
import { operatorTaskInputSchema, workflowDeliverySchema } from "../../../schemas.js";
import { araPaperPipelineStateSchema, type AraPaperPipelineState } from "./schemas.js";
import {
  buildNativeBundleValidation,
  buildNativeDraftingContext,
  buildNativeEvidenceScore,
  buildNativePrivateHandoff,
  renderNativeManuscript
} from "./native-paper.js";

const workflowId = "research.paper-from-results";
const outputFormat = "research" as const;
const outputDir = "runs/research-paper/output";
const artifactSuffixes = new Set([".bib", ".json", ".log", ".md", ".pdf", ".tex", ".txt", ".zip"]);

type JsonRecord = Record<string, unknown>;

export const prepareAraPaperInputsTool = createTool({
  id: "operator.research.ara_paper.prepare_inputs",
  description: "Normalize ARA result-bundle paper-production inputs for the Mastra workflow boundary.",
  inputSchema: operatorTaskInputSchema,
  outputSchema: araPaperPipelineStateSchema,
  execute: async (inputData) => {
    const runId = inputData.run_id ?? `wr_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const workspace = resolveWorkspace(inputData.workspace, runId);
    const repoPath = resolveAraRepoPath(inputData.ara_repo_path);
    const pythonCommand = inputData.ara_python?.trim() || process.env.OPERATOR_ARA_PYTHON?.trim() || "python3";
    const resultBundlePath = resolveResultBundlePath(inputData.result_bundle_path, workspace, repoPath);
    const projectId = sanitizeProjectId(inputData.project_id || inputData.topic || runId);
    const topic = inputData.topic.trim();
    const paperEngine = inputData.paper_engine ?? "native_ts";
    const paperDomain = inputData.paper_domain?.trim() || inputData.domain_id?.trim() || "auto";
    const mathLikePaper = isMathLikePaper(`${paperDomain} ${topic}`);
    const empiricalPaper = !mathLikePaper;
    const qualityPolicy = {
      minReferenceCount: inputData.min_reference_count ?? 20,
      minFigureCount: inputData.min_figure_count ?? (mathLikePaper ? 2 : 4),
      minWordCount: inputData.min_word_count ?? (mathLikePaper ? 2_200 : 5_200),
      minSectionWords: inputData.min_section_words ?? (mathLikePaper ? 120 : 260),
      minPages: inputData.min_pages ?? (mathLikePaper ? 5 : 10),
      minFormulaCount: inputData.min_formula_count ?? (mathLikePaper ? 12 : 4),
      minTheoremLikeCount: inputData.min_theorem_like_count ?? (mathLikePaper ? 4 : 0),
      minCitationCount: inputData.min_citation_count ?? (mathLikePaper ? 8 : 18),
      minTikzFigureCount: inputData.min_tikz_figure_count ?? (mathLikePaper ? 2 : 4),
      minTableCount: inputData.min_table_count ?? (empiricalPaper ? 3 : 1),
      minDataFigureCount: inputData.min_data_figure_count ?? (empiricalPaper ? 4 : 0),
      maxMetaNarrativeMentions: inputData.max_meta_narrative_mentions ?? (empiricalPaper ? 0 : 3)
    };
    const runtimeConfigJson = `${outputDir}/ara_runtime_config.json`;
    const summaryMarkdown = `${outputDir}/paper_pipeline_summary.md`;
    const ara = {
      repoPath,
      pythonCommand,
      resultBundlePath,
      projectId,
      topic,
      domainId: inputData.domain_id?.trim() || undefined,
      venueId: inputData.venue_id?.trim() || "generic_top_tier",
      outputDir,
      evidenceScoreDir: `${outputDir}/evidence_score`,
      handoffDir: `${outputDir}/private_handoff`,
      loopDir: `${outputDir}/improvement_loop`,
      manuscriptProjectsDir: `${outputDir}/ara_projects`,
      nativeManuscriptDir: `${outputDir}/native_manuscript`,
      paperEngine,
      paperDomain,
      authorName: inputData.manuscript_author?.trim() || "算子AI",
      draftNotice: inputData.draft_notice?.trim() || "算子AI生成，仅供参考",
      qualityPolicy,
      privateWorkspace: inputData.private_workspace?.trim() || undefined,
      papersPath: resolveOptionalExistingPath(inputData.papers_path, workspace, repoPath, "papers_path"),
      memoryPath: resolveOptionalExistingPath(inputData.memory_path, workspace, repoPath, "memory_path"),
      useLiteratureMemory: Boolean(inputData.use_literature_memory || inputData.memory_path),
      referenceAuditPath: resolveOptionalExistingPath(inputData.reference_audit_path, workspace, repoPath, "reference_audit_path"),
      releaseBundlePath: resolveOptionalExistingPath(inputData.release_bundle_path, workspace, repoPath, "release_bundle_path"),
      runImprovementLoop: Boolean(inputData.run_improvement_loop),
      planOnly: inputData.plan_only ?? true,
      evidenceGoal: inputData.evidence_goal ?? "private-handoff",
      maxIterations: inputData.max_iterations ?? 3,
      maxDispatchesPerIteration: inputData.max_dispatches_per_iteration ?? 1,
      maxTotalDispatches: inputData.max_total_dispatches,
      maxStagnantIterations: inputData.max_stagnant_iterations ?? 2,
      timeBudgetSeconds: inputData.time_budget_seconds,
      dispatchTimeoutSeconds: inputData.dispatch_timeout_seconds ?? 60,
      generateManuscript: inputData.generate_manuscript ?? paperEngine === "native_ts",
      manuscriptTitle: inputData.manuscript_title?.trim() || undefined,
      skipPdfCompile: inputData.skip_pdf_compile ?? false,
      skipChineseCompanion: inputData.skip_chinese_companion ?? false
    };

    mkdirSync(workspacePath(workspace, outputDir), { recursive: true });
    writeJson(workspacePath(workspace, runtimeConfigJson), {
      schema: "operator.research.ara_paper.runtime_config.v1",
      workflow_id: workflowId,
      run_id: runId,
      ara
    });
    writeText(
      workspacePath(workspace, summaryMarkdown),
      renderSummaryMarkdown({
        status: "prepared",
        projectId,
        topic,
        resultBundlePath,
        paperEngine,
        authorName: ara.authorName,
        draftNotice: ara.draftNotice,
        outputs: { runtimeConfigJson }
      })
    );

    const artifacts = [
      artifactFromFile({
        workspace,
        path: runtimeConfigJson,
        stepId: "ara_prepare_inputs",
        name: "ara_paper_runtime_config",
        type: "json"
      }),
      artifactFromFile({
        workspace,
        path: summaryMarkdown,
        stepId: "ara_prepare_inputs",
        name: "ara_paper_pipeline_summary",
        type: "md"
      })
    ];

    return {
      runId,
      workflowId,
      workspace,
      outputFormat,
      input: { ...inputData, run_id: runId, workspace, workflow_id: workflowId },
      ara,
      outputs: {
        runtimeConfigJson,
        summaryMarkdown
      },
      artifacts,
      usage: {
        runtime: paperEngine === "native_ts" ? "mastra-workflow-native-ts" : "mastra-workflow-python-boundary",
        paper_engine: paperEngine,
        python_boundary: paperEngine === "legacy_ara_python",
        ara_repo_path: repoPath,
        result_bundle_path: resultBundlePath
      },
      logs: [],
      status: "prepared"
    };
  }
});

export const validateAraResultBundleTool = createTool({
  id: "operator.research.ara_paper.validate_result_bundle",
  description: "Validate an ARA domain result bundle before manuscript production.",
  inputSchema: araPaperPipelineStateSchema,
  outputSchema: araPaperPipelineStateSchema,
  execute: async (state) => {
    if (state.ara.paperEngine === "native_ts") {
      const payload = buildNativeBundleValidation(state);
      const next = writePipelineJson(state, {
        key: "validationJson",
        relativePath: `${outputDir}/result_bundle_validation.json`,
        payload,
        stepId: "operator_native_validate_bundle",
        artifactName: "operator_native_result_bundle_validation"
      });
      return {
        ...next,
        validationResult: payload,
        status: boolField(payload, "valid") ? "bundle_validated" : "blocked_invalid_result_bundle",
        logs: [
          ...next.logs,
          {
            step_id: "operator_native_validate_bundle",
            engine: "native_ts",
            valid: boolField(payload, "valid")
          }
        ]
      };
    }

    const { payload, result } = await runAraJson(state, ["bundles", "validate", state.ara.resultBundlePath], {
      timeoutMs: 120_000
    });
    const next = writePipelineJson(state, {
      key: "validationJson",
      relativePath: `${outputDir}/result_bundle_validation.json`,
      payload,
      stepId: "ara_validate_bundle",
      artifactName: "ara_result_bundle_validation"
    });
    return {
      ...next,
      validationResult: payload,
      status: boolField(payload, "valid") ? "bundle_validated" : "blocked_invalid_result_bundle",
      logs: [...next.logs, commandLog(result, "ara_validate_bundle")]
    };
  }
});

export const buildAraDraftingContextTool = createTool({
  id: "operator.research.ara_paper.build_drafting_context",
  description: "Build the claim-backed drafting context admitted by ARA bundle gates.",
  inputSchema: araPaperPipelineStateSchema,
  outputSchema: araPaperPipelineStateSchema,
  execute: async (state) => {
    if (state.ara.paperEngine === "native_ts") {
      const payload = buildNativeDraftingContext(state);
      const next = writePipelineJson(state, {
        key: "draftingContextJson",
        relativePath: `${outputDir}/claim_backed_drafting_context.json`,
        payload,
        stepId: "operator_native_build_drafting_context",
        artifactName: "operator_native_claim_backed_drafting_context"
      });
      const allowedClaimCount = numberField(payload, "allowed_claim_count");
      return {
        ...next,
        draftingContext: payload,
        status: boolField(payload, "valid") ? "drafting_context_ready" : "blocked_no_citable_claims",
        usage: {
          ...next.usage,
          allowed_claim_count: allowedClaimCount,
          blocked_claim_count: numberField(payload, "blocked_claim_count")
        },
        logs: [
          ...next.logs,
          {
            step_id: "operator_native_build_drafting_context",
            engine: "native_ts",
            allowed_claim_count: allowedClaimCount,
            blocked_claim_count: numberField(payload, "blocked_claim_count")
          }
        ]
      };
    }

    const { payload, result } = await runAraJson(state, ["drafting", "context", state.ara.resultBundlePath], {
      timeoutMs: 120_000
    });
    const next = writePipelineJson(state, {
      key: "draftingContextJson",
      relativePath: `${outputDir}/claim_backed_drafting_context.json`,
      payload,
      stepId: "ara_build_drafting_context",
      artifactName: "ara_claim_backed_drafting_context"
    });
    const allowedClaimCount = numberField(payload, "allowed_claim_count");
    return {
      ...next,
      draftingContext: payload,
      status: boolField(payload, "valid") ? "drafting_context_ready" : "blocked_no_citable_claims",
      usage: {
        ...next.usage,
        allowed_claim_count: allowedClaimCount,
        blocked_claim_count: numberField(payload, "blocked_claim_count")
      },
      logs: [...next.logs, commandLog(result, "ara_build_drafting_context")]
    };
  }
});

export const scoreAraEvidenceTool = createTool({
  id: "operator.research.ara_paper.score_evidence",
  description: "Score result-bundle claims against top-venue and release-readiness gates.",
  inputSchema: araPaperPipelineStateSchema,
  outputSchema: araPaperPipelineStateSchema,
  execute: async (state) => {
    if (!boolField(state.validationResult, "valid")) {
      return {
        ...state,
        status: "blocked_invalid_result_bundle",
        logs: [
          ...state.logs,
          {
            step_id: "ara_score_evidence",
            skipped: true,
            reason: "result bundle validation did not pass"
          }
        ]
      };
    }

    if (state.ara.paperEngine === "native_ts") {
      mkdirSync(workspacePath(state.workspace, state.ara.evidenceScoreDir), { recursive: true });
      const payload = buildNativeEvidenceScore(state);
      const captured = writePipelineJson(state, {
        key: "evidenceScoreJson",
        relativePath: `${outputDir}/evidence_score_result.json`,
        payload,
        stepId: "operator_native_score_evidence",
        artifactName: "operator_native_evidence_score_result"
      });
      return {
        ...captured,
        evidenceScore: payload,
        status: "evidence_scored_pending_manuscript_quality",
        usage: {
          ...captured.usage,
          private_handoff_ready: false,
          release_ready: false
        },
        logs: [
          ...captured.logs,
          {
            step_id: "operator_native_score_evidence",
            engine: "native_ts",
            private_handoff_ready: false,
            release_ready: false
          }
        ]
      };
    }

    mkdirSync(workspacePath(state.workspace, state.ara.evidenceScoreDir), { recursive: true });
    const args = [
      "top-venue",
      "evidence-score",
      state.ara.resultBundlePath,
      "--topic",
      state.ara.topic,
      "--venue",
      state.ara.venueId,
      "--out",
      workspacePath(state.workspace, state.ara.evidenceScoreDir)
    ];
    appendOptional(args, "--domain", state.ara.domainId);
    appendOptional(args, "--papers", state.ara.papersPath);
    appendMemoryArgs(args, state);
    appendOptional(args, "--reference-audit", state.ara.referenceAuditPath);
    appendOptional(args, "--release-bundle", state.ara.releaseBundlePath);

    const { payload, result } = await runAraJson(state, args, { timeoutMs: 180_000 });
    const captured = writePipelineJson(state, {
      key: "evidenceScoreJson",
      relativePath: `${outputDir}/evidence_score_result.json`,
      payload,
      stepId: "ara_score_evidence",
      artifactName: "ara_evidence_score_result"
    });
    const nextArtifacts = dedupeArtifacts([
      ...captured.artifacts,
      ...gatherArtifactsUnder(state.workspace, state.ara.evidenceScoreDir, "ara_score_evidence")
    ]);

    return {
      ...captured,
      artifacts: nextArtifacts,
      evidenceScore: payload,
      status: boolField(payload, "private_handoff_ready") ? "evidence_ready_for_private_handoff" : "evidence_scored_with_gaps",
      usage: {
        ...captured.usage,
        private_handoff_ready: boolField(payload, "private_handoff_ready"),
        release_ready: boolField(payload, "release_ready")
      },
      logs: [...captured.logs, commandLog(result, "ara_score_evidence")]
    };
  }
});

export const buildAraPrivateHandoffTool = createTool({
  id: "operator.research.ara_paper.build_private_handoff",
  description: "Build the pointer-only manuscript handoff or optional ARA evidence improvement loop.",
  inputSchema: araPaperPipelineStateSchema,
  outputSchema: araPaperPipelineStateSchema,
  execute: async (state) => {
    if (!boolField(state.validationResult, "valid")) {
      return {
        ...state,
        status: "blocked_invalid_result_bundle",
        logs: [
          ...state.logs,
          {
            step_id: "ara_build_private_handoff",
            skipped: true,
            reason: "result bundle validation did not pass"
          }
        ]
      };
    }

    if (state.ara.paperEngine === "native_ts") {
      const rendered = buildNativePrivateHandoff(state);
      const nextArtifacts = dedupeArtifacts([...state.artifacts, ...rendered.artifacts]);
      const handoffReady = boolField(rendered.payload, "private_handoff_ready");
      const releaseReady = boolField(rendered.payload, "release_ready");
      return {
        ...state,
        outputs: {
          ...state.outputs,
          ...rendered.outputs
        },
        artifacts: nextArtifacts,
        handoffResult: rendered.payload,
        status: handoffReady ? "private_handoff_ready" : "private_handoff_blocked",
        usage: {
          ...state.usage,
          private_handoff_ready: handoffReady,
          release_ready: releaseReady,
          handoff_mode: "native_private_handoff"
        },
        logs: [
          ...state.logs,
          {
            step_id: "operator_native_build_private_handoff",
            engine: "native_ts",
            private_handoff_ready: handoffReady,
            release_ready: releaseReady
          }
        ]
      };
    }

    const outputRoot = state.ara.runImprovementLoop ? state.ara.loopDir : state.ara.handoffDir;
    mkdirSync(workspacePath(state.workspace, outputRoot), { recursive: true });
    const args = state.ara.runImprovementLoop ? improvementLoopArgs(state) : privateHandoffArgs(state);
    const { payload, result } = await runAraJson(state, args, { timeoutMs: state.ara.runImprovementLoop ? 900_000 : 180_000 });
    const key = state.ara.runImprovementLoop ? "improvementLoopJson" : "privateHandoffJson";
    const captured = writePipelineJson(state, {
      key,
      relativePath: `${outputDir}/${state.ara.runImprovementLoop ? "improvement_loop_result" : "private_handoff_result"}.json`,
      payload,
      stepId: "ara_build_private_handoff",
      artifactName: state.ara.runImprovementLoop ? "ara_improvement_loop_result" : "ara_private_handoff_result"
    });
    const nextArtifacts = dedupeArtifacts([
      ...captured.artifacts,
      ...gatherArtifactsUnder(state.workspace, outputRoot, "ara_build_private_handoff")
    ]);
    const handoffReady = boolField(payload, "private_handoff_ready");
    const releaseReady = boolField(payload, "release_ready");

    return {
      ...captured,
      artifacts: nextArtifacts,
      handoffResult: state.ara.runImprovementLoop ? recordField(payload, "final_private_handoff") : payload,
      improvementLoopResult: state.ara.runImprovementLoop ? payload : state.improvementLoopResult,
      status: handoffReady ? "private_handoff_ready" : "private_handoff_blocked",
      usage: {
        ...captured.usage,
        private_handoff_ready: handoffReady,
        release_ready: releaseReady,
        handoff_mode: state.ara.runImprovementLoop ? "improvement_loop" : "private_handoff"
      },
      logs: [...captured.logs, commandLog(result, "ara_build_private_handoff")]
    };
  }
});

export const renderAraManuscriptTool = createTool({
  id: "operator.research.ara_paper.render_manuscript",
  description: "Optionally render deterministic ARA manuscript sources from an AMRA result bundle.",
  inputSchema: araPaperPipelineStateSchema,
  outputSchema: araPaperPipelineStateSchema,
  execute: async (state) => {
    if (!state.ara.generateManuscript) {
      return appendSkipLog(state, "ara_render_manuscript", "generate_manuscript is false");
    }

    if (state.ara.paperEngine === "native_ts") {
      if (!boolField(state.validationResult, "valid")) {
        return appendSkipLog(state, "operator_native_render_manuscript", "result bundle validation did not pass");
      }
      const rendered = await renderNativeManuscript(state);
      const baseState = {
        ...state,
        outputs: {
          ...state.outputs,
          ...rendered.outputs
        },
        artifacts: dedupeArtifacts([...state.artifacts, ...rendered.artifacts])
      };
      const captured = writePipelineJson(baseState, {
        key: "manuscriptResultJson",
        relativePath: `${outputDir}/native_manuscript_result.json`,
        payload: rendered.payload,
        stepId: "operator_native_render_manuscript",
        artifactName: "operator_native_manuscript_result"
      });
      const qualityReport = recordField(rendered.payload, "quality_report");
      return {
        ...captured,
        manuscriptResult: rendered.payload,
        qualityReport,
        status: stringField(rendered.payload, "status") === "completed" ? "manuscript_generated" : "manuscript_quality_failed",
        usage: {
          ...captured.usage,
          manuscript_status: stringField(rendered.payload, "status"),
          manuscript_pdf: stringField(rendered.payload, "pdf"),
          manuscript_author: state.ara.authorName,
          draft_notice: state.ara.draftNotice
        },
        logs: [
          ...captured.logs,
          {
            step_id: "operator_native_render_manuscript",
            engine: "native_ts",
            status: stringField(rendered.payload, "status")
          }
        ]
      };
    }

    if (stringField(state.validationResult, "bundle_type") !== "amra_result_bundle") {
      return appendSkipLog(state, "ara_render_manuscript", "manuscript rendering currently requires amra_result_bundle");
    }
    if (!boolField(state.validationResult, "valid")) {
      return appendSkipLog(state, "ara_render_manuscript", "result bundle validation did not pass");
    }

    const projectsDir = workspacePath(state.workspace, state.ara.manuscriptProjectsDir);
    mkdirSync(projectsDir, { recursive: true });
    const args = [
      "manuscript",
      "math-from-bundle",
      state.ara.resultBundlePath,
      "--project",
      state.ara.projectId,
      "--projects-dir",
      projectsDir,
      "--topic",
      state.ara.topic
    ];
    appendOptional(args, "--title", state.ara.manuscriptTitle);
    if (state.ara.skipPdfCompile) args.push("--no-compile");
    if (state.ara.skipChineseCompanion) args.push("--no-chinese");

    const { payload, result } = await runAraJson(state, args, { timeoutMs: 900_000 });
    const captured = writePipelineJson(state, {
      key: "manuscriptResultJson",
      relativePath: `${outputDir}/math_manuscript_result.json`,
      payload,
      stepId: "ara_render_manuscript",
      artifactName: "ara_math_manuscript_result"
    });
    const nextArtifacts = dedupeArtifacts([
      ...captured.artifacts,
      ...gatherArtifactsUnder(state.workspace, state.ara.manuscriptProjectsDir, "ara_render_manuscript")
    ]);

    return {
      ...captured,
      artifacts: nextArtifacts,
      manuscriptResult: payload,
      status: stringField(payload, "status") === "completed" ? "manuscript_generated" : "manuscript_blocked",
      usage: {
        ...captured.usage,
        manuscript_status: stringField(payload, "status"),
        manuscript_pdf: stringField(payload, "pdf")
      },
      logs: [...captured.logs, commandLog(result, "ara_render_manuscript")]
    };
  }
});

export const validateAraPaperDeliveryTool = createTool({
  id: "operator.research.ara_paper.validate_delivery",
  description: "Validate and summarize ARA paper-production artifacts for Operator delivery.",
  inputSchema: araPaperPipelineStateSchema,
  outputSchema: workflowDeliverySchema,
  execute: async (state) => {
    const summaryMarkdown = state.outputs.summaryMarkdown ?? `${outputDir}/paper_pipeline_summary.md`;
    writeText(workspacePath(state.workspace, summaryMarkdown), renderFinalSummaryMarkdown(state));
    const artifacts = dedupeArtifacts([
      ...state.artifacts,
      artifactFromFile({
        workspace: state.workspace,
        path: summaryMarkdown,
        stepId: "ara_validate_delivery",
        name: "ara_paper_pipeline_summary",
        type: "md"
      }),
      ...gatherArtifactsUnder(state.workspace, outputDir, "ara_validate_delivery")
    ]);
    const checks = [
      validateFileExists(state.workspace, state.outputs.runtimeConfigJson),
      validateFileExists(state.workspace, state.outputs.validationJson),
      validateFileExists(state.workspace, state.outputs.draftingContextJson),
      validateFileExists(state.workspace, summaryMarkdown)
    ];
    if (state.outputs.evidenceScoreJson) checks.push(validateFileExists(state.workspace, state.outputs.evidenceScoreJson));
    if (state.outputs.privateHandoffJson) checks.push(validateFileExists(state.workspace, state.outputs.privateHandoffJson));
    if (state.outputs.improvementLoopJson) checks.push(validateFileExists(state.workspace, state.outputs.improvementLoopJson));
    if (state.outputs.manuscriptResultJson) checks.push(validateFileExists(state.workspace, state.outputs.manuscriptResultJson));
    if (state.outputs.nativeMainTex) checks.push(validateFileExists(state.workspace, state.outputs.nativeMainTex));
    if (state.outputs.nativeReferencesBib) checks.push(validateFileExists(state.workspace, state.outputs.nativeReferencesBib));
    if (state.outputs.nativeManifestJson) checks.push(validateFileExists(state.workspace, state.outputs.nativeManifestJson));
    if (state.outputs.nativeQualityJson) checks.push(validateFileExists(state.workspace, state.outputs.nativeQualityJson));
    if (state.outputs.nativeSupportManifestJson) checks.push(validateFileExists(state.workspace, state.outputs.nativeSupportManifestJson));
    if (state.outputs.nativeReproducibilityStatementMd)
      checks.push(validateFileExists(state.workspace, state.outputs.nativeReproducibilityStatementMd));
    if (state.outputs.nativeContributionInformationMd)
      checks.push(validateFileExists(state.workspace, state.outputs.nativeContributionInformationMd));
    if (state.outputs.nativePaperValidationReportJson)
      checks.push(validateFileExists(state.workspace, state.outputs.nativePaperValidationReportJson));
    if (state.outputs.nativeMathStructuralPreflightJson)
      checks.push(validateFileExists(state.workspace, state.outputs.nativeMathStructuralPreflightJson));
    if (state.outputs.nativeDomainStructuralPreflightJson)
      checks.push(validateFileExists(state.workspace, state.outputs.nativeDomainStructuralPreflightJson));
    if (state.outputs.nativeGenericTopvenuePreflightJson)
      checks.push(validateFileExists(state.workspace, state.outputs.nativeGenericTopvenuePreflightJson));
    if (state.outputs.nativeSourceManifestJson) checks.push(validateFileExists(state.workspace, state.outputs.nativeSourceManifestJson));
    if (state.outputs.nativeSourceArchiveZip) checks.push(validateFileExists(state.workspace, state.outputs.nativeSourceArchiveZip));
    if (state.outputs.nativeFormalMathSummaryJson)
      checks.push(validateFileExists(state.workspace, state.outputs.nativeFormalMathSummaryJson));
    if (state.outputs.nativePipelineSummaryJson) checks.push(validateFileExists(state.workspace, state.outputs.nativePipelineSummaryJson));
    if (state.outputs.nativeCodexStatusJson) checks.push(validateFileExists(state.workspace, state.outputs.nativeCodexStatusJson));
    if (state.outputs.nativePdf) checks.push(validateFileExists(state.workspace, state.outputs.nativePdf));
    const qualityReport = state.qualityReport ?? recordField(state.manuscriptResult, "quality_report");
    if (qualityReport) {
      const failingQualityChecks = arrayOfRecords(qualityReport.checks).filter((check) => {
        const status = stringField(check, "status");
        return status !== "pass" && status !== "skipped";
      });
      if (!boolField(qualityReport, "valid") || failingQualityChecks.length) {
        const blockingChecks = Array.isArray(qualityReport.blocking_checks) ? qualityReport.blocking_checks.join(", ") : "unknown";
        throw new Error(`Manuscript quality gate failed: ${blockingChecks}`);
      }
      checks.push({
        type: "manuscript_quality_gate",
        status: "passed",
        valid: boolField(qualityReport, "valid"),
        metrics: recordField(qualityReport, "metrics"),
        policy: recordField(qualityReport, "policy"),
        checks: arrayOfRecords(qualityReport.checks)
      });
    }

    return {
      runId: state.runId,
      workflowId: state.workflowId,
      workspace: state.workspace,
      outputFormat: state.outputFormat,
      outputs: {
        ...state.outputs,
        summaryMarkdown
      },
      artifacts,
      usage: {
        ...state.usage,
        pipeline_status: state.status,
        artifact_count: artifacts.length,
        paper_engine: state.ara.paperEngine,
        python_boundary: state.ara.paperEngine === "legacy_ara_python",
        manuscript_author: state.ara.authorName,
        draft_notice: state.ara.draftNotice
      },
      logs: state.logs,
      validation: {
        validated: true as const,
        checks
      }
    };
  }
});

export const araPaperWorkflowTools = {
  prepareAraPaperInputsTool,
  validateAraResultBundleTool,
  buildAraDraftingContextTool,
  scoreAraEvidenceTool,
  buildAraPrivateHandoffTool,
  renderAraManuscriptTool,
  validateAraPaperDeliveryTool
} as const;

function resolveAraRepoPath(inputPath: string | undefined): string {
  const configured = inputPath?.trim() || process.env.OPERATOR_ARA_REPO_PATH?.trim();
  if (configured) return path.resolve(normalizeMaybeWslPath(configured));
  const sibling = path.resolve(repoRoot(), "../ara");
  if (existsSync(sibling)) return sibling;
  return "/home/biostar/work/projects/ara";
}

function resolveResultBundlePath(inputPath: string | undefined, workspace: string, araRepoPath: string): string {
  const explicit = inputPath?.trim();
  if (explicit) return resolveExistingPath(explicit, workspace, araRepoPath, "result_bundle_path");
  const candidates = ["input/result_bundle", "input/domain_result_bundle", "result_bundle", "domain_result_bundle"].map((candidate) =>
    workspacePath(workspace, candidate)
  );
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory());
  if (found) return found;
  throw new Error(
    "ARA paper workflow requires result_bundle_path or a bundle directory at input/result_bundle, input/domain_result_bundle, result_bundle, or domain_result_bundle."
  );
}

function resolveOptionalExistingPath(
  inputPath: string | undefined,
  workspace: string,
  araRepoPath: string,
  label: string
): string | undefined {
  const raw = inputPath?.trim();
  return raw ? resolveExistingPath(raw, workspace, araRepoPath, label) : undefined;
}

function resolveExistingPath(raw: string, workspace: string, araRepoPath: string, label: string): string {
  raw = normalizeMaybeWslPath(raw);
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [workspacePath(workspace, raw), path.resolve(araRepoPath, raw), path.resolve(raw)];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`${label} does not exist. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

function normalizeMaybeWslPath(raw: string): string {
  return raw.replace(/^\\\\wsl\.localhost\\Ubuntu\\/iu, "/").replace(/\\/gu, "/");
}

async function runAraJson(
  state: AraPaperPipelineState,
  args: string[],
  options: { timeoutMs: number }
): Promise<{ payload: JsonRecord; result: Awaited<ReturnType<typeof runCommand>> }> {
  const commandArgs = ["-m", "ara", ...args, "--json"];
  const result = await runCommand(state.ara.pythonCommand, commandArgs, {
    cwd: state.ara.repoPath,
    timeoutMs: options.timeoutMs,
    allowNonZero: true
  });
  const payload = parseJsonRecord(result.stdout);
  if (result.exitCode !== 0 && stringField(payload, "status") === "error") {
    throw new Error(
      `ARA command returned error status (${result.exitCode}): ${result.command.join(" ")}\n${result.stdout}\n${result.stderr}`.trim()
    );
  }
  return {
    payload,
    result
  };
}

function parseJsonRecord(stdout: string): JsonRecord {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("ARA command did not print JSON output.");
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) return parsed;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (isRecord(parsed)) return parsed;
    }
  }
  throw new Error(`ARA command printed non-object JSON: ${trimmed.slice(0, 500)}`);
}

function writePipelineJson(
  state: AraPaperPipelineState,
  params: {
    key: string;
    relativePath: string;
    payload: JsonRecord;
    stepId: string;
    artifactName: string;
  }
): AraPaperPipelineState {
  writeJson(workspacePath(state.workspace, params.relativePath), params.payload);
  return {
    ...state,
    outputs: {
      ...state.outputs,
      [params.key]: params.relativePath
    },
    artifacts: dedupeArtifacts([
      ...state.artifacts,
      artifactFromFile({
        workspace: state.workspace,
        path: params.relativePath,
        stepId: params.stepId,
        name: params.artifactName,
        type: "json"
      })
    ])
  };
}

function privateHandoffArgs(state: AraPaperPipelineState): string[] {
  const args = [
    "top-venue",
    "private-handoff",
    state.ara.resultBundlePath,
    "--project",
    state.ara.projectId,
    "--topic",
    state.ara.topic,
    "--venue",
    state.ara.venueId,
    "--out",
    workspacePath(state.workspace, state.ara.handoffDir)
  ];
  appendOptional(args, "--domain", state.ara.domainId);
  appendOptional(args, "--papers", state.ara.papersPath);
  appendMemoryArgs(args, state);
  appendOptional(args, "--reference-audit", state.ara.referenceAuditPath);
  appendOptional(args, "--release-bundle", state.ara.releaseBundlePath);
  appendOptional(args, "--private-workspace", state.ara.privateWorkspace);
  return args;
}

function improvementLoopArgs(state: AraPaperPipelineState): string[] {
  const args = [
    "top-venue",
    "improve-loop",
    state.ara.resultBundlePath,
    "--project",
    state.ara.projectId,
    "--topic",
    state.ara.topic,
    "--venue",
    state.ara.venueId,
    "--evidence-goal",
    state.ara.evidenceGoal,
    "--max-iterations",
    String(state.ara.maxIterations),
    "--max-dispatches-per-iteration",
    String(state.ara.maxDispatchesPerIteration),
    "--max-stagnant-iterations",
    String(state.ara.maxStagnantIterations),
    "--dispatch-timeout-seconds",
    String(state.ara.dispatchTimeoutSeconds),
    "--out",
    workspacePath(state.workspace, state.ara.loopDir)
  ];
  appendOptional(args, "--domain", state.ara.domainId);
  appendOptional(args, "--papers", state.ara.papersPath);
  appendMemoryArgs(args, state);
  appendOptional(args, "--reference-audit", state.ara.referenceAuditPath);
  appendOptional(args, "--release-bundle", state.ara.releaseBundlePath);
  appendOptional(args, "--private-workspace", state.ara.privateWorkspace);
  if (state.ara.maxTotalDispatches !== undefined) args.push("--max-total-dispatches", String(state.ara.maxTotalDispatches));
  if (state.ara.timeBudgetSeconds !== undefined) args.push("--time-budget-seconds", String(state.ara.timeBudgetSeconds));
  if (state.ara.planOnly) args.push("--plan-only");
  return args;
}

function appendOptional(args: string[], flag: string, value: string | undefined): void {
  if (value?.trim()) args.push(flag, value);
}

function appendMemoryArgs(args: string[], state: AraPaperPipelineState): void {
  if (state.ara.memoryPath) {
    args.push("--memory", state.ara.memoryPath);
    return;
  }
  if (!state.ara.useLiteratureMemory) args.push("--no-memory");
}

function isMathLikePaper(value: string): boolean {
  return /(^|[_\W])(math|mathematics|formal|proof|theorem|conjecture|lean)([_\W]|$)/iu.test(value);
}

function appendSkipLog(state: AraPaperPipelineState, stepId: string, reason: string): AraPaperPipelineState {
  return {
    ...state,
    logs: [
      ...state.logs,
      {
        step_id: stepId,
        skipped: true,
        reason
      }
    ]
  };
}

function commandLog(result: Awaited<ReturnType<typeof runCommand>>, stepId: string): JsonRecord {
  return {
    step_id: stepId,
    command: result.command,
    exit_code: result.exitCode,
    stdout_bytes: Buffer.byteLength(result.stdout, "utf8"),
    stderr_bytes: Buffer.byteLength(result.stderr, "utf8")
  };
}

function gatherArtifactsUnder(workspace: string, relativeDir: string, stepId: string): ArtifactRecord[] {
  const absoluteDir = workspacePath(workspace, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  return listFiles(absoluteDir)
    .filter((filePath) => artifactSuffixes.has(path.extname(filePath).toLowerCase()))
    .map((filePath) =>
      artifactFromFile({
        workspace,
        path: relativeToWorkspace(workspace, filePath),
        stepId
      })
    );
}

function listFiles(absoluteDir: string): string[] {
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return listFiles(absolutePath);
    return entry.isFile() ? [absolutePath] : [];
  });
}

function dedupeArtifacts(artifacts: ArtifactRecord[]): ArtifactRecord[] {
  const byPath = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) byPath.set(artifact.path, artifact);
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function sanitizeProjectId(raw: string): string {
  const value = raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return value || `ara-paper-${Date.now()}`;
}

function renderSummaryMarkdown(params: {
  status: string;
  projectId: string;
  topic: string;
  resultBundlePath: string;
  paperEngine: string;
  authorName: string;
  draftNotice: string;
  outputs: Record<string, string>;
}): string {
  return (
    [
      "# Operator Paper Pipeline",
      "",
      `- status: ${params.status}`,
      `- project: ${params.projectId}`,
      `- topic: ${params.topic}`,
      `- paper_engine: ${params.paperEngine}`,
      `- author: ${params.authorName}`,
      `- draft_notice: ${params.draftNotice}`,
      `- result_bundle: ${params.resultBundlePath}`,
      "",
      "## Outputs",
      "",
      ...Object.entries(params.outputs).map(([key, value]) => `- ${key}: ${value}`)
    ].join("\n") + "\n"
  );
}

function renderFinalSummaryMarkdown(state: AraPaperPipelineState): string {
  const validationValid = boolField(state.validationResult, "valid");
  const contextValid = boolField(state.draftingContext, "valid");
  const privateHandoffReady = Boolean(state.usage.private_handoff_ready);
  const releaseReady = Boolean(state.usage.release_ready);
  return (
    [
      "# Operator Paper Pipeline",
      "",
      `- status: ${state.status}`,
      `- project: ${state.ara.projectId}`,
      `- topic: ${state.ara.topic}`,
      `- paper_engine: ${state.ara.paperEngine}`,
      `- author: ${state.ara.authorName}`,
      `- draft_notice: ${state.ara.draftNotice}`,
      `- result_bundle: ${state.ara.resultBundlePath}`,
      `- bundle_valid: ${validationValid}`,
      `- drafting_context_valid: ${contextValid}`,
      `- private_handoff_ready: ${privateHandoffReady}`,
      `- release_ready: ${releaseReady}`,
      `- manuscript_generated: ${Boolean(state.manuscriptResult)}`,
      "",
      "## Outputs",
      "",
      ...Object.entries(state.outputs).map(([key, value]) => `- ${key}: ${value}`)
    ].join("\n") + "\n"
  );
}

function boolField(record: unknown, key: string): boolean {
  return isRecord(record) ? Boolean(record[key]) : false;
}

function numberField(record: unknown, key: string): number {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(record: unknown, key: string): string | undefined {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === "string" ? value : undefined;
}

function recordField(record: unknown, key: string): JsonRecord | undefined {
  const value = isRecord(record) ? record[key] : undefined;
  return isRecord(value) ? value : undefined;
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
