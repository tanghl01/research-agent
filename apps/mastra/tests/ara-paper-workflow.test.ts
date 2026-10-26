import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { repoRoot, syncCapability } from "@operator/core";
import { describe, expect, test } from "vitest";
import { runWorkflow } from "../src/runner.js";

const araRepo = path.resolve(repoRoot(), "../ara");
const araBundle = path.join(araRepo, "projects/wowii19-formal-paper-20260608/result_bundle");
const hasAraFixture = existsSync(path.join(araRepo, "ara/cli.py")) && existsSync(path.join(araBundle, "bundle_manifest.json"));
const aiBundle = path.join(araRepo, "projects/conformal-ttc-risk-control-20260521/aira_runs/iteration_01_bundle");
const hasAiFixture = existsSync(path.join(araRepo, "ara/cli.py")) && existsSync(path.join(aiBundle, "bundle_manifest.json"));

describe("Operator paper-from-results workflow", () => {
  test.skipIf(!hasAraFixture)("builds claim-backed paper handoff artifacts through the Mastra workflow", async () => {
    const workspace = `tmp/test-runs/ara-paper-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);
    rmSync(absoluteWorkspace, { recursive: true, force: true });
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = path.join(absoluteWorkspace, ".capabilities");
    await syncCapability("research.paper-from-results", { kind: "workflow" });

    const result = await runWorkflow({
      workspace,
      workflowId: "research.paper-from-results",
      input: {
        topic: "WOWII 19 formal paper",
        workspace,
        workflow_id: "research.paper-from-results",
        result_bundle_path: araBundle,
        ara_repo_path: araRepo,
        project_id: "operator-ara-paper-smoke",
        venue_id: "generic_top_tier",
        paper_engine: "native_ts",
        paper_domain: "mathematics",
        skip_pdf_compile: true,
        skip_chinese_companion: true,
        min_word_count: 1800
      }
    });

    expect(result.status).toBe("succeeded");
    const delivery = result.result;
    expect(delivery?.workflowId).toBe("research.paper-from-results");
    expect(delivery?.outputFormat).toBe("research");
    expect(delivery?.usage.paper_engine).toBe("native_ts");
    expect(delivery?.usage.python_boundary).toBe(false);
    expect(delivery?.outputs.validationJson).toBe("runs/research-paper/output/result_bundle_validation.json");
    expect(delivery?.outputs.draftingContextJson).toBe("runs/research-paper/output/claim_backed_drafting_context.json");
    expect(delivery?.outputs.evidenceScoreJson).toBe("runs/research-paper/output/evidence_score_result.json");
    expect(delivery?.outputs.privateHandoffJson).toBe("runs/research-paper/output/private_handoff/handoff_manifest.json");
    expect(delivery?.outputs.manuscriptResultJson).toBe("runs/research-paper/output/native_manuscript_result.json");
    expect(delivery?.outputs.nativeMainTex).toBe("runs/research-paper/output/native_manuscript/manuscript_build/main.tex");
    expect(delivery?.outputs.nativeReferencesBib).toBe("runs/research-paper/output/native_manuscript/manuscript_build/references.bib");
    expect(delivery?.outputs.nativeQualityJson).toBe("runs/research-paper/output/native_manuscript/manuscript_quality_report.json");
    expect(delivery?.outputs.nativeSupportManifestJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/formal_proof_support_manifest.json");
    expect(delivery?.outputs.nativeReproducibilityStatementMd).toBe("runs/research-paper/output/native_manuscript/manuscript_build/reproducibility_statement.md");
    expect(delivery?.outputs.nativeContributionInformationMd).toBe("runs/research-paper/output/native_manuscript/manuscript_build/contribution_information.md");
    expect(delivery?.outputs.nativePaperValidationReportJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/paper_validation_report.json");
    expect(delivery?.outputs.nativeMathStructuralPreflightJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/math_structural_preflight_review.json");
    expect(delivery?.outputs.nativeGenericTopvenuePreflightJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/generic_topvenue_preflight_review.json");
    expect(delivery?.outputs.nativeSourceArchiveZip).toBe("runs/research-paper/output/native_manuscript/manuscript_build/source_archive.zip");
    expect(delivery?.outputs.nativeFormalMathSummaryJson).toBe("runs/research-paper/output/native_manuscript/formal_math_pipeline_summary.json");

    const resultWorkspace = delivery?.workspace ?? absoluteWorkspace;
    const summaryPath = path.join(resultWorkspace, delivery?.outputs.summaryMarkdown ?? "");
    expect(existsSync(summaryPath)).toBe(true);
    expect(statSync(summaryPath).size).toBeGreaterThan(200);
    expect(readFileSync(summaryPath, "utf8")).toContain("private_handoff_ready");
    expect(delivery?.artifacts.some((artifact) => artifact.path.endsWith("handoff_manifest.json"))).toBe(true);
    expect(delivery?.artifacts.some((artifact) => artifact.path.endsWith("manuscript_build/main.tex"))).toBe(true);

    const mainTex = readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeMainTex ?? ""), "utf8");
    expect(mainTex).toContain("\\author{算子AI}");
    expect(mainTex).toContain("算子AI生成，仅供参考");
    expect((mainTex.match(/\\begin\{figure\}/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((mainTex.match(/\\begin\{tikzpicture\}/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((mainTex.match(/\\begin\{(?:theorem|lemma|proposition|proof)\}/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((mainTex.match(/\\begin\{(?:equation|align|align\*|gather|multline|displaymath)\}|\\\[/gu) ?? []).length).toBeGreaterThanOrEqual(12);
    expect((mainTex.match(/\\cite[a-zA-Z]*\{/gu) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(mainTex).not.toContain("\\textbackslash{}cite");

    const referencesBib = readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeReferencesBib ?? ""), "utf8");
    expect((referencesBib.match(/^@/gmu) ?? []).length).toBeGreaterThanOrEqual(20);

    const quality = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeQualityJson ?? ""), "utf8")) as {
      valid: boolean;
      metrics: {
        word_count: number;
        reference_count: number;
        figure_count: number;
        formula_count: number;
        theorem_like_count: number;
        citation_count: number;
        tikz_figure_count: number;
      };
    };
    expect(quality.valid).toBe(true);
    expect(quality.metrics.word_count).toBeGreaterThanOrEqual(1800);
    expect(quality.metrics.reference_count).toBeGreaterThanOrEqual(20);
    expect(quality.metrics.figure_count).toBeGreaterThanOrEqual(2);
    expect(quality.metrics.formula_count).toBeGreaterThanOrEqual(12);
    expect(quality.metrics.theorem_like_count).toBeGreaterThanOrEqual(4);
    expect(quality.metrics.citation_count).toBeGreaterThanOrEqual(8);
    expect(quality.metrics.tikz_figure_count).toBeGreaterThanOrEqual(2);

    const supportManifest = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeSupportManifestJson ?? ""), "utf8")) as {
      support_package_verified: boolean;
      target_theorems: string[];
      forbidden_placeholder_counts: Record<string, number>;
    };
    expect(supportManifest.support_package_verified).toBe(true);
    expect(supportManifest.target_theorems).toContain("wowii19_formal_conjectures_original_shape");
    expect(supportManifest.forbidden_placeholder_counts.sorry).toBe(0);

    const validationReport = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativePaperValidationReportJson ?? ""), "utf8")) as {
      bibliography: { ok: boolean };
      validation: { bibliography_ok: boolean; quality_gate_ok: boolean };
    };
    expect(validationReport.bibliography.ok).toBe(true);
    expect(validationReport.validation.bibliography_ok).toBe(true);
    expect(validationReport.validation.quality_gate_ok).toBe(true);

    const mathPreflight = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeMathStructuralPreflightJson ?? ""), "utf8")) as {
      overall: number;
      lean_verified: boolean;
      issues: string[];
    };
    expect(mathPreflight.overall).toBeGreaterThanOrEqual(9);
    expect(mathPreflight.lean_verified).toBe(true);
    expect(mathPreflight.issues).toEqual([]);

    const genericPreflight = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeGenericTopvenuePreflightJson ?? ""), "utf8")) as {
      required_changes: string[];
      score_metadata: { corrected_from_ara: string };
    };
    expect(genericPreflight.required_changes.join("\n")).not.toMatch(/baseline|experiment|statistical/iu);
    expect(genericPreflight.score_metadata.corrected_from_ara).toContain("Mathematics drafts");

    const sourceArchivePath = path.join(resultWorkspace, delivery?.outputs.nativeSourceArchiveZip ?? "");
    expect(existsSync(sourceArchivePath)).toBe(true);
    expect(statSync(sourceArchivePath).size).toBeGreaterThan(500);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/native_manuscript/formal_manuscripts/main.v1.tex"))).toBe(true);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/native_manuscript/reviews/math_structural_preflight_review.v1.json"))).toBe(true);

    const handoff = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.privateHandoffJson ?? ""), "utf8")) as {
      manuscript_pointer: {
        formal_proof_support_manifest: string;
        source_archive: string;
      };
    };
    expect(handoff.manuscript_pointer.formal_proof_support_manifest).toBe(delivery?.outputs.nativeSupportManifestJson);
    expect(handoff.manuscript_pointer.source_archive).toBe(delivery?.outputs.nativeSourceArchiveZip);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/private_handoff/formal_proof_support_manifest.json"))).toBe(true);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/private_handoff/source_archive.zip"))).toBe(true);
  }, 240_000);

  test.skipIf(!hasAiFixture)("keeps conformal AI bundles on the empirical quality policy", async () => {
    const workspace = `tmp/test-runs/ara-paper-ai-${process.pid}-${Date.now()}`;
    const absoluteWorkspace = path.join(repoRoot(), workspace);
    rmSync(absoluteWorkspace, { recursive: true, force: true });
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = path.join(absoluteWorkspace, ".capabilities");
    await syncCapability("research.paper-from-results", { kind: "workflow" });

    const result = await runWorkflow({
      workspace,
      workflowId: "research.paper-from-results",
      input: {
        topic: "Conformal Test-Time Compute for Reliable LLM Reasoning",
        workspace,
        workflow_id: "research.paper-from-results",
        result_bundle_path: aiBundle,
        ara_repo_path: araRepo,
        project_id: "operator-ai-conformal-smoke",
        venue_id: "generic_top_tier",
        paper_engine: "native_ts",
        paper_domain: "ai_ml",
        skip_pdf_compile: true,
        skip_chinese_companion: true
      }
    });

    expect(result.status).toBe("succeeded");
    const delivery = result.result;
    const resultWorkspace = delivery?.workspace ?? absoluteWorkspace;
    expect(delivery?.outputs.nativeSupportManifestJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/claim_support_manifest.json");
    expect(delivery?.outputs.nativeFigureDataJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/figures/figure_data.json");
    expect(delivery?.outputs.nativeImageGenerationManifestJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/figures/image_generation_manifest.json");
    expect(delivery?.outputs.nativeFigureGeneratorPy).toBe("runs/research-paper/output/native_manuscript/manuscript_build/generate_figures.py");
    expect(delivery?.outputs.nativeMathStructuralPreflightJson).toBe("");
    expect(delivery?.outputs.nativeDomainStructuralPreflightJson).toBe("runs/research-paper/output/native_manuscript/manuscript_build/domain_structural_preflight_review.json");
    expect(delivery?.outputs.nativeFormalMathSummaryJson).toBe("");
    expect(delivery?.outputs.nativePipelineSummaryJson).toBe("runs/research-paper/output/native_manuscript/manuscript_pipeline_summary.json");

    const draftingContext = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.draftingContextJson ?? ""), "utf8")) as {
      valid: boolean;
      allowed_claim_count: number;
      blocked_claim_count: number;
      artifact_dependencies: unknown[];
    };
    expect(draftingContext.valid).toBe(true);
    expect(draftingContext.allowed_claim_count).toBeGreaterThanOrEqual(1);
    expect(draftingContext.blocked_claim_count).toBe(0);
    expect(draftingContext.artifact_dependencies.length).toBeGreaterThanOrEqual(6);

    const evidenceScore = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.evidenceScoreJson ?? ""), "utf8")) as {
      summary: {
        main_claim_count: number;
        private_manuscript_allowed_claim_count: number;
      };
      claim_scores: unknown[];
    };
    expect(evidenceScore.summary.main_claim_count).toBeGreaterThanOrEqual(1);
    expect(evidenceScore.summary.private_manuscript_allowed_claim_count).toBeGreaterThanOrEqual(1);
    expect(evidenceScore.claim_scores.length).toBeGreaterThanOrEqual(1);

    const runtimeConfig = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.runtimeConfigJson ?? ""), "utf8")) as {
      ara: {
        qualityPolicy: {
          minFormulaCount: number;
          minTheoremLikeCount: number;
          minCitationCount: number;
          minTikzFigureCount: number;
          minTableCount: number;
          minDataFigureCount: number;
          maxMetaNarrativeMentions: number;
        };
      };
    };
    expect(runtimeConfig.ara.qualityPolicy.minFormulaCount).toBe(4);
    expect(runtimeConfig.ara.qualityPolicy.minTheoremLikeCount).toBe(0);
    expect(runtimeConfig.ara.qualityPolicy.minCitationCount).toBe(18);
    expect(runtimeConfig.ara.qualityPolicy.minTikzFigureCount).toBe(4);
    expect(runtimeConfig.ara.qualityPolicy.minTableCount).toBe(3);
    expect(runtimeConfig.ara.qualityPolicy.minDataFigureCount).toBe(4);
    expect(runtimeConfig.ara.qualityPolicy.maxMetaNarrativeMentions).toBe(0);

    const mainTex = readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeMainTex ?? ""), "utf8");
    const citedKeys = new Set(
      [...mainTex.matchAll(/\\cite[a-zA-Z]*\{([^}]+)\}/gu)].flatMap((match) => match[1].split(",").map((key) => key.trim()).filter(Boolean))
    );
    expect(mainTex).toContain("\\documentclass{article}");
    expect(mainTex).toContain("\\usepackage{analemma,times}");
    expect(mainTex).toContain("\\bibliographystyle{analemma}");
    expect(mainTex).toContain("Verifier-Assisted Conformal Test-Time Compute");
    expect(mainTex).toContain("\\author{算子AI}");
    expect(mainTex).toContain("算子AI生成，仅供参考");
    expect(mainTex).toContain("\\operatorname{Cov}");
    expect(mainTex).toContain("\\operatorname{Risk}");
    expect(mainTex).toContain("\\arg\\max");
    expect(mainTex).toContain("\\subsection{Experimental Setup}");
    expect(mainTex).toContain("\\subsection{Main Results}");
    expect(mainTex).toContain("\\subsection{Mechanism Analysis}");
    expect(mainTex).toContain("\\label{tab:method-config}");
    expect(mainTex).toContain("\\label{tab:policy-metrics}");
    expect(mainTex).toContain("\\label{fig:system-architecture}");
    expect(mainTex).toContain("\\label{fig:experiment-setup}");
    expect(mainTex).toContain("\\label{fig:quality-by-task}");
    expect(mainTex).toContain("\\label{fig:mechanism-diagnostics}");
    expect(mainTex).toContain("\\label{fig:policy-frontier}");
    expect(mainTex).toContain("\\includegraphics[width=\\linewidth]{figures/system_architecture.png}");
    expect(mainTex).toContain("\\includegraphics[width=\\linewidth]{figures/experiment_setup.png}");
    expect(mainTex).toContain("\\includegraphics[width=\\linewidth]{figures/quality_by_task.png}");
    expect(mainTex).toContain("\\includegraphics[width=\\linewidth]{figures/mechanism_diagnostics.png}");
    expect(mainTex).not.toMatch(/The rest of the paper follows|Operator selected|Operator generated|current template|native renderer/iu);
    expect(mainTex).not.toMatch(/Study design and artifact boundary|Main artifacts|Reproducibility and Artifact Integrity/iu);
    expect((mainTex.match(/\\begin\{table\}/gu) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((mainTex.match(/\\begin\{figure\}/gu) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((mainTex.match(/\\begin\{tikzpicture\}/gu) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((mainTex.match(/operator-data-figure:/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((mainTex.match(/operator-generated-image:/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((mainTex.match(/\\begin\{(?:equation|align|align\*|gather|multline|displaymath)\}/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(citedKeys.size).toBeGreaterThanOrEqual(18);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/native_manuscript/manuscript_build/analemma.sty"))).toBe(true);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/native_manuscript/manuscript_build/analemma.bst"))).toBe(true);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/native_manuscript/manuscript_build/logo.png"))).toBe(true);

    const imageManifest = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeImageGenerationManifestJson ?? ""), "utf8")) as {
      status: string;
      generator: string;
      assets: Array<{ filename: string; path: string }>;
    };
    expect(imageManifest.status).toBe("generated");
    expect(imageManifest.generator).toBe("matplotlib");
    expect(imageManifest.assets.map((asset) => asset.filename)).toEqual([
      "system_architecture.png",
      "experiment_setup.png",
      "quality_by_task.png",
      "mechanism_diagnostics.png"
    ]);
    for (const asset of imageManifest.assets) {
      const assetPath = path.join(resultWorkspace, asset.path);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeGreaterThan(1_024);
    }

    const referencesBib = readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeReferencesBib ?? ""), "utf8");
    const citedOrder = [...mainTex.matchAll(/\\cite[a-zA-Z]*\{([^}]+)\}/gu)]
      .flatMap((match) => match[1].split(",").map((key) => key.trim()).filter(Boolean))
      .filter((key, index, keys) => keys.indexOf(key) === index);
    const bibOrder = [...referencesBib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/gu)].map((match) => match[1]);
    expect(bibOrder.slice(0, citedOrder.length)).toEqual(citedOrder);

    const quality = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeQualityJson ?? ""), "utf8")) as {
      valid: boolean;
      metrics: {
        citation_count: number;
        formula_count: number;
        theorem_like_count: number;
        tikz_figure_count: number;
        table_count: number;
        data_figure_count: number;
        external_figure_count: number;
        generated_image_count: number;
        meta_narrative_mentions: number;
        word_count: number;
        reference_count: number;
        required_empirical_figure_missing_count: number;
        required_generated_image_asset_missing_count: number;
        report_like_main_text_markers: number;
        citation_first_use_order_ok: boolean;
        missing_cross_reference_count: number;
      };
      blocking_checks: string[];
    };
    expect(quality.valid).toBe(true);
    expect(quality.blocking_checks).toEqual([]);
    expect(quality.metrics.word_count).toBeGreaterThanOrEqual(5_200);
    expect(quality.metrics.reference_count).toBeGreaterThanOrEqual(20);
    expect(quality.metrics.citation_count).toBeGreaterThanOrEqual(18);
    expect(quality.metrics.formula_count).toBeGreaterThanOrEqual(4);
    expect(quality.metrics.theorem_like_count).toBe(0);
    expect(quality.metrics.tikz_figure_count).toBeGreaterThanOrEqual(4);
    expect(quality.metrics.table_count).toBeGreaterThanOrEqual(3);
    expect(quality.metrics.data_figure_count).toBeGreaterThanOrEqual(4);
    expect(quality.metrics.external_figure_count).toBeGreaterThanOrEqual(4);
    expect(quality.metrics.generated_image_count).toBeGreaterThanOrEqual(4);
    expect(quality.metrics.meta_narrative_mentions).toBe(0);
    expect(quality.metrics.required_empirical_figure_missing_count).toBe(0);
    expect(quality.metrics.required_generated_image_asset_missing_count).toBe(0);
    expect(quality.metrics.report_like_main_text_markers).toBe(0);
    expect(quality.metrics.citation_first_use_order_ok).toBe(true);
    expect(quality.metrics.missing_cross_reference_count).toBe(0);

    const supportManifest = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.nativeSupportManifestJson ?? ""), "utf8")) as {
      schema_version: string;
      verification_status: string;
      support_package_verified: boolean;
      claim_support_verified: boolean;
      allowed_claim_count: number;
      blocked_claim_count: number;
    };
    expect(supportManifest.schema_version).toBe("operator.research.claim_support_manifest.v1");
    expect(supportManifest.verification_status).toBe("claim_supported");
    expect(supportManifest.support_package_verified).toBe(true);
    expect(supportManifest.claim_support_verified).toBe(true);
    expect(supportManifest.allowed_claim_count).toBeGreaterThanOrEqual(1);
    expect(supportManifest.blocked_claim_count).toBe(0);

    const handoff = JSON.parse(readFileSync(path.join(resultWorkspace, delivery?.outputs.privateHandoffJson ?? ""), "utf8")) as {
      manuscript_pointer: {
        support_manifest: string;
        formal_proof_support_manifest: string | null;
        structural_preflight_review: string;
        math_structural_preflight_review: string | null;
      };
    };
    expect(handoff.manuscript_pointer.support_manifest).toBe(delivery?.outputs.nativeSupportManifestJson);
    expect(handoff.manuscript_pointer.formal_proof_support_manifest).toBeNull();
    expect(handoff.manuscript_pointer.structural_preflight_review).toBe(delivery?.outputs.nativeDomainStructuralPreflightJson);
    expect(handoff.manuscript_pointer.math_structural_preflight_review).toBeNull();
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/private_handoff/claim_support_manifest.json"))).toBe(true);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/private_handoff/domain_structural_preflight_review.json"))).toBe(true);
    expect(existsSync(path.join(resultWorkspace, "runs/research-paper/output/native_manuscript/manuscript_snapshots/main.v1.tex"))).toBe(true);
  }, 240_000);
});
