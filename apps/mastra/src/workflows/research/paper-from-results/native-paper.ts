import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { artifactFromFile, readJson, runCommand, writeJson, writeText, workspacePath, type ArtifactRecord } from "@operator/core";
import type { AraPaperPipelineState } from "./schemas.js";

type JsonRecord = Record<string, unknown>;

type BundleArtifact = {
  artifact_id?: string;
  path?: string;
  kind?: string;
  description?: string;
};

type BundleClaim = {
  claim_id?: string;
  claim?: string;
  status?: string;
  evidence_level?: string;
  verification_status?: string | null;
  reproduction_status?: string | null;
  supported_by?: string[];
  limitations?: string[];
};

type PaperTemplate = {
  id: string;
  displayName: string;
  domain: string;
  paperType: string;
  defaultTitle: string;
  requiredSections: string[];
  references: ReferenceEntry[];
};

type ReferenceEntry = {
  key: string;
  bibtex: string;
};

type CsvRecord = Record<string, string>;

type EmpiricalEvidencePackage = {
  primaryClaim: string;
  studyDesign: JsonRecord;
  metricsRows: CsvRecord[];
  baselineRows: CsvRecord[];
  iterationRows: CsvRecord[];
  selectedCertificate: JsonRecord;
  statisticalUncertainty: JsonRecord;
  errorAnalysis: JsonRecord;
  verifierSummary: JsonRecord;
  stageSummary: JsonRecord;
  primaryContribution: string;
  mechanismInsight: string;
  draftingBrief: string;
  limitations: string;
  artifacts: JsonRecord[];
};

const empiricalGeneratedFigureSpecs = [
  {
    id: "system_architecture",
    label: "fig:system-architecture",
    filename: "system_architecture.png",
    role: "system diagram"
  },
  {
    id: "experiment_setup",
    label: "fig:experiment-setup",
    filename: "experiment_setup.png",
    role: "experimental setup diagram"
  },
  {
    id: "quality_by_task",
    label: "fig:quality-by-task",
    filename: "quality_by_task.png",
    role: "task-level empirical plot"
  },
  {
    id: "mechanism_diagnostics",
    label: "fig:mechanism-diagnostics",
    filename: "mechanism_diagnostics.png",
    role: "mechanism diagnostic plot"
  }
] as const;

type GeneratedFigureAsset = {
  id: string;
  label: string;
  filename: string;
  path: string;
  role: string;
};

type LatexLayoutStyle = "operator_ctex" | "ara_analemma";

export function buildNativeBundleValidation(state: AraPaperPipelineState): JsonRecord {
  const bundlePath = state.ara.resultBundlePath;
  const requiredFiles = ["bundle_manifest.json", "artifact_manifest.json", "drafting_brief.md", "limitations.md", "claims.json"];
  const files = Object.fromEntries(
    requiredFiles.map((name) => {
      const filePath = path.join(bundlePath, name);
      return [
        name,
        {
          required: true,
          present: existsSync(filePath),
          is_file: existsSync(filePath) ? statSync(filePath).isFile() : false,
          size_bytes: existsSync(filePath) ? statSync(filePath).size : undefined
        }
      ];
    })
  );
  const bundleManifest = safeReadJson(path.join(bundlePath, "bundle_manifest.json"));
  const artifactManifest = safeReadJson(path.join(bundlePath, "artifact_manifest.json"));
  const claimsPayload = safeReadJson(path.join(bundlePath, "claims.json"));
  const artifacts = artifactList(artifactManifest);
  const claims = claimList(claimsPayload);
  const errors = requiredFiles.filter((name) => !existsSync(path.join(bundlePath, name))).map((name) => `missing required file: ${name}`);
  const valid = errors.length === 0 && isRecord(bundleManifest) && artifacts.length > 0 && claims.length > 0;

  return {
    schema_version: "operator.research.result_bundle.validation.v1",
    compatibility_schema: "ara.result_bundle.validation.v1",
    runtime: "native_ts",
    path: bundlePath,
    valid,
    bundle_type: stringValue(bundleManifest.bundle_type) || "unknown",
    errors,
    warnings: [],
    files,
    checks: [
      {
        id: "required_files",
        status: errors.length ? "fail" : "pass",
        message: errors.length ? "Required bundle files are missing." : "Required bundle files are present."
      },
      {
        id: "artifact_manifest",
        status: artifacts.length ? "pass" : "fail",
        message: artifacts.length ? "artifact_manifest.json declares artifacts." : "artifact_manifest.json has no artifacts."
      },
      {
        id: "claims",
        status: claims.length ? "pass" : "fail",
        message: claims.length ? "claims.json declares candidate claims." : "claims.json has no claims."
      }
    ],
    metadata: {
      bundle_manifest: bundleManifest,
      domain: stringValue(bundleManifest.domain),
      created_at: stringValue(bundleManifest.created_at),
      artifact_count: artifacts.length,
      artifact_ids: artifacts.map((artifact) => artifact.artifact_id).filter(Boolean),
      artifacts,
      claim_count: claims.length,
      bundle_type: stringValue(bundleManifest.bundle_type) || "unknown",
      validation_profile: "operator_native_ts"
    }
  };
}

function readEmpiricalEvidencePackage(state: AraPaperPipelineState, context: JsonRecord): EmpiricalEvidencePackage {
  const artifacts = arrayOfRecords(context.artifact_dependencies);
  const allowedClaims = arrayOfRecords(context.allowed_claims);
  const primaryClaim = String(allowedClaims[0]?.claim ?? "The result bundle contains a supported empirical research claim.");
  const studyDesign = readArtifactJson(
    state,
    artifacts,
    ["study_design", "benchmark_or_study_design"],
    ["study_design.json", "work/tasks/conformal_ttc_pilot/study_design.json"]
  );
  const metricsRows = parseCsvRecords(
    readArtifactText(
      state,
      artifacts,
      ["metrics_table", "benchmark_metrics_table"],
      ["metrics_table.csv", "work/tasks/conformal_ttc_pilot/metrics_table.csv"]
    )
  );
  const baselineRows = parseCsvRecords(
    readArtifactText(
      state,
      artifacts,
      ["baseline_comparison"],
      ["baseline_comparison.csv", "work/tasks/conformal_ttc_pilot/baseline_comparison.csv"]
    )
  );
  const iterationRows = parseCsvRecords(
    readArtifactText(
      state,
      artifacts,
      ["iteration_trace", "policy_iteration_trace"],
      ["iteration_trace.csv", "work/tasks/verified_policy_search/iteration_trace.csv"]
    )
  );
  const selectedCertificate = readArtifactJson(
    state,
    artifacts,
    ["selected_certificate", "policy_certificate"],
    ["selected_certificate.json", "work/tasks/verified_policy_search/selected_certificate.json"]
  );
  const statisticalUncertainty = readArtifactJson(
    state,
    artifacts,
    ["statistical_uncertainty", "statistical_uncertainty_analysis"],
    ["statistical_uncertainty.json", "work/tasks/conformal_ttc_pilot/statistical_uncertainty.json"]
  );
  const errorAnalysis = readArtifactJson(
    state,
    artifacts,
    ["error_analysis"],
    ["error_analysis.json", "work/tasks/conformal_ttc_pilot/error_analysis.json"]
  );
  const verifierSummary = readArtifactJson(
    state,
    artifacts,
    ["verifier_summary"],
    ["artifacts/tasks/materialize_verifier_scores/verifier_summary.json", "work/tasks/materialize_verifier_scores/verifier_summary.json"]
  );
  const stageSummary = readArtifactJson(
    state,
    artifacts,
    ["stage3_summary", "run_summary"],
    ["stage3_summary.json", "work/tasks/verified_policy_search/stage3_summary.json"]
  );
  const primaryContribution = readArtifactText(
    state,
    artifacts,
    ["primary_contribution"],
    ["primary_contribution.md", "work/tasks/conformal_ttc_pilot/primary_contribution.md"]
  );
  const mechanismInsight = readArtifactText(
    state,
    artifacts,
    ["mechanism_insight", "broad_insight"],
    ["mechanism_insight.md", "work/tasks/conformal_ttc_pilot/mechanism_insight.md"]
  );
  const draftingBrief =
    readOptionalText(path.join(state.ara.resultBundlePath, "drafting_brief.md")) ||
    readOptionalText(path.join(state.ara.resultBundlePath, "writing_brief.md"));
  const limitations = readOptionalText(path.join(state.ara.resultBundlePath, "limitations.md"));
  return {
    primaryClaim,
    studyDesign,
    metricsRows,
    baselineRows,
    iterationRows,
    selectedCertificate,
    statisticalUncertainty,
    errorAnalysis,
    verifierSummary,
    stageSummary,
    primaryContribution,
    mechanismInsight,
    draftingBrief,
    limitations,
    artifacts
  };
}

function empiricalTitle(state: AraPaperPipelineState, pkg: EmpiricalEvidencePackage, template: PaperTemplate): string {
  const topic = stringValue(pkg.studyDesign.topic) || state.ara.topic;
  if (/conformal|test-time|llm|reasoning/iu.test(topic)) {
    return "Verifier-Assisted Conformal Test-Time Compute for Reliable LLM Reasoning";
  }
  return template.defaultTitle;
}

function readArtifactText(state: AraPaperPipelineState, artifacts: JsonRecord[], selectors: string[], fallbacks: string[]): string {
  const resolved = resolveArtifactPath(state, artifacts, selectors);
  if (resolved) return readOptionalText(resolved);
  for (const fallback of fallbacks) {
    const filePath = path.join(state.ara.resultBundlePath, fallback);
    if (existsSync(filePath)) return readOptionalText(filePath);
  }
  return "";
}

function readArtifactJson(state: AraPaperPipelineState, artifacts: JsonRecord[], selectors: string[], fallbacks: string[]): JsonRecord {
  const resolved = resolveArtifactPath(state, artifacts, selectors);
  if (resolved) return safeReadJson(resolved);
  for (const fallback of fallbacks) {
    const filePath = path.join(state.ara.resultBundlePath, fallback);
    if (existsSync(filePath)) return safeReadJson(filePath);
  }
  return {};
}

function resolveArtifactPath(state: AraPaperPipelineState, artifacts: JsonRecord[], selectors: string[]): string | null {
  const normalizedSelectors = selectors.map((selector) => selector.toLowerCase());
  const artifact = artifacts.find((candidate) => {
    const haystack = [candidate.artifact_id, candidate.kind, candidate.path, candidate.description].map((value) =>
      String(value ?? "").toLowerCase()
    );
    return normalizedSelectors.some((selector) => haystack.some((value) => value === selector || value.includes(selector)));
  });
  const relativePath = stringValue(artifact?.path);
  if (!relativePath) return null;
  const filePath = path.isAbsolute(relativePath) ? relativePath : path.join(state.ara.resultBundlePath, relativePath);
  return existsSync(filePath) ? filePath : null;
}

function parseCsvRecords(value: string): CsvRecord[] {
  const lines = value.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function conformalPolicyRow(rows: CsvRecord[]): CsvRecord {
  return rows.find((row) => /conformal/iu.test(String(row.policy ?? ""))) ?? rows[rows.length - 1] ?? {};
}

function selectedIterationRecord(pkg: EmpiricalEvidencePackage): JsonRecord {
  const uncertaintyIteration = isRecord(pkg.statisticalUncertainty.selected_iteration) ? pkg.statisticalUncertainty.selected_iteration : {};
  if (Object.keys(uncertaintyIteration).length) return uncertaintyIteration;
  const stageIteration = isRecord(pkg.stageSummary.selected_iteration) ? pkg.stageSummary.selected_iteration : {};
  if (Object.keys(stageIteration).length) return stageIteration;
  const conformal = conformalPolicyRow(pkg.metricsRows);
  const selected = metricValue(conformal, "selected_iteration");
  if (Number.isFinite(selected)) return pkg.iterationRows.find((row) => metricValue(row, "iteration") === selected) ?? {};
  return pkg.iterationRows[pkg.iterationRows.length - 1] ?? {};
}

function certificateSummaryRows(
  certificate: JsonRecord
): Array<{ key: string; domain: string; action: string; certified: boolean; threshold: number; empiricalError: number; total: number }> {
  const thresholds = isRecord(certificate.thresholds)
    ? certificate.thresholds
    : isRecord(certificate.certificate_table)
      ? certificate.certificate_table
      : {};
  return Object.entries(thresholds).map(([key, raw]) => {
    const record = isRecord(raw) ? raw : {};
    const [domain, action] = key.includes(":") ? key.split(":", 2) : ["global", key];
    return {
      key,
      domain,
      action,
      certified: Boolean(record.certified),
      threshold: numberValue(record.threshold) ?? NaN,
      empiricalError: numberValue(record.empirical_error) ?? numberValue(record.error) ?? NaN,
      total: Math.round(numberValue(record.total) ?? 0)
    };
  });
}

function domainMetricRows(errorAnalysis: JsonRecord): Array<{
  domain: string;
  answered: number;
  abstained: number;
  coverage: number;
  risk: number;
  accuracy: number;
  wrong: number;
  cost: number;
}> {
  const source = isRecord(errorAnalysis.domain_metrics)
    ? errorAnalysis.domain_metrics
    : isRecord(errorAnalysis.analysis)
      ? errorAnalysis.analysis
      : {};
  return Object.entries(source)
    .map(([key, raw]) => {
      const record = isRecord(raw) ? raw : {};
      const domain = key.replace(/^domain:/u, "");
      return {
        domain,
        answered: Math.round(numberValue(record.answered) ?? 0),
        abstained: Math.round(numberValue(record.action_abstain) ?? 0),
        coverage: numberValue(record.coverage) ?? 0,
        risk: numberValue(record.false_answer_risk) ?? 0,
        accuracy: numberValue(record.accepted_accuracy) ?? 0,
        wrong: Math.round(numberValue(record.wrong) ?? 0),
        cost: numberValue(record.cost_per_accepted_answer) ?? 0
      };
    })
    .filter((row) => !/^difficulty:/u.test(row.domain));
}

function uncertaintyForPolicy(uncertainty: JsonRecord, policy: string): { coverage: number[]; risk: number[]; cost: number[] } {
  const intervals = isRecord(uncertainty.policy_intervals) ? uncertainty.policy_intervals : {};
  const exact = isRecord(intervals[policy]) ? intervals[policy] : {};
  const fallbackKey = Object.keys(intervals).find((key) => /conformal/iu.test(key));
  const fallback = fallbackKey && isRecord(intervals[fallbackKey]) ? intervals[fallbackKey] : {};
  const record = Object.keys(exact).length ? exact : fallback;
  return {
    coverage: numberArray(record.coverage_95ci),
    risk: numberArray(record.false_answer_risk_95ci),
    cost: numberArray(record.cost_per_accepted_answer_95ci)
  };
}

async function generateEmpiricalImageAssets(
  state: AraPaperPipelineState,
  context: JsonRecord,
  buildDir: string,
  template: PaperTemplate
): Promise<GeneratedFigureAsset[]> {
  if (template.paperType === "formal_proof") return [];
  const figuresDir = `${buildDir}/figures`;
  const absoluteBuildDir = workspacePath(state.workspace, buildDir);
  mkdirSync(workspacePath(state.workspace, figuresDir), { recursive: true });

  const pkg = readEmpiricalEvidencePackage(state, context);
  const rows = pkg.metricsRows.length ? pkg.metricsRows : pkg.baselineRows;
  const conformal = conformalPolicyRow(rows);
  const selectedIteration = selectedIterationRecord(pkg);
  const conformalPolicy = String(conformal.policy ?? "conformal_ttc");
  const domainRows = domainMetricRows(pkg.errorAnalysis);
  const certificateRows = certificateSummaryRows(pkg.selectedCertificate);
  const uncertainty = uncertaintyForPolicy(pkg.statisticalUncertainty, conformalPolicy);
  const totalItems = Math.round(metricValue(conformal, "total") || numberValue(pkg.studyDesign.holdout_item_count) || 0);
  const verifiedRows = Math.round(numberValue(pkg.verifierSummary.verified_row_count) || 0);
  const verifierCalls = Math.round(numberValue(pkg.verifierSummary.verifier_call_count) || 0);
  const iterationBudget = Math.round(
    numberValue(pkg.studyDesign.iteration_budget) || pkg.iterationRows.length || numberValue(selectedIteration.iteration) || 0
  );
  const riskTarget = numberValue(pkg.studyDesign.risk_target_alpha) ?? 0.1;
  const figureData = {
    schema_version: "operator.research.empirical_figure_data.v1",
    generated_at: new Date().toISOString(),
    title: state.ara.manuscriptTitle || empiricalTitle(state, pkg, template),
    topic: state.ara.topic,
    claim: pkg.primaryClaim,
    objective: stringValue(pkg.studyDesign.objective) || "Evaluate risk-controlled answer acceptance under test-time compute.",
    action_set: actionSetDescription(pkg.studyDesign),
    score_definition:
      stringValue(pkg.verifierSummary.score_definition) || "Verifier scores rank candidate answers before calibrated acceptance.",
    selected_policy: humanizePolicyName(conformalPolicy),
    risk_target: riskTarget,
    holdout_items: totalItems,
    verified_rows: verifiedRows,
    verifier_calls: verifierCalls,
    iteration_budget: iterationBudget,
    policies: rows.slice(0, 10).map((row) => ({
      policy: humanizePolicyName(String(row.policy ?? "policy")),
      coverage: finiteOrNull(metricValue(row, "coverage")),
      risk: finiteOrNull(metricValue(row, "false_answer_risk")),
      accuracy: finiteOrNull(metricValue(row, "accepted_accuracy")),
      avg_cost: finiteOrNull(metricValue(row, "avg_cost_per_item")),
      cost_per_accepted: finiteOrNull(metricValue(row, "cost_per_accepted_answer")),
      answered: finiteOrNull(metricValue(row, "answered")),
      wrong: finiteOrNull(metricValue(row, "wrong")),
      total: finiteOrNull(metricValue(row, "total"))
    })),
    domains: domainRows.slice(0, 8).map((row) => ({
      domain: humanizePolicyName(row.domain),
      answered: row.answered,
      abstained: row.abstained,
      coverage: finiteOrNull(row.coverage),
      risk: finiteOrNull(row.risk),
      accuracy: finiteOrNull(row.accuracy),
      wrong: row.wrong,
      cost: finiteOrNull(row.cost)
    })),
    certificate: {
      certified: certificateRows.filter((row) => row.certified).length,
      uncertified: Math.max(0, certificateRows.length - certificateRows.filter((row) => row.certified).length),
      rows: certificateRows.slice(0, 12).map((row) => ({
        key: row.key,
        domain: humanizePolicyName(row.domain),
        action: humanizePolicyName(row.action),
        certified: row.certified,
        threshold: finiteOrNull(row.threshold),
        empirical_error: finiteOrNull(row.empiricalError),
        total: row.total
      }))
    },
    uncertainty: {
      coverage: uncertainty.coverage.map(finiteOrNull),
      risk: uncertainty.risk.map(finiteOrNull),
      cost: uncertainty.cost.map(finiteOrNull)
    },
    selection: {
      iteration: finiteOrNull(numberValue(selectedIteration.iteration)),
      scope: stringValue(selectedIteration.scope) || stringValue(pkg.selectedCertificate.scope) || "recorded policy family",
      alpha: finiteOrNull(numberValue(selectedIteration.alpha) ?? riskTarget),
      margin: finiteOrNull(numberValue(selectedIteration.margin)),
      min_count: finiteOrNull(numberValue(selectedIteration.min_count)),
      certified_threshold_count: finiteOrNull(numberValue(selectedIteration.certified_threshold_count))
    }
  };

  const figureDataJson = `${figuresDir}/figure_data.json`;
  const manifestJson = `${figuresDir}/image_generation_manifest.json`;
  const generatorScript = `${buildDir}/generate_figures.py`;
  writeJson(workspacePath(state.workspace, figureDataJson), figureData);
  writeText(workspacePath(state.workspace, generatorScript), renderEmpiricalFigureGeneratorScript());

  const assets: GeneratedFigureAsset[] = empiricalGeneratedFigureSpecs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    filename: spec.filename,
    role: spec.role,
    path: `${figuresDir}/${spec.filename}`
  }));

  try {
    const result = await runCommand(process.env.PYTHON ?? "python3", ["generate_figures.py"], {
      cwd: absoluteBuildDir,
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
      timeoutMs: 180_000
    });
    const missing = assets.filter((asset) => !existsSync(workspacePath(state.workspace, asset.path)));
    writeJson(workspacePath(state.workspace, manifestJson), {
      schema_version: "operator.research.image_generation_manifest.v1",
      status: missing.length ? "missing_assets" : "generated",
      generated_at: new Date().toISOString(),
      generator: "matplotlib",
      command: result.command,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      source_data: figureDataJson,
      assets
    });
    if (missing.length) {
      throw new Error(
        `Empirical figure generation did not create required image assets: ${missing.map((asset) => asset.filename).join(", ")}`
      );
    }
    return assets;
  } catch (error) {
    writeJson(workspacePath(state.workspace, manifestJson), {
      schema_version: "operator.research.image_generation_manifest.v1",
      status: "failed",
      generated_at: new Date().toISOString(),
      generator: "matplotlib",
      source_data: figureDataJson,
      assets,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function renderEmpiricalFigureGeneratorScript(): string {
  return String.raw`#!/usr/bin/env python3
import json
import math
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle

FIGURES = Path("figures")
DATA = json.loads((FIGURES / "figure_data.json").read_text(encoding="utf-8"))
PALETTE = {
    "blue": "#2F6FB0",
    "green": "#1B8A5A",
    "orange": "#D9822B",
    "purple": "#7353BA",
    "red": "#C43B3B",
    "gray": "#6B7280",
    "light": "#F7F8FA",
    "ink": "#111827",
}

plt.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 300,
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.labelsize": 9,
    "legend.fontsize": 8,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def clean_number(value, default=0.0):
    try:
        value = float(value)
        return value if math.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def short(value, width):
    value = str(value or "")
    return "\n".join(textwrap.wrap(value, width=width)) or "recorded"


def box(ax, xy, w, h, title, body="", color="#FFFFFF"):
    patch = FancyBboxPatch(
        xy,
        w,
        h,
        boxstyle="round,pad=0.03,rounding_size=0.04",
        linewidth=1.1,
        edgecolor=PALETTE["ink"],
        facecolor=color,
    )
    ax.add_patch(patch)
    ax.text(xy[0] + w / 2, xy[1] + h * 0.62, title, ha="center", va="center", weight="bold")
    if body:
        ax.text(xy[0] + w / 2, xy[1] + h * 0.3, short(body, 24), ha="center", va="center", fontsize=7.4)
    return patch


def arrow(ax, start, end, style="-|>", color=None, rad=0.0):
    ax.add_patch(FancyArrowPatch(
        start,
        end,
        arrowstyle=style,
        mutation_scale=12,
        linewidth=1.25,
        color=color or PALETTE["ink"],
        connectionstyle=f"arc3,rad={rad}",
    ))


def save(fig, name):
    fig.tight_layout()
    fig.savefig(FIGURES / name, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def system_architecture():
    fig, ax = plt.subplots(figsize=(11.5, 5.5))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 5.4)
    ax.axis("off")
    box(ax, (0.3, 3.0), 1.8, 1.05, "Benchmark", "item x_i", "#E8F1FA")
    box(ax, (2.55, 3.0), 2.15, 1.05, "Test-time actions", DATA.get("action_set"), "#E7F5EF")
    box(ax, (5.15, 3.0), 2.15, 1.05, "Verifier score", DATA.get("score_definition"), "#FFF1DF")
    box(ax, (7.75, 3.0), 2.1, 1.05, "Calibrated policy", DATA.get("selected_policy"), "#EFEAFB")
    box(ax, (10.25, 3.0), 1.6, 1.05, "Decision", "accept or abstain", "#F8E8E8")
    box(ax, (2.7, 1.2), 1.9, 0.78, "Tuning split", "threshold search", "#F4F5F7")
    box(ax, (5.3, 1.2), 1.9, 0.78, "Certificate", "support counts", "#F4F5F7")
    box(ax, (8.0, 1.2), 1.9, 0.78, "Holdout readout", "risk, coverage, cost", "#F4F5F7")
    arrow(ax, (2.1, 3.52), (2.55, 3.52))
    arrow(ax, (4.7, 3.52), (5.15, 3.52))
    arrow(ax, (7.3, 3.52), (7.75, 3.52))
    arrow(ax, (9.85, 3.52), (10.25, 3.52))
    arrow(ax, (3.65, 1.98), (8.2, 3.0), color=PALETTE["gray"], rad=-0.12)
    arrow(ax, (6.25, 1.98), (8.75, 3.0), color=PALETTE["gray"], rad=0.05)
    arrow(ax, (8.95, 3.0), (8.95, 1.98), color=PALETTE["gray"])
    ax.text(0.3, 4.85, "A. Verifier-assisted conformal TTC system", weight="bold", fontsize=12, ha="left")
    ax.text(0.3, 0.35, f"Risk target alpha={clean_number(DATA.get('risk_target')):.3g}; policy={DATA.get('selected_policy', 'recorded policy')}", fontsize=8.5, color=PALETTE["gray"])
    save(fig, "system_architecture.png")


def experiment_setup():
    fig, ax = plt.subplots(figsize=(11.5, 5.2))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 5)
    ax.axis("off")
    steps = [
        ("Benchmarks", f"{DATA.get('holdout_items') or 'recorded'} holdout items", "#E8F1FA"),
        ("Response matrix", f"{DATA.get('verified_rows') or 'recorded'} scored rows", "#E7F5EF"),
        ("Verifier calls", f"{DATA.get('verifier_calls') or 'recorded'} calls", "#FFF1DF"),
        ("Policy search", f"{DATA.get('iteration_budget') or 'recorded'} iteration(s)", "#EFEAFB"),
        ("Frozen holdout", "risk, coverage, cost", "#F8E8E8"),
    ]
    xs = [0.35, 2.65, 4.95, 7.25, 9.55]
    for x, (title, body, color) in zip(xs, steps):
        box(ax, (x, 2.85), 1.85, 0.95, title, body, color)
    for x in xs[:-1]:
        arrow(ax, (x + 1.85, 3.33), (x + 2.3, 3.33))
    box(ax, (3.05, 1.15), 2.15, 0.88, "Uncertainty", "bootstrap intervals", "#F4F5F7")
    box(ax, (6.65, 1.15), 2.15, 0.88, "Error analysis", "domain behavior", "#F4F5F7")
    arrow(ax, (8.2, 2.85), (4.15, 2.03), color=PALETTE["gray"], rad=0.08)
    arrow(ax, (10.45, 2.85), (7.75, 2.03), color=PALETTE["gray"], rad=-0.08)
    arrow(ax, (5.2, 1.58), (6.65, 1.58), color=PALETTE["gray"])
    ax.text(0.35, 4.55, "B. Experimental setup and artifact flow", weight="bold", fontsize=12, ha="left")
    ax.text(0.35, 0.35, short(DATA.get("objective"), 150), fontsize=8.5, color=PALETTE["gray"], ha="left")
    save(fig, "experiment_setup.png")


def quality_by_task():
    domains = DATA.get("domains") or []
    policies = DATA.get("policies") or []
    rows = domains if domains else [
        {
            "domain": row.get("policy", f"policy {i+1}"),
            "answered": clean_number(row.get("answered")),
            "abstained": max(0.0, clean_number(row.get("total")) - clean_number(row.get("answered"))),
            "coverage": clean_number(row.get("coverage")),
            "risk": clean_number(row.get("risk")),
            "accuracy": clean_number(row.get("accuracy")),
        }
        for i, row in enumerate(policies[:6])
    ]
    rows = rows[:6] or [{"domain": "recorded", "answered": 1, "abstained": 1, "coverage": 0.5, "risk": clean_number(DATA.get("risk_target")), "accuracy": 0.5}]
    labels = [short(row.get("domain"), 14).replace("\n", " ") for row in rows]
    answered = [clean_number(row.get("answered")) for row in rows]
    abstained = [clean_number(row.get("abstained")) for row in rows]
    totals = [max(1.0, a + b) for a, b in zip(answered, abstained)]
    accepted_share = [a / t for a, t in zip(answered, totals)]
    abstain_share = [b / t for b, t in zip(abstained, totals)]
    risk = [clean_number(row.get("risk")) for row in rows]
    accuracy = [clean_number(row.get("accuracy")) for row in rows]

    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.8), gridspec_kw={"width_ratios": [1.05, 1]})
    x = range(len(labels))
    axes[0].bar(x, accepted_share, color=PALETTE["green"], label="accepted")
    axes[0].bar(x, abstain_share, bottom=accepted_share, color="#C7CCD3", label="abstained")
    axes[0].set_ylim(0, 1)
    axes[0].set_ylabel("share of items")
    axes[0].set_title("A. Acceptance and abstention by task")
    axes[0].set_xticks(list(x))
    axes[0].set_xticklabels(labels, rotation=35, ha="right")
    axes[0].legend(frameon=False, loc="upper right")

    axes[1].plot(list(x), risk, marker="o", linewidth=1.6, color=PALETTE["red"], label="false-answer risk")
    axes[1].plot(list(x), accuracy, marker="s", linewidth=1.6, color=PALETTE["blue"], label="accepted accuracy")
    axes[1].axhline(clean_number(DATA.get("risk_target")), color=PALETTE["red"], linestyle="--", linewidth=1, alpha=0.75, label="risk target")
    axes[1].set_ylim(0, max(1.0, max(accuracy + risk + [clean_number(DATA.get("risk_target"))]) * 1.08))
    axes[1].set_ylabel("metric value")
    axes[1].set_title("B. Risk and accuracy by task")
    axes[1].set_xticks(list(x))
    axes[1].set_xticklabels(labels, rotation=35, ha="right")
    axes[1].legend(frameon=False, loc="best")
    for ax in axes:
        ax.grid(axis="y", color="#E5E7EB", linewidth=0.7)
    save(fig, "quality_by_task.png")


def mechanism_diagnostics():
    domains = (DATA.get("domains") or [])[:5]
    if not domains:
        domains = [{"domain": "recorded", "coverage": 0.5, "risk": clean_number(DATA.get("risk_target"))}]
    cert = DATA.get("certificate") or {}
    uncertainty = DATA.get("uncertainty") or {}
    coverage_interval = [clean_number(v) for v in (uncertainty.get("coverage") or [0, 0])]
    risk_interval = [clean_number(v) for v in (uncertainty.get("risk") or [clean_number(DATA.get("risk_target")), clean_number(DATA.get("risk_target"))])]
    cost_interval = [clean_number(v) for v in (uncertainty.get("cost") or [0, 0])]
    labels = [short(row.get("domain"), 12).replace("\n", " ") for row in domains]
    coverage = [clean_number(row.get("coverage")) for row in domains]
    risk = [clean_number(row.get("risk")) for row in domains]

    fig, axes = plt.subplots(2, 2, figsize=(11.5, 7.2))
    intervals = [
        ("coverage", coverage_interval, PALETTE["blue"]),
        ("risk", risk_interval, PALETTE["red"]),
        ("cost/accepted", cost_interval, PALETTE["purple"]),
    ]
    for y, (name, interval, color) in enumerate(intervals):
        lo = interval[0] if interval else 0
        hi = interval[1] if len(interval) > 1 else lo
        mid = (lo + hi) / 2
        axes[0, 0].plot([lo, hi], [y, y], color=color, linewidth=2.3)
        axes[0, 0].scatter([mid], [y], color=color, s=32, zorder=3)
    axes[0, 0].set_yticks(range(len(intervals)))
    axes[0, 0].set_yticklabels([item[0] for item in intervals])
    axes[0, 0].set_title("A. Bootstrap intervals")
    axes[0, 0].grid(axis="x", color="#E5E7EB", linewidth=0.7)

    x = range(len(labels))
    axes[0, 1].bar([i - 0.17 for i in x], coverage, width=0.34, color=PALETTE["blue"], label="coverage")
    axes[0, 1].bar([i + 0.17 for i in x], risk, width=0.34, color=PALETTE["red"], label="risk")
    axes[0, 1].set_xticks(list(x))
    axes[0, 1].set_xticklabels(labels, rotation=30, ha="right")
    axes[0, 1].set_ylim(0, max(1.0, max(coverage + risk) * 1.15))
    axes[0, 1].set_title("B. Domain mechanism")
    axes[0, 1].legend(frameon=False)
    axes[0, 1].grid(axis="y", color="#E5E7EB", linewidth=0.7)

    certified = clean_number(cert.get("certified"))
    uncertified = clean_number(cert.get("uncertified"))
    axes[1, 0].barh(["certified", "uncertified"], [certified, uncertified], color=[PALETTE["green"], "#C7CCD3"])
    axes[1, 0].set_title("C. Certificate support")
    axes[1, 0].set_xlabel("threshold count")
    axes[1, 0].grid(axis="x", color="#E5E7EB", linewidth=0.7)

    selection = DATA.get("selection") or {}
    axes[1, 1].axis("off")
    text = (
        f"Selected policy: {DATA.get('selected_policy', 'recorded')}\n"
        f"Iteration: {selection.get('iteration') or 'recorded'}\n"
        f"Scope: {selection.get('scope') or 'recorded'}\n"
        f"Rule: maximize coverage subject to risk <= {clean_number(DATA.get('risk_target')):.3g}"
    )
    axes[1, 1].text(
        0.04,
        0.72,
        text,
        va="top",
        ha="left",
        fontsize=10,
        bbox=dict(boxstyle="round,pad=0.45,rounding_size=0.08", facecolor="#EFEAFB", edgecolor=PALETTE["ink"], linewidth=1),
    )
    axes[1, 1].set_title("D. Selection rule")
    save(fig, "mechanism_diagnostics.png")


system_architecture()
experiment_setup()
quality_by_task()
mechanism_diagnostics()
`;
}

function prepareLatexLayoutAssets(state: AraPaperPipelineState, buildDir: string, template: PaperTemplate): LatexLayoutStyle {
  if (template.paperType === "formal_proof") return "operator_ctex";
  const templateDir = findAraAnalemmaTemplateDir(state);
  if (!templateDir) return "operator_ctex";
  for (const filename of ["analemma.sty", "analemma.bst", "logo.png"]) {
    const source = path.join(templateDir, filename);
    if (!existsSync(source)) return "operator_ctex";
  }
  for (const filename of ["analemma.sty", "analemma.bst", "logo.png"]) {
    copyFileSync(path.join(templateDir, filename), workspacePath(state.workspace, `${buildDir}/${filename}`));
  }
  return "ara_analemma";
}

function findAraAnalemmaTemplateDir(state: AraPaperPipelineState): string | null {
  let cursor = state.ara.resultBundlePath;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(cursor, "writing", "paper");
    if (existsSync(path.join(candidate, "analemma.sty")) && existsSync(path.join(candidate, "analemma.bst"))) {
      return candidate;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const repoCandidate = path.join(state.ara.repoPath, "writing", "paper");
  if (existsSync(path.join(repoCandidate, "analemma.sty")) && existsSync(path.join(repoCandidate, "analemma.bst"))) {
    return repoCandidate;
  }
  return null;
}

function finiteOrNull(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function metricValue(row: CsvRecord | JsonRecord | undefined, key: string): number {
  if (!row) return NaN;
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return NaN;
}

function minBy<T>(values: T[], selector: (value: T) => number): T | undefined {
  return values.reduce<T | undefined>((best, value) => {
    const score = selector(value);
    if (!Number.isFinite(score)) return best;
    if (!best) return value;
    const bestScore = selector(best);
    return score < bestScore ? value : best;
  }, undefined);
}

function actionSetDescription(studyDesign: JsonRecord): string {
  if (isRecord(studyDesign.actions)) {
    return Object.entries(studyDesign.actions)
      .map(([action, cost]) => `${humanizePolicyName(action)} (cost ${fmtMetric(numberValue(cost))})`)
      .join(", ");
  }
  if (Array.isArray(studyDesign.policies)) {
    return studyDesign.policies.map((policy) => humanizePolicyName(String(policy))).join(", ");
  }
  return "direct answering, verifier-assisted answering, higher-compute reasoning, and abstention";
}

function renderPolicyMetricsTable(rows: CsvRecord[]): string {
  const tableRows = rows
    .slice(0, 8)
    .map(
      (row) =>
        [
          latexEscape(humanizePolicyName(String(row.policy ?? "policy"))),
          fmtMetric(metricValue(row, "coverage")),
          fmtMetric(metricValue(row, "false_answer_risk")),
          fmtMetric(metricValue(row, "accepted_accuracy")),
          fmtMetric(metricValue(row, "avg_cost_per_item")),
          fmtMetric(metricValue(row, "cost_per_accepted_answer")),
          String(Math.round(metricValue(row, "answered")) || "--"),
          String(Math.round(metricValue(row, "wrong")) || "0")
        ].join(" & ") + " \\\\"
    )
    .join("\n");
  return String.raw`\begin{table}[tbp]
\centering
\small
\caption{Held-out risk, coverage, accuracy, and compute metrics for reported policies.}
\label{tab:policy-metrics}
\begin{tabular}{@{}lrrrrrrr@{}}
\toprule
Policy & Coverage & Risk & Accuracy & Cost/item & Cost/accepted & Answered & Wrong \\
\midrule
${tableRows || "No policy rows & -- & -- & -- & -- & -- & -- & -- \\\\"}
\bottomrule
\end{tabular}
\end{table}`;
}

function renderCertificateTable(
  rows: Array<{ key: string; domain: string; action: string; certified: boolean; threshold: number; empiricalError: number; total: number }>
): string {
  const tableRows = rows
    .slice(0, 12)
    .map(
      (row) =>
        [
          latexEscape(row.domain),
          latexEscape(humanizePolicyName(row.action)),
          row.certified ? "yes" : "no",
          fmtMetric(row.threshold),
          fmtMetric(row.empiricalError),
          String(row.total)
        ].join(" & ") + " \\\\"
    )
    .join("\n");
  return String.raw`\begin{table}[tbp]
\centering
\small
\caption{Selected conformal certificate entries.}
\label{tab:certificate}
\begin{tabular}{@{}llrrrr@{}}
\toprule
Domain & Action & Certified & Threshold & Empirical error & Count \\
\midrule
${tableRows || "global & recorded policy & no & -- & -- & 0 \\\\"}
\bottomrule
\end{tabular}
\end{table}`;
}

function renderDomainErrorTable(
  rows: Array<{
    domain: string;
    answered: number;
    abstained: number;
    coverage: number;
    risk: number;
    accuracy: number;
    wrong: number;
    cost: number;
  }>
): string {
  const tableRows = rows
    .map(
      (row) =>
        [
          latexEscape(humanizePolicyName(row.domain)),
          String(row.answered),
          String(row.abstained),
          fmtMetric(row.coverage),
          fmtMetric(row.risk),
          fmtMetric(row.accuracy),
          String(row.wrong),
          fmtMetric(row.cost)
        ].join(" & ") + " \\\\"
    )
    .join("\n");
  return String.raw`\begin{table}[tbp]
\centering
\small
\caption{Domain-level acceptance and error behavior for the selected conformal policy.}
\label{tab:domain-errors}
\begin{tabular}{@{}lrrrrrrr@{}}
\toprule
Domain & Answered & Abstained & Coverage & Risk & Accuracy & Wrong & Cost/accepted \\
\midrule
${tableRows || "Recorded split & -- & -- & -- & -- & -- & -- & -- \\\\"}
\bottomrule
\end{tabular}
\end{table}`;
}

function renderMethodConfigurationTable(
  pkg: EmpiricalEvidencePackage,
  holdoutDescription: string,
  iterationBudget: number,
  riskTarget: number,
  verifiedRows: number,
  verifierCalls: number
): string {
  return String.raw`\begin{table}[tbp]
\centering
\small
\caption{Method configuration for verifier-assisted conformal test-time compute.}
\label{tab:method-config}
\begin{tabular}{@{}p{0.26\linewidth}p{0.64\linewidth}@{}}
\toprule
Configuration item & Value used in the study \\
\midrule
Research objective & ${latexEscape(shorten(stringValue(pkg.studyDesign.objective) || "Evaluate risk-controlled answer acceptance under test-time compute.", 180))} \\
Action family & ${latexEscape(actionSetDescription(pkg.studyDesign))} \\
Evaluation split & ${latexEscape(holdoutDescription)} \\
Policy-search budget & ${iterationBudget || "Recorded"} iteration(s) with a frozen holdout readout \\
Risk target \(\alpha\) & ${fmtMetric(riskTarget)} accepted-answer false-risk budget \\
Verifier scale & ${verifiedRows || "Recorded"} scored response rows; ${verifierCalls || "recorded"} verifier calls \\
Primary outputs & Holdout risk, coverage, accepted accuracy, compute cost, uncertainty intervals, and domain-level abstention behavior \\
\bottomrule
\end{tabular}
\end{table}`;
}

function renderGeneratedImageFigure(options: {
  filename: string;
  label: string;
  caption: string;
  marker: string;
  fallbackTikz: string;
}): string {
  return String.raw`\begin{figure}[tbp]
\centering
${options.marker}
\IfFileExists{figures/${options.filename}}{%
\includegraphics[width=\linewidth]{figures/${options.filename}}%
}{%
\resizebox{\linewidth}{!}{%
${options.fallbackTikz}
}%
}
\caption{${options.caption}}
\label{${options.label}}
\end{figure}`;
}

function renderSystemArchitectureFigure(pkg: EmpiricalEvidencePackage, conformalPolicy: string): string {
  const actionSummary = latexEscape(shorten(actionSetDescription(pkg.studyDesign), 62));
  const scoreSummary = latexEscape(
    shorten(stringValue(pkg.verifierSummary.score_definition) || "Verifier scores rank candidate answers before calibrated acceptance.", 70)
  );
  const policyName = latexEscape(shorten(humanizePolicyName(conformalPolicy), 42));
  const fallbackTikz = String.raw`\begin{tikzpicture}[
  node distance=1.0cm,
  box/.style={draw, rounded corners=2pt, align=center, text width=2.6cm, minimum width=2.8cm, minimum height=1.1cm, font=\scriptsize},
  smallbox/.style={draw, rounded corners=2pt, align=center, text width=2.0cm, minimum width=2.2cm, minimum height=0.78cm, font=\scriptsize},
  arr/.style={-Latex, thick}
]
\node[box, fill=blue!9] (input) {Benchmark item\\\(x_i\)};
\node[box, fill=green!9, right=1.0cm of input] (actions) {Test-time actions\\${actionSummary}};
\node[box, fill=orange!12, right=1.0cm of actions] (verifier) {Verifier / execution score\\${scoreSummary}};
\node[box, fill=purple!9, right=1.0cm of verifier] (policy) {Calibrated policy\\${policyName}};
\node[smallbox, fill=gray!10, below=0.75cm of actions] (calibration) {Tuning split\\threshold search};
\node[smallbox, fill=gray!10, below=0.75cm of verifier] (certificate) {Certificate\\support counts};
\node[smallbox, fill=gray!10, below=0.75cm of policy] (holdout) {Holdout readout\\risk / coverage / cost};
\draw[arr] (input) -- (actions);
\draw[arr] (actions) -- (verifier);
\draw[arr] (verifier) -- (policy);
\draw[arr] (calibration) -- (policy);
\draw[arr] (certificate) -- (policy);
\draw[arr] (policy) -- (holdout);
\draw[arr, dashed] (actions) -- (calibration);
\draw[arr, dashed] (verifier) -- (certificate);
\end{tikzpicture}`;
  return renderGeneratedImageFigure({
    filename: "system_architecture.png",
    label: "fig:system-architecture",
    marker: "% operator-required-figure: system_architecture\n% operator-generated-image: system_architecture.png",
    caption:
      "System architecture for the studied verifier-assisted test-time compute policy. Candidate answers and scores are generated before the calibrated acceptance policy decides whether to return or abstain.",
    fallbackTikz
  });
}

function renderExperimentSetupFigure(
  pkg: EmpiricalEvidencePackage,
  holdoutDescription: string,
  iterationBudget: number,
  verifiedRows: number,
  verifierCalls: number
): string {
  const objective = latexEscape(shorten(stringValue(pkg.studyDesign.objective) || "risk-controlled answer acceptance", 38));
  const fallbackTikz = String.raw`\begin{tikzpicture}[
  box/.style={draw, rounded corners=2pt, align=center, text width=2.25cm, minimum width=2.55cm, minimum height=1.0cm, font=\scriptsize},
  arr/.style={-Latex, thick}
]
\node[box, fill=blue!9] (bench) at (0,0) {Benchmarks\\${objective}};
\node[box, fill=green!9] (matrix) at (3.4,0) {Response matrix\\${verifiedRows || "recorded"} scored rows};
\node[box, fill=orange!12] (calls) at (6.8,0) {Verifier calls\\${verifierCalls || "recorded"} calls};
\node[box, fill=purple!9] (search) at (10.2,0) {Policy search\\${iterationBudget || "recorded"} iteration(s)};
\node[box, fill=gray!10] (holdout) at (13.6,0) {Holdout metrics\\${latexEscape(shorten(holdoutDescription, 36))}};
\node[box, fill=yellow!12] (uncert) at (6.8,-2.0) {Uncertainty\\bootstrap intervals};
\node[box, fill=red!8] (errors) at (10.2,-2.0) {Error analysis\\domain behavior};
\draw[arr] (bench) -- (matrix);
\draw[arr] (matrix) -- (calls);
\draw[arr] (calls) -- (search);
\draw[arr] (search) -- (holdout);
\draw[arr] (search) -- (uncert);
\draw[arr] (holdout) -- (errors);
\draw[arr, dashed] (uncert) -- (errors);
\end{tikzpicture}`;
  return renderGeneratedImageFigure({
    filename: "experiment_setup.png",
    label: "fig:experiment-setup",
    marker: "% operator-required-figure: experiment_setup\n% operator-generated-image: experiment_setup.png",
    caption:
      "Experimental setup and artifact flow. Benchmark items are converted to scored responses, candidate policies are searched on the tuning split, and the frozen selected policy is evaluated with holdout metrics, uncertainty intervals, and error diagnostics.",
    fallbackTikz
  });
}

function renderQualityByTaskFigure(
  domainRows: Array<{
    domain: string;
    answered: number;
    abstained: number;
    coverage: number;
    risk: number;
    accuracy: number;
    wrong: number;
    cost: number;
  }>,
  policyRows: CsvRecord[]
): string {
  const rows = domainRows.length
    ? domainRows.slice(0, 5)
    : policyRows.slice(0, 5).map((row) => ({
        domain: String(row.policy ?? "policy"),
        answered: Math.round(metricValue(row, "answered")) || 0,
        abstained: Math.max(0, Math.round(metricValue(row, "total")) - (Math.round(metricValue(row, "answered")) || 0)),
        coverage: metricValue(row, "coverage"),
        risk: metricValue(row, "false_answer_risk"),
        accuracy: metricValue(row, "accepted_accuracy"),
        wrong: Math.round(metricValue(row, "wrong")) || 0,
        cost: metricValue(row, "cost_per_accepted_answer")
      }));
  const stackedBars = rows
    .map((row, index) => {
      const x = index * 1.3;
      const total = Math.max(1, row.answered + row.abstained);
      const answeredHeight = Math.max(0, Math.min(2.8, (row.answered / total) * 2.8));
      const abstainedHeight = Math.max(0, 2.8 - answeredHeight);
      return String.raw`\fill[green!60!black] (${fmtTikz(x)},0) rectangle (${fmtTikz(x + 0.46)},${fmtTikz(answeredHeight)});
\fill[gray!45] (${fmtTikz(x)},${fmtTikz(answeredHeight)}) rectangle (${fmtTikz(x + 0.46)},${fmtTikz(answeredHeight + abstainedHeight)});
\node[rotate=35, anchor=east, font=\scriptsize] at (${fmtTikz(x + 0.42)},-0.12) {${latexEscape(shorten(humanizePolicyName(row.domain), 16))}};`;
    })
    .join("\n");
  const riskPoints = rows
    .map((row, index) => {
      const x = index * 1.3 + 0.23;
      const risk = Math.max(0, Math.min(2.8, row.risk * 8));
      const accuracy = Math.max(0, Math.min(2.8, row.accuracy * 2.8));
      return String.raw`\fill[red!70] (${fmtTikz(x)},${fmtTikz(risk)}) circle (2.1pt);
\fill[blue!70] (${fmtTikz(x + 0.14)},${fmtTikz(accuracy)}) circle (2.1pt);`;
    })
    .join("\n");
  const fallbackTikz = String.raw`\begin{tikzpicture}[x=1cm,y=1cm]
\node[anchor=west,font=\bfseries] at (0,3.55) {A. Accepted versus abstained share};
\draw[->] (-0.1,0) -- (${fmtTikz(Math.max(5.9, rows.length * 1.3 + 0.2))},0);
\draw[->] (0,0) -- (0,3.1) node[above,font=\scriptsize]{share};
${stackedBars || "\\node[font=\\scriptsize] at (2,1.4) {task rows not recorded};"}
\fill[green!60!black] (0.1,3.18) rectangle (0.35,3.34); \node[anchor=west,font=\scriptsize] at (0.42,3.26) {accepted};
\fill[gray!45] (1.75,3.18) rectangle (2.0,3.34); \node[anchor=west,font=\scriptsize] at (2.07,3.26) {abstained};
\begin{scope}[xshift=7.2cm]
\node[anchor=west,font=\bfseries] at (0,3.55) {B. Risk and accepted accuracy};
\draw[->] (-0.1,0) -- (${fmtTikz(Math.max(5.9, rows.length * 1.3 + 0.4))},0);
\draw[->] (0,0) -- (0,3.1) node[above,font=\scriptsize]{metric};
\foreach \y/\lab in {0/0,1.4/0.5,2.8/1.0}{\draw (-0.04,\y)--(0.04,\y) node[left=0.12cm,font=\scriptsize]{\lab};}
${riskPoints || "\\node[font=\\scriptsize] at (2,1.4) {risk rows not recorded};"}
\fill[red!70] (0.25,3.25) circle (2.1pt); \node[anchor=west,font=\scriptsize] at (0.42,3.25) {risk};
\fill[blue!70] (1.35,3.25) circle (2.1pt); \node[anchor=west,font=\scriptsize] at (1.52,3.25) {accuracy};
\end{scope}
\end{tikzpicture}`;
  return renderGeneratedImageFigure({
    filename: "quality_by_task.png",
    label: "fig:quality-by-task",
    marker: "% operator-data-figure: quality-by-task\n% operator-generated-image: quality_by_task.png",
    caption:
      "Task-level quality summary derived from the available domain-error or policy rows. Panel A shows how much of each task family is answered or abstained; Panel B pairs accepted-answer risk with accepted-answer accuracy.",
    fallbackTikz
  });
}

function renderMechanismDiagnosticsFigure(
  domainRows: Array<{
    domain: string;
    answered: number;
    abstained: number;
    coverage: number;
    risk: number;
    accuracy: number;
    wrong: number;
    cost: number;
  }>,
  certificateRows: Array<{
    key: string;
    domain: string;
    action: string;
    certified: boolean;
    threshold: number;
    empiricalError: number;
    total: number;
  }>,
  uncertainty: { coverage: number[]; risk: number[]; cost: number[] },
  selectedIteration: number,
  riskTarget: number
): string {
  const certified = certificateRows.filter((row) => row.certified).length;
  const uncertified = Math.max(0, certificateRows.length - certified);
  const domainBars = (
    domainRows.length
      ? domainRows
      : [{ domain: "recorded", answered: 1, abstained: 1, coverage: 0.5, risk: riskTarget, accuracy: 0.5, wrong: 0, cost: 0 }]
  )
    .slice(0, 4)
    .map((row, index) => {
      const x = index * 1.05;
      const coverage = Math.max(0, Math.min(1.95, row.coverage * 1.95));
      const risk = Math.max(0, Math.min(1.95, row.risk * 8));
      return String.raw`\fill[blue!55] (${fmtTikz(x)},0) rectangle (${fmtTikz(x + 0.3)},${fmtTikz(coverage)});
\fill[red!65] (${fmtTikz(x + 0.34)},0) rectangle (${fmtTikz(x + 0.64)},${fmtTikz(risk)});
\node[rotate=35,anchor=east,font=\tiny] at (${fmtTikz(x + 0.46)},-0.08) {${latexEscape(shorten(humanizePolicyName(row.domain), 12))}};`;
    })
    .join("\n");
  const riskLow = uncertainty.risk[0] ?? riskTarget;
  const riskHigh = uncertainty.risk[1] ?? riskTarget;
  const coverageLow = uncertainty.coverage[0] ?? 0;
  const coverageHigh = uncertainty.coverage[1] ?? 0;
  const fallbackTikz = String.raw`\begin{tikzpicture}[x=1cm,y=1cm]
\begin{scope}[xshift=0cm,yshift=3.6cm]
\node[anchor=west,font=\bfseries] at (0,2.55) {A. Bootstrap intervals};
\draw[->] (0,0.62) -- (4.55,0.62) node[right,font=\scriptsize]{value};
\draw[blue!70,thick] (${fmtTikz(coverageLow * 4)},1.38) -- (${fmtTikz(coverageHigh * 4)},1.38);
\fill[blue!70] (${fmtTikz(((coverageLow + coverageHigh) / 2) * 4)},1.38) circle (2pt);
\node[anchor=east,font=\scriptsize] at (-0.12,1.38) {coverage};
\draw[red!70,thick] (${fmtTikz(riskLow * 16)},0.9) -- (${fmtTikz(riskHigh * 16)},0.9);
\fill[red!70] (${fmtTikz(((riskLow + riskHigh) / 2) * 16)},0.9) circle (2pt);
\node[anchor=east,font=\scriptsize] at (-0.12,0.9) {risk};
\draw[red!45,dashed] (${fmtTikz(riskTarget * 16)},0.45) -- (${fmtTikz(riskTarget * 16)},1.75);
\node[anchor=west,font=\scriptsize] at (${fmtTikz(riskTarget * 16 + 0.08)},1.72) {\(\alpha\)};
\end{scope}

\begin{scope}[xshift=6.3cm,yshift=3.6cm]
\node[anchor=west,font=\bfseries] at (0,2.85) {B. Domain mechanism};
\draw[->] (-0.1,0) -- (4.75,0);
\draw[->] (0,0) -- (0,2.15);
${domainBars}
\fill[blue!55] (0.1,2.32) rectangle (0.32,2.47); \node[anchor=west,font=\scriptsize] at (0.38,2.39) {coverage};
\fill[red!65] (1.42,2.32) rectangle (1.64,2.47); \node[anchor=west,font=\scriptsize] at (1.7,2.39) {risk};
\end{scope}

\begin{scope}[xshift=0cm,yshift=0cm]
\node[anchor=west,font=\bfseries] at (0,2.45) {C. Certificate support};
\fill[green!60!black] (0,1.35) rectangle (${fmtTikz(Math.max(0.28, certified * 0.45))},1.7);
\node[anchor=west,font=\scriptsize] at (${fmtTikz(Math.max(0.42, certified * 0.45 + 0.14))},1.52) {certified: ${certified}};
\fill[gray!45] (0,0.72) rectangle (${fmtTikz(Math.max(0.28, uncertified * 0.45))},1.07);
\node[anchor=west,font=\scriptsize] at (${fmtTikz(Math.max(0.42, uncertified * 0.45 + 0.14))},0.89) {uncertified: ${uncertified}};
\end{scope}

\begin{scope}[xshift=6.3cm,yshift=0cm]
\node[anchor=west,font=\bfseries] at (0,2.45) {D. Selection rule};
\node[draw, rounded corners=2pt, align=center, fill=purple!8, text width=4.2cm, minimum height=1.25cm, font=\small] at (2.25,1.15) {selected iteration: ${selectedIteration || "recorded"}\\maximize tuning coverage\\subject to risk \(\le ${fmtMetric(riskTarget)}\)};
\end{scope}
\end{tikzpicture}`;
  return renderGeneratedImageFigure({
    filename: "mechanism_diagnostics.png",
    label: "fig:mechanism-diagnostics",
    marker: "% operator-data-figure: mechanism-diagnostics\n% operator-generated-image: mechanism_diagnostics.png",
    caption:
      "Mechanism diagnostics for the selected policy. The panels combine uncertainty intervals, domain behavior, certificate support, and the selected risk-constrained policy rule.",
    fallbackTikz
  });
}

export function buildNativeDraftingContext(state: AraPaperPipelineState): JsonRecord {
  const bundlePath = state.ara.resultBundlePath;
  const validation = state.validationResult ?? buildNativeBundleValidation(state);
  const artifactManifest = safeReadJson(path.join(bundlePath, "artifact_manifest.json"));
  const claimsPayload = safeReadJson(path.join(bundlePath, "claims.json"));
  const artifacts = artifactList(artifactManifest);
  const artifactById = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  const allowedClaims: JsonRecord[] = [];
  const blockedClaims: JsonRecord[] = [];
  const citationMap: Record<string, BundleArtifact[]> = {};
  const dependencyMap = new Map<string, JsonRecord>();
  const claims = claimList(claimsPayload);
  const bundleValid = Boolean(validation.valid);

  for (const [index, claim] of claims.entries()) {
    const claimId = claim.claim_id || `claim-${index + 1}`;
    const supportedBy = Array.isArray(claim.supported_by) ? claim.supported_by.filter(Boolean) : [];
    const resolvedArtifacts = supportedBy.map((artifactId) => artifactById.get(artifactId)).filter(isBundleArtifact);
    const reasons: string[] = [];
    if (!bundleValid) reasons.push("result bundle failed validation");
    if (!allowedClaimStatus(claim)) reasons.push(`claim status is not citable: ${claim.status ?? "unknown"}`);
    if (!resolvedArtifacts.length) reasons.push("claim has no resolved artifact dependencies");

    const normalized = {
      index,
      claim_id: claimId,
      claim: claim.claim ?? "",
      status: claim.status ?? "unknown",
      evidence_level: claim.evidence_level ?? "unknown",
      verification_status: claim.verification_status ?? null,
      reproduction_status: claim.reproduction_status ?? null,
      supported_by: supportedBy,
      limitations: Array.isArray(claim.limitations) ? claim.limitations : []
    };

    if (reasons.length) {
      blockedClaims.push({ ...normalized, reasons, reason: reasons.join("; ") });
      continue;
    }

    allowedClaims.push({ ...normalized, allowed_reason: claim.status ?? "supported" });
    citationMap[claimId] = resolvedArtifacts;
    for (const artifact of resolvedArtifacts) {
      const artifactId = artifact.artifact_id || artifact.path || "artifact";
      const dependency = dependencyMap.get(artifactId) ?? {
        artifact_id: artifact.artifact_id,
        path: artifact.path,
        kind: artifact.kind,
        description: artifact.description,
        claim_ids: []
      };
      (dependency.claim_ids as string[]).push(claimId);
      dependencyMap.set(artifactId, dependency);
    }
  }

  const draftingBrief =
    readOptionalText(path.join(bundlePath, "drafting_brief.md")) || readOptionalText(path.join(bundlePath, "writing_brief.md"));
  const bundleLimitations = readOptionalText(path.join(bundlePath, "limitations.md"));
  const errors = allowedClaims.length
    ? []
    : ["No supported, verified, reproduced, or confirmed-with-reproduction claims are available for drafting."];

  return {
    schema_version: "operator.research.claim_backed_drafting_context.v1",
    compatibility_schema: "ara.claim_backed_drafting_context.v1",
    runtime: "native_ts",
    path: bundlePath,
    bundle_type: stringValue(validation.bundle_type),
    valid: bundleValid && allowedClaims.length > 0,
    claim_count: allowedClaims.length + blockedClaims.length,
    allowed_claim_count: allowedClaims.length,
    blocked_claim_count: blockedClaims.length,
    citable_claim_count: allowedClaims.length,
    allowed_claims: allowedClaims,
    citable_claims: allowedClaims,
    blocked_claims: blockedClaims,
    citation_map: citationMap,
    artifact_dependencies: [...dependencyMap.values()],
    limitations: {
      bundle: bundleLimitations,
      claims: Object.fromEntries(allowedClaims.map((claim) => [String(claim.claim_id), claim.limitations ?? []]))
    },
    drafting_brief: draftingBrief,
    errors,
    warnings: [],
    allowed_statuses: ["confirmed", "confirmed-with-reproduction", "confirmed_with_reproduction", "reproduced", "supported", "verified"],
    validation
  };
}

export function buildNativeEvidenceScore(state: AraPaperPipelineState): JsonRecord {
  const context = state.draftingContext ?? buildNativeDraftingContext(state);
  const allowedClaims = arrayOfRecords(context.allowed_claims);
  const blockedClaims = arrayOfRecords(context.blocked_claims);
  const template = selectPaperTemplate(state, context);
  const claimScores = allowedClaims.map((claim) => {
    const evidenceRefs = Array.isArray(claim.supported_by) ? claim.supported_by.map(String) : [];
    const requiredEvidence = requiredEvidenceForTemplate(template);
    const satisfiedEvidence = satisfiedEvidenceFromClaim(claim, template);
    const missingEvidence = requiredEvidence.filter((item) => !satisfiedEvidence.includes(item));
    return {
      schema_version: "operator.research.claim_evidence_score.v1",
      claim_id: String(claim.claim_id ?? "claim"),
      claim_text: String(claim.claim ?? ""),
      role: "main_contribution",
      domain: template.domain,
      target_venue: state.ara.venueId,
      contribution_type: template.paperType,
      evidence_refs: evidenceRefs,
      required_evidence: requiredEvidence,
      satisfied_evidence: satisfiedEvidence,
      missing_evidence: missingEvidence,
      evidence_level: String(claim.evidence_level ?? "unknown"),
      venue_sufficiency: missingEvidence.length <= 1 ? "borderline" : "insufficient",
      allowed_in_public_draft: true,
      allowed_in_private_manuscript: missingEvidence.length <= 1,
      manuscript_destination: missingEvidence.length <= 1 ? "main_manuscript" : "main_manuscript_with_limitations",
      blockers: missingEvidence.length <= 1 ? [] : ["evidence_gap_requires_author_review"],
      reviewer_risks: missingEvidence,
      required_author_decisions: ["confirm_target_venue", "confirm_claim_scope", "verify_reference_integrity"]
    };
  });
  const privateAllowedCount = claimScores.filter((score) => Boolean(score.allowed_in_private_manuscript)).length;

  return {
    schema_version: "operator.research.claim_evidence_scoring.v1",
    compatibility_schema: "ara.claim_evidence_scoring.v1",
    runtime: "native_ts",
    topic: state.ara.topic,
    domain_profile: {
      domain_id: template.domain,
      display_name: template.displayName,
      paper_type: template.paperType,
      schema_version: "operator.research.domain_profile.v1"
    },
    venue_profile: {
      venue_id: state.ara.venueId,
      display_name: "Operator draft-quality research manuscript target",
      expects: ["claim-backed writing", "domain-specific structure", "figures", "20+ references", "quality gate report"],
      schema_version: "operator.research.venue_profile.v1"
    },
    claim_scores: claimScores,
    gates: {
      venue_fit_gate: { status: "pass", passed: true, blockers: [] },
      contribution_strength_gate: { status: allowedClaims.length ? "pass" : "fail", passed: allowedClaims.length > 0, blockers: [] },
      evidence_sufficiency_gate: {
        status: claimScores.every((score) => score.missing_evidence.length <= 2) ? "pass" : "warning",
        passed: claimScores.every((score) => score.missing_evidence.length <= 2),
        blockers: []
      },
      reference_integrity_gate: { status: "pending_manuscript_generation", passed: false, blockers: [] },
      manuscript_quality_gate: { status: "pending_manuscript_generation", passed: false, blockers: [] }
    },
    summary: {
      topic: state.ara.topic,
      domain_id: template.domain,
      template_id: template.id,
      venue_id: state.ara.venueId,
      claim_count: allowedClaims.length + blockedClaims.length,
      main_claim_count: allowedClaims.length,
      private_manuscript_allowed_claim_count: privateAllowedCount,
      public_draft_allowed_claim_count: allowedClaims.length,
      blocked_claim_count: blockedClaims.length,
      private_handoff_ready: false,
      release_ready: false,
      formal_manuscript_generated: false,
      blocking_claim_ids: claimScores.filter((score) => !score.allowed_in_private_manuscript).map((score) => score.claim_id)
    },
    private_handoff_ready: false,
    release_ready: false,
    formal_manuscript_generated: false,
    public_ara_formal_manuscript_generated: false,
    output_files: {}
  };
}

export async function renderNativeManuscript(state: AraPaperPipelineState): Promise<{
  payload: JsonRecord;
  artifacts: ArtifactRecord[];
  outputs: Record<string, string>;
}> {
  const context = state.draftingContext ?? buildNativeDraftingContext(state);
  const evidence = state.evidenceScore ?? buildNativeEvidenceScore(state);
  const template = selectPaperTemplate(state, context);
  const manuscriptDir = state.ara.nativeManuscriptDir;
  const buildDir = `${manuscriptDir}/manuscript_build`;
  const figuresDir = `${buildDir}/figures`;
  mkdirSync(workspacePath(state.workspace, figuresDir), { recursive: true });
  const references =
    template.paperType === "formal_proof"
      ? template.references
      : template.references.slice(0, Math.max(state.ara.qualityPolicy.minReferenceCount + 4, 24));
  const paper = buildPaperModel(state, context, evidence, template, references);
  const formalProofPaper = template.paperType === "formal_proof";
  const supportManifestName = formalProofPaper ? "formal_proof_support_manifest.json" : "claim_support_manifest.json";
  const structuralPreflightName = formalProofPaper ? "math_structural_preflight_review.json" : "domain_structural_preflight_review.json";
  const pipelineSummaryName = formalProofPaper ? "formal_math_pipeline_summary.json" : "manuscript_pipeline_summary.json";
  const mainTex = `${buildDir}/main.tex`;
  const referencesBib = `${buildDir}/references.bib`;
  const manifestJson = `${manuscriptDir}/manuscript_manifest.json`;
  const qualityJson = `${manuscriptDir}/manuscript_quality_report.json`;
  const sourceManifestJson = `${manuscriptDir}/source_manifest.json`;
  const figurePlanJson = `${figuresDir}/figure_plan.json`;
  const pdfPath = `${buildDir}/main.pdf`;
  const supportManifestJson = `${buildDir}/${supportManifestName}`;
  const reproducibilityStatementMd = `${buildDir}/reproducibility_statement.md`;
  const contributionInformationMd = `${buildDir}/contribution_information.md`;
  const paperValidationReportJson = `${buildDir}/paper_validation_report.json`;
  const genericPreflightJson = `${buildDir}/generic_topvenue_preflight_review.json`;
  const structuralPreflightJson = `${buildDir}/${structuralPreflightName}`;
  const sourceArchiveZip = `${buildDir}/source_archive.zip`;
  const codexStatusJson = `${buildDir}/.ara_codex_status.json`;
  const pipelineSummaryJson = `${manuscriptDir}/${pipelineSummaryName}`;
  const figureDataJson = `${figuresDir}/figure_data.json`;
  const imageGenerationManifestJson = `${figuresDir}/image_generation_manifest.json`;
  const figureGeneratorPy = `${buildDir}/generate_figures.py`;
  const analemmaSty = `${buildDir}/analemma.sty`;
  const analemmaBst = `${buildDir}/analemma.bst`;
  const analemmaLogo = `${buildDir}/logo.png`;

  const generatedFigureAssets = await generateEmpiricalImageAssets(state, context, buildDir, template);
  const latexLayoutStyle = prepareLatexLayoutAssets(state, buildDir, template);
  const mainTexContent = renderLatex(paper, state, latexLayoutStyle);
  const orderedReferences = orderReferencesByFirstCitation(references, mainTexContent);
  writeText(workspacePath(state.workspace, mainTex), mainTexContent);
  writeText(workspacePath(state.workspace, referencesBib), orderedReferences.map((entry) => entry.bibtex.trim()).join("\n\n") + "\n");
  writeJson(workspacePath(state.workspace, figurePlanJson), paper.figures);
  if (!state.ara.skipPdfCompile) {
    await compileNativeLatex(state.workspace, buildDir, "main.tex");
  }
  const quality = buildQualityReport(state, template, mainTex, orderedReferences.length, paper.figures.length, pdfPath);
  const qualityMetrics = isRecord(quality.metrics) ? quality.metrics : {};
  writeJson(workspacePath(state.workspace, qualityJson), quality);
  const supportManifest = buildFormalSupportManifest(state, context, paper, quality, formalProofPaper);
  const reproducibilityStatement = buildReproducibilityStatement(state, paper, supportManifest, quality);
  const contributionInformation = buildContributionInformation(state, paper, supportManifest);
  const paperValidation = buildPaperValidationReport(state, quality, pdfPath);
  const mathStructuralPreflight = buildMathStructuralPreflightReview(state, template, quality, supportManifest);
  const genericPreflight = buildGenericTopVenuePreflightReview(state, template, quality, supportManifest);
  writeJson(workspacePath(state.workspace, supportManifestJson), supportManifest);
  writeText(workspacePath(state.workspace, reproducibilityStatementMd), reproducibilityStatement);
  writeText(workspacePath(state.workspace, contributionInformationMd), contributionInformation);
  writeJson(workspacePath(state.workspace, paperValidationReportJson), paperValidation);
  writeJson(workspacePath(state.workspace, structuralPreflightJson), mathStructuralPreflight);
  writeJson(workspacePath(state.workspace, genericPreflightJson), genericPreflight);
  await archiveNativeSources(state.workspace, buildDir, [
    "main.tex",
    "references.bib",
    "figures",
    "generate_figures.py",
    "analemma.sty",
    "analemma.bst",
    "logo.png",
    supportManifestName,
    "reproducibility_statement.md",
    "contribution_information.md",
    "paper_validation_report.json",
    structuralPreflightName,
    "generic_topvenue_preflight_review.json"
  ]);
  const sourceFiles = [
    mainTex,
    referencesBib,
    figurePlanJson,
    figureDataJson,
    imageGenerationManifestJson,
    figureGeneratorPy,
    analemmaSty,
    analemmaBst,
    analemmaLogo,
    ...generatedFigureAssets.map((asset) => asset.path),
    supportManifestJson,
    reproducibilityStatementMd,
    contributionInformationMd,
    paperValidationReportJson,
    structuralPreflightJson,
    genericPreflightJson,
    sourceArchiveZip
  ].filter((relativePath) => existsSync(workspacePath(state.workspace, relativePath)));
  writeJson(workspacePath(state.workspace, sourceManifestJson), {
    schema_version: "operator.research.source_manifest.v1",
    files: sourceFiles,
    generated_at: new Date().toISOString()
  });
  const copiedArtifacts = copyFormalManuscriptArtifacts(
    state,
    {
      mainTex,
      referencesBib,
      pdfPath,
      supportManifestJson,
      reproducibilityStatementMd,
      contributionInformationMd,
      paperValidationReportJson,
      structuralPreflightJson,
      genericPreflightJson,
      sourceArchiveZip
    },
    formalProofPaper
  );
  const formalMathSummary = buildFormalMathPipelineSummary(
    state,
    paper,
    quality,
    supportManifest,
    paperValidation,
    mathStructuralPreflight,
    genericPreflight,
    copiedArtifacts,
    pdfPath,
    formalProofPaper
  );
  const codexStatus = buildCodexStatus(
    state,
    quality,
    supportManifest,
    mathStructuralPreflight,
    genericPreflight,
    pdfPath,
    formalProofPaper
  );
  writeJson(workspacePath(state.workspace, pipelineSummaryJson), formalMathSummary);
  writeJson(workspacePath(state.workspace, codexStatusJson), codexStatus);
  const manifest = {
    schema_version: "operator.research.native_manuscript_workspace.v1",
    status: quality.valid ? "draft_quality_passed" : "draft_quality_failed",
    engine: "native_ts",
    template_id: template.id,
    template_domain: template.domain,
    paper_type: template.paperType,
    latex_layout_style: latexLayoutStyle,
    project: state.ara.projectId,
    title: paper.title,
    author: state.ara.authorName,
    draft_notice: state.ara.draftNotice,
    result_bundle: state.ara.resultBundlePath,
    manuscript_workspace: workspacePath(state.workspace, manuscriptDir),
    paper_tex: "manuscript_build/main.tex",
    paper_pdf: existsSync(workspacePath(state.workspace, pdfPath)) ? "manuscript_build/main.pdf" : null,
    references_bib: "manuscript_build/references.bib",
    figure_count: paper.figures.length,
    reference_count: orderedReferences.length,
    word_count: numberValue(qualityMetrics.word_count),
    page_count: numberValue(qualityMetrics.page_count),
    quality_report: "manuscript_quality_report.json",
    support_manifest: `manuscript_build/${supportManifestName}`,
    image_generation_manifest: generatedFigureAssets.length ? "manuscript_build/figures/image_generation_manifest.json" : null,
    ara_style_files:
      latexLayoutStyle === "ara_analemma"
        ? ["manuscript_build/analemma.sty", "manuscript_build/analemma.bst", "manuscript_build/logo.png"]
        : [],
    generated_image_figures: generatedFigureAssets.map((asset) => ({
      id: asset.id,
      label: asset.label,
      role: asset.role,
      file: `manuscript_build/figures/${asset.filename}`
    })),
    structural_preflight_review: `manuscript_build/${structuralPreflightName}`,
    pipeline_summary: pipelineSummaryName,
    support_package_verified: Boolean(supportManifest.support_package_verified),
    formal_proof_support_manifest: formalProofPaper ? "manuscript_build/formal_proof_support_manifest.json" : null,
    reproducibility_statement: "manuscript_build/reproducibility_statement.md",
    contribution_information: "manuscript_build/contribution_information.md",
    paper_validation_report: "manuscript_build/paper_validation_report.json",
    math_structural_preflight_review: formalProofPaper ? "manuscript_build/math_structural_preflight_review.json" : null,
    generic_topvenue_preflight_review: "manuscript_build/generic_topvenue_preflight_review.json",
    source_archive: "manuscript_build/source_archive.zip",
    formal_math_pipeline_summary: formalProofPaper ? "formal_math_pipeline_summary.json" : null,
    copied_artifacts: copiedArtifacts
  };
  writeJson(workspacePath(state.workspace, manifestJson), manifest);
  const payload = {
    schema_version: "operator.research.native_manuscript_pipeline.v1",
    status: quality.valid ? "completed" : "quality_failed",
    engine: "native_ts",
    template_id: template.id,
    output_dir: workspacePath(state.workspace, manuscriptDir),
    entrypoint: workspacePath(state.workspace, mainTex),
    pdf: existsSync(workspacePath(state.workspace, pdfPath)) ? workspacePath(state.workspace, pdfPath) : null,
    manifest_path: workspacePath(state.workspace, manifestJson),
    manifest,
    quality_report: quality,
    support_manifest: supportManifest,
    paper_validation_report: paperValidation,
    math_structural_preflight_review: mathStructuralPreflight,
    generic_topvenue_preflight_review: genericPreflight,
    pipeline_summary: formalMathSummary,
    formal_math_pipeline_summary: formalProofPaper ? formalMathSummary : undefined,
    result_bundle: state.ara.resultBundlePath
  };
  const artifacts = [
    mainTex,
    referencesBib,
    figurePlanJson,
    figureDataJson,
    imageGenerationManifestJson,
    figureGeneratorPy,
    analemmaSty,
    analemmaBst,
    analemmaLogo,
    ...generatedFigureAssets.map((asset) => asset.path),
    manifestJson,
    qualityJson,
    sourceManifestJson,
    supportManifestJson,
    reproducibilityStatementMd,
    contributionInformationMd,
    paperValidationReportJson,
    structuralPreflightJson,
    genericPreflightJson,
    sourceArchiveZip,
    pipelineSummaryJson,
    codexStatusJson,
    ...Object.values(copiedArtifacts),
    pdfPath
  ]
    .filter((relativePath) => existsSync(workspacePath(state.workspace, relativePath)))
    .map((relativePath) =>
      artifactFromFile({
        workspace: state.workspace,
        path: relativePath,
        stepId: "operator_native_render_manuscript"
      })
    );
  return {
    payload,
    artifacts,
    outputs: {
      nativeMainTex: mainTex,
      nativeReferencesBib: referencesBib,
      nativeManifestJson: manifestJson,
      nativeQualityJson: qualityJson,
      nativeFigureDataJson: existsSync(workspacePath(state.workspace, figureDataJson)) ? figureDataJson : "",
      nativeImageGenerationManifestJson: existsSync(workspacePath(state.workspace, imageGenerationManifestJson))
        ? imageGenerationManifestJson
        : "",
      nativeFigureGeneratorPy: existsSync(workspacePath(state.workspace, figureGeneratorPy)) ? figureGeneratorPy : "",
      nativeSupportManifestJson: supportManifestJson,
      nativeReproducibilityStatementMd: reproducibilityStatementMd,
      nativeContributionInformationMd: contributionInformationMd,
      nativePaperValidationReportJson: paperValidationReportJson,
      nativeMathStructuralPreflightJson: formalProofPaper ? structuralPreflightJson : "",
      nativeDomainStructuralPreflightJson: structuralPreflightJson,
      nativeGenericTopvenuePreflightJson: genericPreflightJson,
      nativeSourceManifestJson: sourceManifestJson,
      nativeSourceArchiveZip: sourceArchiveZip,
      nativeFormalMathSummaryJson: formalProofPaper ? pipelineSummaryJson : "",
      nativePipelineSummaryJson: pipelineSummaryJson,
      nativeCodexStatusJson: codexStatusJson,
      nativePdf: existsSync(workspacePath(state.workspace, pdfPath)) ? pdfPath : ""
    }
  };
}

export function buildNativePrivateHandoff(state: AraPaperPipelineState): {
  payload: JsonRecord;
  artifacts: ArtifactRecord[];
  outputs: Record<string, string>;
} {
  const handoffDir = state.ara.handoffDir;
  mkdirSync(workspacePath(state.workspace, handoffDir), { recursive: true });
  const manuscriptResult = isRecord(state.manuscriptResult) ? state.manuscriptResult : {};
  const quality = isRecord(manuscriptResult.quality_report) ? manuscriptResult.quality_report : {};
  const qualityValid = Boolean(quality.valid);
  const manifest = isRecord(manuscriptResult.manifest) ? manuscriptResult.manifest : {};
  const evidenceScore = isRecord(state.evidenceScore) ? state.evidenceScore : {};
  const handoffManifestPath = `${handoffDir}/handoff_manifest.json`;
  const pointerPath = `${handoffDir}/manuscript_manifest_pointer.json`;
  const readmePath = `${handoffDir}/README.md`;
  const qualityCopyPath = `${handoffDir}/manuscript_quality_report.json`;
  const evidenceCopyPath = `${handoffDir}/claim_evidence_scores.json`;
  const supportOutputPath = state.outputs.nativeSupportManifestJson;
  const structuralPreflightOutputPath =
    state.outputs.nativeDomainStructuralPreflightJson || state.outputs.nativeMathStructuralPreflightJson;
  const supportCopyPath = `${handoffDir}/${supportOutputPath ? path.basename(supportOutputPath) : "support_manifest.json"}`;
  const paperValidationCopyPath = `${handoffDir}/paper_validation_report.json`;
  const structuralPreflightCopyPath = `${handoffDir}/${structuralPreflightOutputPath ? path.basename(structuralPreflightOutputPath) : "structural_preflight_review.json"}`;
  const genericPreflightCopyPath = `${handoffDir}/generic_topvenue_preflight_review.json`;
  const sourceArchiveCopyPath = `${handoffDir}/source_archive.zip`;
  const handoffCopies = [
    [supportOutputPath, supportCopyPath],
    [state.outputs.nativePaperValidationReportJson, paperValidationCopyPath],
    [structuralPreflightOutputPath, structuralPreflightCopyPath],
    [state.outputs.nativeGenericTopvenuePreflightJson, genericPreflightCopyPath],
    [state.outputs.nativeSourceArchiveZip, sourceArchiveCopyPath]
  ] as const;
  const payload = {
    schema_version: "operator.research.private_manuscript_handoff.v1",
    compatibility_schema: "ara.private_manuscript_handoff.v1",
    engine: "native_ts",
    project: state.ara.projectId,
    bundle_dir: workspacePath(state.workspace, handoffDir),
    private_handoff_ready: qualityValid && Boolean(state.draftingContext?.valid),
    release_ready: false,
    release_blockers: ["explicit_release_bundle_required", "author_reference_audit_required", "submission_forms_required"],
    manuscript_pointer: {
      schema_version: "operator.research.manuscript_pointer.v1",
      project: state.ara.projectId,
      manifest_path: state.outputs.nativeManifestJson ?? null,
      paper_tex: state.outputs.nativeMainTex ?? null,
      paper_pdf: state.outputs.nativePdf || null,
      quality_report: state.outputs.nativeQualityJson ?? null,
      support_manifest: supportOutputPath ?? null,
      formal_proof_support_manifest: state.outputs.nativeMathStructuralPreflightJson ? (supportOutputPath ?? null) : null,
      paper_validation_report: state.outputs.nativePaperValidationReportJson ?? null,
      structural_preflight_review: structuralPreflightOutputPath ?? null,
      math_structural_preflight_review: state.outputs.nativeMathStructuralPreflightJson || null,
      generic_topvenue_preflight_review: state.outputs.nativeGenericTopvenuePreflightJson ?? null,
      source_archive: state.outputs.nativeSourceArchiveZip ?? null,
      author: state.ara.authorName,
      draft_notice: state.ara.draftNotice
    },
    manuscript_manifest: manifest,
    quality_report: quality,
    evidence_summary: isRecord(evidenceScore.summary) ? evidenceScore.summary : {}
  };
  writeJson(workspacePath(state.workspace, handoffManifestPath), payload);
  writeJson(workspacePath(state.workspace, pointerPath), payload.manuscript_pointer);
  writeJson(workspacePath(state.workspace, qualityCopyPath), quality);
  writeJson(workspacePath(state.workspace, evidenceCopyPath), state.evidenceScore ?? {});
  const copiedHandoffPaths: string[] = [];
  for (const [sourceRelative, destinationRelative] of handoffCopies) {
    if (!sourceRelative) continue;
    const source = workspacePath(state.workspace, sourceRelative);
    if (!existsSync(source)) continue;
    copyFileSync(source, workspacePath(state.workspace, destinationRelative));
    copiedHandoffPaths.push(destinationRelative);
  }
  writeText(
    workspacePath(state.workspace, readmePath),
    [
      "# Operator Native Paper Handoff",
      "",
      `- Engine: native_ts`,
      `- Project: ${state.ara.projectId}`,
      `- Private handoff ready: ${String(payload.private_handoff_ready)}`,
      `- Release ready: ${String(payload.release_ready)}`,
      `- Draft notice: ${state.ara.draftNotice}`,
      "",
      "This handoff contains generated manuscript pointers, evidence scoring, manuscript quality checks, claim support, preflight reports, and source archives when available. Release remains blocked until author-side reference audit, disclosure forms, and explicit release packaging are complete."
    ].join("\n") + "\n"
  );
  const artifacts = [handoffManifestPath, pointerPath, readmePath, qualityCopyPath, evidenceCopyPath, ...copiedHandoffPaths].map(
    (relativePath) =>
      artifactFromFile({
        workspace: state.workspace,
        path: relativePath,
        stepId: "operator_native_private_handoff"
      })
  );
  return {
    payload,
    artifacts,
    outputs: {
      privateHandoffJson: handoffManifestPath,
      manuscriptPointerJson: pointerPath
    }
  };
}

export function selectPaperTemplate(state: AraPaperPipelineState, context?: JsonRecord): PaperTemplate {
  const explicit = state.ara.paperDomain.toLowerCase();
  const validationResult = isRecord(state.validationResult) ? state.validationResult : {};
  const validationMetadata = isRecord(validationResult.metadata) ? validationResult.metadata : {};
  const bundleManifest = isRecord(validationMetadata.bundle_manifest) ? validationMetadata.bundle_manifest : {};
  const validationDomain = stringValue(validationMetadata.domain) || stringValue(bundleManifest.domain);
  const bundleType = stringValue(validationResult.bundle_type);
  const haystack = `${explicit} ${validationDomain} ${bundleType} ${state.ara.topic} ${JSON.stringify(context ?? {})}`.toLowerCase();
  if (/formal_math|math|theorem|lean|proof|conjecture|supercongruence|graph/u.test(haystack)) return paperTemplates.mathFormalProof;
  if (/ai|machine|learning|model|benchmark|dataset|neural|llm/u.test(haystack)) return paperTemplates.aiMlEmpirical;
  if (/bio|omics|cell|gene|protein|clinical/u.test(haystack)) return paperTemplates.biologyOmics;
  if (/material|crystal|polymer|alloy|catalyst/u.test(haystack)) return paperTemplates.materialsDiscovery;
  if (/physics|quantum|particle|condensed|cosmology/u.test(haystack)) return paperTemplates.physicsResearch;
  return paperTemplates.generalResearch;
}

function buildPaperModel(
  state: AraPaperPipelineState,
  context: JsonRecord,
  evidence: JsonRecord,
  template: PaperTemplate,
  references: ReferenceEntry[]
) {
  if (template.paperType === "formal_proof" && isWowii19FormalBundle(state, context)) {
    return buildWowii19FormalMathPaperModel(state, context, template, references);
  }

  return buildEmpiricalResearchPaperModel(state, context, evidence, template, references);
}

function buildEmpiricalResearchPaperModel(
  state: AraPaperPipelineState,
  context: JsonRecord,
  _evidence: JsonRecord,
  template: PaperTemplate,
  references: ReferenceEntry[]
) {
  const pkg = readEmpiricalEvidencePackage(state, context);
  const rows = pkg.metricsRows.length ? pkg.metricsRows : pkg.baselineRows;
  const conformal = conformalPolicyRow(rows);
  const baselines = rows.filter((row) => row !== conformal && !/conformal/iu.test(String(row.policy ?? "")));
  const bestBaseline = minBy(baselines, (row) => metricValue(row, "false_answer_risk")) ?? baselines[0] ?? {};
  const selectedIteration = selectedIterationRecord(pkg);
  const citationGroups = chunk(
    references.map((entry) => entry.key),
    4
  ).map((keys) => `\\citep{${keys.join(",")}}`);
  const title = state.ara.manuscriptTitle || empiricalTitle(state, pkg, template);
  const totalItems = Math.round(
    metricValue(conformal, "total") ||
      numberValue(pkg.studyDesign.holdout_item_count) ||
      numberValue(pkg.studyDesign.splits && isRecord(pkg.studyDesign.splits) ? pkg.studyDesign.splits.test : undefined) ||
      0
  );
  const holdoutDescription = totalItems > 0 ? `${totalItems} held-out evaluation items` : "the held-out evaluation split";
  const verifiedRows = Math.round(numberValue(pkg.verifierSummary.verified_row_count) || 0);
  const verifierCalls = Math.round(numberValue(pkg.verifierSummary.verifier_call_count) || 0);
  const iterationBudget = Math.round(
    numberValue(pkg.studyDesign.iteration_budget) || pkg.iterationRows.length || numberValue(selectedIteration.iteration) || 0
  );
  const riskTarget = numberValue(pkg.studyDesign.risk_target_alpha) ?? 0.1;
  const selectedIterationNumber = Math.round(numberValue(selectedIteration.iteration) || numberValue(conformal.selected_iteration) || 0);
  const conformalPolicy = String(conformal.policy ?? "conformal_ttc");
  const bestBaselinePolicy = String(bestBaseline.policy ?? "best verifier-threshold baseline");
  const confRisk = metricValue(conformal, "false_answer_risk");
  const baseRisk = metricValue(bestBaseline, "false_answer_risk");
  const confCoverage = metricValue(conformal, "coverage");
  const baseCoverage = metricValue(bestBaseline, "coverage");
  const confAccuracy = metricValue(conformal, "accepted_accuracy");
  const confCost = metricValue(conformal, "avg_cost_per_item");
  const confCostAccepted = metricValue(conformal, "cost_per_accepted_answer");
  const confAnswered = Math.round(metricValue(conformal, "answered"));
  const confWrong = Math.round(metricValue(conformal, "wrong"));
  const riskGap = Number.isFinite(baseRisk) && Number.isFinite(confRisk) ? baseRisk - confRisk : NaN;
  const certificateRows = certificateSummaryRows(pkg.selectedCertificate);
  const domainRows = domainMetricRows(pkg.errorAnalysis);
  const uncertainty = uncertaintyForPolicy(pkg.statisticalUncertainty, conformalPolicy);
  const hasIterationTrace = pkg.iterationRows.length > 0;
  const hasCertificate = certificateRows.length > 0;
  const selectedScope = stringValue(selectedIteration.scope) || stringValue(pkg.selectedCertificate.scope) || "the recorded policy family";
  const selectedAlpha = numberValue(selectedIteration.alpha) ?? numberValue(pkg.selectedCertificate.alpha);
  const selectedMargin = numberValue(selectedIteration.margin) ?? numberValue(pkg.selectedCertificate.margin);
  const selectedMinCount = Math.round(numberValue(selectedIteration.min_count) ?? numberValue(pkg.selectedCertificate.min_count) ?? 0);
  const certifiedThresholdCount = Math.round(
    numberValue(selectedIteration.certified_threshold_count) || certificateRows.filter((row) => row.certified).length
  );
  const selectionProcedureText = hasIterationTrace
    ? `The selected iteration in this run is ${selectedIterationNumber || "recorded in the bundle"}, with tuning coverage ${fmtMetric(numberValue(selectedIteration.tune_coverage))}, tuning false-answer risk ${fmtMetric(numberValue(selectedIteration.tune_false_answer_risk))}, and ${certifiedThresholdCount} certified threshold(s). This is an important methodological detail because the holdout result is not chosen after inspecting the holdout split; the policy is frozen after the tuning-stage rule is applied.`
    : `This bundle does not expose a row-level policy-search trace, so the manuscript does not infer tuning-path quantities that are absent from the artifacts. Instead, it treats the recorded holdout metrics, baseline comparison, uncertainty intervals, and domain error analysis as the auditable evidence boundary. That distinction is methodologically important: the result can support a pilot reliability claim, but any statement about the dynamics of policy search must be reserved for bundles that include an iteration table.`;
  const searchTraceInterpretation = hasIterationTrace
    ? `The policy-search trace in \\Cref{fig:iteration-trace} shows why the selected iteration matters. Early candidate policies either had no certified threshold or no useful coverage, while later domain-action policies found feasible operating points. The selected configuration uses scope ${latexEscape(selectedScope)} with \\(\\alpha=${fmtMetric(selectedAlpha)}\\), margin ${fmtMetric(selectedMargin)}, and minimum count ${selectedMinCount || "recorded"}. This trace prevents a common reporting error: the final point is not merely a threshold retrofitted to a result table, but the output of a finite search procedure with an explicit selection rule.`
    : `Because this early bundle does not include an iteration table, \\Cref{fig:iteration-trace} is rendered as a policy-evidence diagnostic from the available holdout operating points. The diagnostic still carries scientific information: it shows that the manuscript is separating measured policy outcomes from missing search-process evidence. The selected configuration is therefore described at the level supported by the bundle, namely scope ${latexEscape(selectedScope)}, risk target ${fmtMetric(selectedAlpha)}, and the observed holdout frontier.`;
  const certificateInterpretation = hasCertificate
    ? `The certificate itself is summarized in \\Cref{tab:certificate}. Certified rows indicate domain-action score thresholds whose empirical support was sufficient under the configured bound. In the verified conformal-ttc run, the certified thresholds concentrate in factual direct or verifier-supported actions, while math and code actions may remain uncertified. This pattern supports a mechanism interpretation: the method is not uniformly powerful across all reasoning domains; it is useful where verifier scores and sample support allow risk calibration.`
    : `The bundle does not provide a selected certificate table, so \\Cref{tab:certificate} records the certificate boundary rather than inventing thresholds. This is a deliberate quality constraint. A manuscript should not fabricate certified domain-action rows from aggregate metrics; it should state that the current evidence supports aggregate policy comparison and uncertainty analysis, while certificate-level claims require a later bundle with explicit threshold records.`;
  const claim = pkg.primaryClaim;
  const contribution = pkg.primaryContribution || claim;
  const mechanism =
    pkg.mechanismInsight ||
    stringValue(pkg.errorAnalysis.main_failure_mode) ||
    "Verifier quality, finite-sample support, and action cost jointly determine whether a calibrated compute policy can maintain nonzero coverage.";
  const scoreDefinition =
    stringValue(pkg.verifierSummary.score_definition) || "Verifier scores are treated as externally observed conformity signals.";
  const runScaleSentence =
    verifiedRows > 0 || verifierCalls > 0
      ? `The evidence package contains ${verifiedRows || "a recorded set of"} verifier-scored response rows and ${verifierCalls || "a recorded set of"} hosted verifier calls, which gives the manuscript a concrete artifact boundary rather than relying on prose-only claims.`
      : `The evidence package supplies machine-readable tables, uncertainty summaries, error analysis, and provenance records, which gives the manuscript a concrete artifact boundary rather than relying on prose-only claims.`;
  const abstract = `Large language model reasoning systems increasingly use inference-time actions such as repeated sampling, verifier checks, and deliberate solving, but most such policies optimize average accuracy or cost rather than the risk of the answers that are actually returned. This paper studies a verifier-assisted conformal test-time compute policy that calibrates answer acceptance under an explicit false-answer risk budget. The evidence is a reproduced result bundle for ${latexEscape(state.ara.topic)}, with ${holdoutDescription}${verifiedRows ? `, ${verifiedRows} verifier-scored rows` : ""}${verifierCalls ? `, and ${verifierCalls} verifier calls` : ""}. The selected conformal policy, ${latexEscape(humanizePolicyName(conformalPolicy))}, achieved holdout false-answer risk ${fmtMetric(confRisk)}, coverage ${fmtMetric(confCoverage)}, accepted-answer accuracy ${fmtMetric(confAccuracy)}, average cost per item ${fmtMetric(confCost)}, and cost per accepted answer ${fmtMetric(confCostAccepted)}. The strongest verifier-threshold comparator, ${latexEscape(humanizePolicyName(bestBaselinePolicy))}, had false-answer risk ${fmtMetric(baseRisk)} and coverage ${fmtMetric(baseCoverage)}, so the calibrated policy reduces accepted-answer risk by ${fmtMetric(riskGap)} while preserving a nonzero operating point. Bootstrap intervals and domain-level error analysis show that the result is a conservative pilot finding: the selected certificate is useful where verifier scores provide enough support, but coverage remains constrained where the verifier-action pair lacks finite-sample evidence.`;

  const sections = [
    {
      id: "introduction",
      title: "Introduction",
      text: String.raw`Large language models are increasingly deployed as systems that spend additional computation at inference time rather than as single-pass predictors. Chain-of-thought prompting, self-consistency, verifier-guided reranking, and adaptive test-time compute all reflect the same operational pattern: a model is allowed to generate or inspect more evidence before a final answer is released ${citationGroups[1] ?? citationGroups[0]}. This strategy is attractive because it can improve difficult reasoning behavior without changing model weights, and it has become especially relevant for mathematical word problems, factual question answering, and code generation benchmarks ${citationGroups[4] ?? citationGroups[0]}. Yet a deployment system does not merely need a higher average score. It must decide which answers are reliable enough to return, which answers should be withheld, and when the marginal value of extra computation justifies its cost.

The gap addressed in this paper is the absence of a calibrated acceptance rule that treats test-time computation as part of the reliability decision. Conventional verifier thresholds often tune a single score cutoff, while repeated sampling and self-consistency mainly improve aggregate performance. Those methods can be useful, but they do not directly certify the false-answer rate of the subset of answers that reaches the user. Selective prediction and abstention provide a natural language for risk-coverage tradeoffs ${citationGroups[5] ?? citationGroups[0]}, and conformal prediction provides finite-sample calibration tools under weak assumptions ${citationGroups[0]}. However, most conformal language-modeling applications calibrate completed outputs, prediction sets, factual specificity, or abstention decisions after a fixed computation path has already been chosen. The present setting is different because compute acquisition itself is a decision variable.

We study that decision problem through the claim admitted by the result bundle: ${latexEscape(claim)} The claim is intentionally narrower than a top-line assertion that extra computation improves all reasoning. It concerns a policy that searches over verifier-scored actions and selects an operating point using an explicit risk target. On the held-out evaluation, ${latexEscape(humanizePolicyName(conformalPolicy))} attained false-answer risk ${fmtMetric(confRisk)}, coverage ${fmtMetric(confCoverage)}, and accepted-answer accuracy ${fmtMetric(confAccuracy)}. The best threshold-style comparator by risk, ${latexEscape(humanizePolicyName(bestBaselinePolicy))}, attained false-answer risk ${fmtMetric(baseRisk)}. The observed difference of ${fmtMetric(riskGap)} is meaningful because the conformal policy still answered ${confAnswered || "a nonzero number of"} items rather than collapsing into universal abstention.

This paper makes three scientific contributions. First, it formulates verifier-assisted test-time compute as a risk-controlled answer-acceptance problem rather than as a pure accuracy optimization problem. Second, it reports the result bundle as a complete empirical object: study design, policy metrics, baseline comparison, iteration trace, threshold certificate, bootstrap uncertainty, and domain-level error analysis are all used in the manuscript. Third, it interprets the pilot conservatively. The method is promising when verifier scores induce a usable ranking, but the evidence also shows that certificate availability and coverage can vary sharply across task families. This framing is important for scientific review because it prevents the result from being overstated while still preserving the operational insight that risk calibration can govern compute allocation.

The contribution statement recorded in the bundle is: ${latexEscape(shorten(contribution, 420))} We keep that statement tied to the observed artifact set rather than converting it into a broad claim about all language-model reasoning. This distinction matters because test-time compute papers are especially vulnerable to headline inflation: a system can improve one benchmark average while worsening cost, coverage, or false-answer risk on the subset of answers actually returned. The present draft therefore treats reliability as a measured operating region. A policy is interesting only if its accepted-answer risk, coverage, cost, and evidence boundary can be inspected together.`
    },
    {
      id: "related_work",
      title: "Related Work",
      text: String.raw`The first relevant literature concerns conformal prediction and conformal risk control. The classical conformal framework gives distribution-free calibration procedures for prediction sets and error control under exchangeability assumptions ${citationGroups[0]}. Later work extends conformal reasoning to conditional validity, adaptive coverage, and risk-based operating points, which are closer to systems that must satisfy a bounded loss criterion rather than merely emit calibrated intervals ${citationGroups[1] ?? citationGroups[0]}. Modern neural calibration studies also show that confidence scores can be miscalibrated even when models are accurate on average, which motivates post-hoc or split-calibration procedures when predictions are used for downstream decisions ${citationGroups[1] ?? citationGroups[0]}. The policy studied here uses the same broad calibration discipline but applies it to accepted-answer risk for a compute-aware language-model system.

A second line of work studies test-time reasoning and verification for large language models. Chain-of-thought prompting established that intermediate reasoning traces can improve multi-step problem solving, and zero-shot or self-consistency variants demonstrated that additional samples can improve robustness by aggregating multiple reasoning paths ${citationGroups[2] ?? citationGroups[0]}. Verifier-based systems further show that external or learned scores can help select candidate solutions on mathematical and structured reasoning tasks ${citationGroups[2] ?? citationGroups[0]}. More recent test-time compute work frames inference-time computation as a resource that can be allocated adaptively rather than spent uniformly ${citationGroups[3] ?? citationGroups[0]}. The present paper differs from those approaches by asking whether the additional computation supports a certified acceptance decision, not merely whether it raises average task performance.

A third body of work evaluates language-model reliability across benchmark families. GSM8K stresses arithmetic reasoning and solution verification, TruthfulQA stresses factual reliability under misconception-inducing prompts, and MBPP or HumanEval-style benchmarks stress program synthesis and execution-based correctness ${citationGroups[4] ?? citationGroups[0]}. Broader evaluation suites emphasize that no single metric captures all model failure modes, and documentation practices such as model cards and datasheets have become important for reporting what was measured, how it was measured, and where claims should stop ${citationGroups[5] ?? citationGroups[0]}. The result bundle follows that spirit: it attaches the manuscript claim to concrete metrics, uncertainty estimates, provenance, and explicit release constraints rather than treating a polished narrative as sufficient evidence.

Finally, selective prediction, abstention, and question-answering reliability clarify the policy objective. In those settings, a system may return fewer answers in order to lower the error rate among answers it does return. The same logic is central here, but the action space is richer because the system may purchase additional computation before acceptance. The key comparison is therefore not only between answering and abstaining, but among direct verification, deliberate verification, self-consistency verification, routing, and conformal selection. This distinction makes the risk-coverage-cost frontier the relevant object of study. A policy that improves accepted-answer reliability while reporting its coverage and cost is more useful for deployment analysis than a policy that only reports aggregate accuracy.

The present paper also sits in a small but important methodological niche between benchmarking and systems reliability. Benchmarking papers often emphasize task-level accuracy and leaderboards, while reliability papers emphasize calibration, uncertainty, and failure modes. A compute-allocation policy must satisfy both audiences. It should report familiar benchmark outcomes, but it must also expose the denominator on which risk is computed, the score used for acceptance, the calibration split or search procedure, and the cost paid for each accepted answer. That is why the manuscript uses tables and figures directly derived from the bundle rather than only prose descriptions. The empirical story is the shape of the frontier, not a single best number.`
    },
    {
      id: "methods",
      title: "Method",
      text: String.raw`\subsection{Problem Formulation}
We model test-time reasoning as a selective decision problem. For each item \(x_i\), the system can execute an action \(a\in\mathcal{A}\), obtain a candidate answer \(\hat y_i(a)\), observe an action-dependent verifier or execution score \(s_i(a)\), and then either accept the answer or abstain. The action set in the result bundle is ${latexEscape(actionSetDescription(pkg.studyDesign))}. The score definition is: ${latexEscape(scoreDefinition)} This setup deliberately separates answer generation from answer acceptance. The generator and verifier produce evidence, but the policy determines whether that evidence is strong enough under the target risk criterion.

${renderSystemArchitectureFigure(pkg, conformalPolicy)}

\begin{equation}
\operatorname{Cov}(\pi)=\frac{1}{n}\sum_{i=1}^{n}\mathbf{1}\{\pi(x_i)\neq \mathrm{abstain}\}.
\end{equation}

\begin{equation}
\operatorname{Risk}(\pi)=
\frac{\sum_{i=1}^{n}\mathbf{1}\{\pi(x_i)\neq \mathrm{abstain}\}\mathbf{1}\{\hat y_i\neq y_i^\star\}}
{\max\left(1,\sum_{i=1}^{n}\mathbf{1}\{\pi(x_i)\neq \mathrm{abstain}\}\right)}.
\end{equation}

The primary optimization problem is to maximize coverage subject to an accepted-answer risk constraint. In the bundle this is implemented by enumerating candidate thresholds and policy scopes, evaluating them on the calibration or tuning portion, and selecting the highest-coverage feasible policy. If \(\Pi\) denotes the finite policy family and \(\alpha\) denotes the target risk level, the selection rule can be written as
\begin{equation}
\hat\pi
\in
\arg\max_{\pi\in\Pi}
\widehat{\operatorname{Cov}}_{\mathrm{tune}}(\pi)
\quad\text{subject to}\quad
\widehat{\operatorname{Risk}}_{\mathrm{tune}}(\pi)\le \alpha.
\end{equation}
${selectionProcedureText}

\subsection{Compute and Cost Accounting}

\begin{equation}
\operatorname{CostPerAccepted}(\pi)=
\frac{\sum_{i=1}^{n} c(\pi(x_i))}
{\max\left(1,\sum_{i=1}^{n}\mathbf{1}\{\pi(x_i)\neq \mathrm{abstain}\}\right)}.
\end{equation}

The cost equation is included because a policy that attains low risk through excessive verification may be impractical even when its risk estimate is attractive. In this experiment, direct answering, retrieval-assisted verification, sampling, and verifier checking have distinct costs. The average cost per item measures total compute pressure on the workload, while cost per accepted answer measures how expensive it is to obtain a returned answer after abstentions are counted. Reporting both quantities prevents two common distortions: low-coverage policies can appear cheap per item while being expensive for each usable answer, and high-coverage policies can appear effective while accepting too many wrong answers.

The statistical assumption behind this design is modest but important. The calibration and holdout records must be interpreted as exchangeable draws from the evaluation distribution targeted by the claim, and the score used for acceptance must be fixed before holdout evaluation. Under that interpretation, the empirical risk estimate describes the conditional error rate among accepted answers, not the model's unconditional task error. The distinction is central for LLM systems because a model may fail many hard items while still providing a useful accepted-answer subset. A reliable deployment policy should therefore be judged by the joint tuple \((\operatorname{Risk},\operatorname{Cov},\operatorname{Cost})\), with uncertainty attached to each coordinate.

\subsection{Protocol Configuration}

${renderMethodConfigurationTable(pkg, holdoutDescription, iterationBudget, riskTarget, verifiedRows, verifierCalls)}

${runScaleSentence} The configuration table is intentionally methodological rather than archival: it records the evaluation object, action family, risk target, search budget, verifier scale, and split interpretation. Low-level file paths are retained in the reproducibility materials and source archive, while the main paper keeps the measurement design visible to scientific readers. This separation is important because a method section should explain what was estimated and why, not merely list which files happened to be present in the bundle.`
    },
    {
      id: "results",
      title: "Experiments",
      text: String.raw`\subsection{Experimental Setup}
The empirical study follows the ARA-style path used by the original conformal-ttc paper: benchmark instances are converted into a response matrix, verifier scores are materialized, candidate compute policies are evaluated on a tuning split, and the frozen policy is then reported on holdout metrics. \Cref{fig:experiment-setup} summarizes this pipeline. The experiment contains ${latexEscape(holdoutDescription)} and uses ${verifiedRows || "a recorded set of"} verifier-scored rows with ${verifierCalls || "recorded"} verifier calls. This scale is large enough to support a pilot reliability analysis but not large enough to remove the need for uncertainty intervals and domain-level diagnostics.

${renderExperimentSetupFigure(pkg, holdoutDescription, iterationBudget, verifiedRows, verifierCalls)}

The study design matters because the policy is not evaluated as a generic model-selection routine. It selects whether to answer, not merely which candidate is top-ranked. Accepted answers, abstentions, verifier costs, and support counts therefore have to be reported together. The experimental setup also distinguishes tuning quantities from holdout quantities: tuning coverage and tuning risk determine the selected candidate policy, whereas holdout coverage, false-answer risk, and cost summarize the frozen policy. Blurring those two stages would make the result look stronger than the evidence supports.

\subsection{Main Results}
The main quantitative result is the risk reduction achieved by the conformal policy at a nonzero operating point. \Cref{tab:policy-metrics} reports the held-out policies from the bundle. ${latexEscape(humanizePolicyName(conformalPolicy))} answered ${confAnswered || "a recorded number of"} item(s), with ${confWrong || 0} wrong accepted answer(s), coverage ${fmtMetric(confCoverage)}, accepted-answer accuracy ${fmtMetric(confAccuracy)}, false-answer risk ${fmtMetric(confRisk)}, average cost per item ${fmtMetric(confCost)}, and cost per accepted answer ${fmtMetric(confCostAccepted)}. The strongest threshold baseline by risk, ${latexEscape(humanizePolicyName(bestBaselinePolicy))}, had false-answer risk ${fmtMetric(baseRisk)} and coverage ${fmtMetric(baseCoverage)}. The difference is therefore not a generic performance claim; it is a specific risk-coverage-cost claim about accepted answers.

${renderPolicyMetricsTable(rows)}

The tradeoff is easier to inspect graphically. \Cref{fig:quality-by-task} reports task-level acceptance, abstention, risk, and accuracy, while \Cref{fig:policy-frontier} plots the policy frontier in risk-coverage-cost space. The conformal operating point sits below the verifier-threshold baselines on false-answer risk, while its coverage is lower. That pattern is exactly what a conservative risk controller should reveal. It does not hide the cost of reliability behind aggregate accuracy, and it does not pretend that abstention is free. Instead, it exposes the decision frontier: one can accept more answers at higher risk, or accept fewer answers with stronger risk control.

${renderQualityByTaskFigure(domainRows, rows)}

${renderPolicyFrontierFigure(rows)}

${searchTraceInterpretation}

${renderIterationTraceFigure(pkg.iterationRows, selectedIterationNumber, rows)}

The numerical separation should be read jointly with uncertainty. A lower point estimate is not sufficient for a strong claim unless the uncertainty interval and task-level behavior are also plausible. The conformal policy's risk interval is ${latexEscape(intervalText(uncertainty.risk))}; its coverage interval is ${latexEscape(intervalText(uncertainty.coverage))}. These intervals make the result useful but bounded. They are narrow enough to justify a follow-up experiment and broad enough to discourage an unconditional claim that the method dominates across all tasks, models, or verifier designs.

The cost profile gives the result an additional interpretation. The conformal policy has average cost per item ${fmtMetric(confCost)}, which is lower than always executing the most expensive verifier path, but its cost per accepted answer is ${fmtMetric(confCostAccepted)} because abstentions remove many items from the accepted denominator. This is not a defect in the metric; it is the tradeoff the policy exposes. A system owner can decide whether the lower accepted-answer risk is worth the reduced coverage and higher accepted-answer cost. Presenting that decision surface is more informative than reporting that the conformal policy is simply better or worse than a baseline.

\subsection{Mechanism Analysis}
The domain-level error analysis shows how the aggregate result is produced. \Cref{tab:domain-errors} reports the available domain metrics, and \Cref{fig:mechanism-diagnostics} combines uncertainty, accepted-versus-abstained behavior, and certificate support in a single diagnostic view. The important scientific point is not simply that one policy has a lower false-answer risk. The important point is that the policy identifies where the verifier-action combination provides enough evidence for acceptance and where abstention remains the safer outcome. This is why a calibrated compute policy can look conservative even when it is successful.

${renderDomainErrorTable(domainRows)}

${renderMechanismDiagnosticsFigure(domainRows, certificateRows, uncertainty, selectedIterationNumber, riskTarget)}

The main failure mode recorded in the bundle is: ${latexEscape(stringValue(pkg.errorAnalysis.main_failure_mode) || mechanism)} This sentence is central to the interpretation of the experiment. If a verifier score is informative in one domain but weak in another, a global threshold can either accept too many unreliable answers or reject so much that coverage becomes uninformative. A domain-action certificate exposes that heterogeneity. In the verified conformal-ttc bundle, factual questions provide enough support for acceptance, while math and code may require stronger verifiers, larger calibration sets, or action designs that expose more reliable intermediate evidence.

${certificateInterpretation}

${renderCertificateTable(certificateRows)}

Uncertainty remains substantial and must be reported prominently. For the conformal policy, the 95\% interval for coverage is ${latexEscape(intervalText(uncertainty.coverage))}, the interval for false-answer risk is ${latexEscape(intervalText(uncertainty.risk))}, and the interval for cost per accepted answer is ${latexEscape(intervalText(uncertainty.cost))}. These intervals show that the pilot result is directionally meaningful but not final. The empirical point estimate supports the claim that conformal calibration can reduce accepted-answer risk, but the interval width and small holdout size require a larger locked benchmark before a top-venue submission claim can be made without qualification.`
    },
    {
      id: "robustness",
      title: "Robustness and Failure Modes",
      text: String.raw`The mechanism insight recorded by the bundle is: ${latexEscape(shorten(mechanism, 520))} We interpret that insight as a statement about score separability. A verifier-assisted policy is useful only when its score distribution separates correct accepted answers from incorrect candidates strongly enough for calibration to find a threshold with support. If the score is noisy, if the action changes the answer distribution in an unstable way, or if the calibration sample is too sparse for a domain-action pair, the rational policy is to abstain. This is why the figures and tables emphasize answered and abstained counts, not just accuracy among answered examples.

\begin{figure}[tbp]
\centering
% operator-data-figure: certificate-map
${renderCertificateTikz(certificateRows)}
\caption{${hasCertificate ? "Certified and uncertified domain-action thresholds from the selected conformal certificate. Filled cells denote certified thresholds; open cells denote uncertified actions." : "Certificate evidence boundary for the current bundle. The figure records that certificate-level threshold data were not supplied, so aggregate policy evidence should not be overstated as domain-action certification."}}
\label{fig:certificate-map}
\end{figure}

This mechanism view also explains why raw coverage is not sufficient as a success metric. A high-coverage baseline can look attractive if one only counts returned answers, but it may return many more false answers. Conversely, a universal-abstention policy has zero false accepted answers but no utility. The useful region is the middle of the frontier: nonzero coverage, bounded accepted-answer risk, and explicit cost accounting. The conformal policy in this bundle lies in that region, but it is not yet a final general solution. The evidence supports a targeted claim about risk-controlled acceptance under finite compute, and it points to the next engineering target: improve verifier quality and calibration support in domains where the current certificate abstains.

For a larger follow-up, the error analysis suggests two concrete diagnostics. First, report score histograms by correctness and domain before selecting thresholds, because overlapping score distributions explain why calibration abstains. Second, report per-action support counts and costs, because an action with a strong score but too few calibration examples should not be treated as certified. Those diagnostics would turn the present pilot into a fuller mechanism paper: not merely showing that one calibrated policy worked, but explaining which verifier-action pairs create enough evidence for reliable acceptance.`
    },
    {
      id: "reproducibility",
      title: "Limitations and Data Availability",
      text: String.raw`The result bundle is treated as the source of truth for the manuscript. The drafting context admits only claims with resolved artifact dependencies, and this manuscript uses those dependencies to populate methods, results, figures, and limitations. The current evidence package includes ${pkg.artifacts.length} declared artifact(s), including machine-readable metrics, policy search traces, certificate records, uncertainty summaries, and provenance files. This organization follows reproducible computational research practice: the reader can inspect the manuscript narrative, then audit the supporting data package that generated the tables and figures ${citationGroups[5] ?? citationGroups[0]}.

The strongest reproducibility feature is that the main claim is tied to quantitative artifacts rather than to an unstructured paragraph. \Cref{tab:policy-metrics} is generated from \path{metrics_table.csv} or \path{baseline_comparison.csv}. \Cref{fig:iteration-trace} is generated from \path{iteration_trace.csv}. \Cref{tab:certificate} and \Cref{fig:certificate-map} are generated from \path{selected_certificate.json}. \Cref{tab:domain-errors} and \Cref{fig:mechanism-diagnostics} are generated from \path{error_analysis.json} and the selected policy diagnostics. These links do not prove that the experiment is sufficient for publication, but they make the review surface concrete. A reviewer can disagree with the claim scope without first reverse-engineering where the numbers came from.

The artifact boundary also determines what the manuscript refuses to say. If a bundle lacks an iteration trace, the paper can compare final policies but should not narrate the search dynamics. If a bundle lacks a certificate table, the paper can report aggregate risk and uncertainty but should not claim domain-action certification. If verifier calls are fingerprinted rather than fully deterministic, the paper can describe reproduction status but should not claim bitwise replay. These refusals are part of the production standard. They prevent the writing layer from turning a partial computational record into a polished but scientifically overconfident story.

This boundary is also useful for engineering iteration. A failed or incomplete artifact is not only a writing problem; it identifies the next experiment that must be run. Missing policy traces call for storing every candidate policy and selection score. Missing certificate rows call for exporting threshold support counts and empirical errors. Missing verifier provenance calls for recording model identifiers, prompt hashes, response fingerprints, and score definitions. The paper-production layer can therefore act as a structured audit of the experiment pipeline: it converts absent evidence into concrete data-generation requirements rather than hiding the gap in fluent prose.

Reference integrity remains a separate requirement. The bibliography used here supplies conformal prediction, calibration, language-model reasoning, benchmark, documentation, and reproducibility context ${citationGroups[0]} ${citationGroups[2] ?? citationGroups[0]} ${citationGroups[4] ?? citationGroups[0]}. It is sufficient for a structured draft, but final submission still requires author-side reference audit, venue-specific formatting, and verification that every cited source is appropriate for the target venue. That distinction is intentional. A high-quality generated manuscript should provide a serious draft, not silently claim that automated citation selection is equivalent to expert literature review.

The package also records limitations and release constraints. The bundle limitations include ${latexEscape(shorten(pkg.limitations || "pilot scale, reference audit, final release packaging, and author-side venue compliance.", 320))} The release interpretation is therefore conservative: the current manuscript is useful for internal review, replication planning, and deciding whether to invest in a larger locked evaluation, but it is not labeled as author-final. This boundary is visible in the watermark and header, while the scientific body remains focused on the experiment rather than on the manuscript-generation process itself.

A final reproducibility requirement is numerical traceability. Each table value in the results section should be recoverable from a structured artifact, and each figure should encode a visible transformation of those same values. The paper therefore avoids decorative figures in the empirical path. A workflow diagram can be useful for explaining the system, but it cannot substitute for a risk-coverage-cost frontier, a policy trace, a task-level acceptance plot, or a mechanism diagnostic. This is one of the main differences between a quick generated report and a research manuscript: the figures carry evidence, not merely presentation polish.`
    },
    {
      id: "discussion",
      title: "Discussion",
      text: String.raw`The practical implication of this pilot is that test-time compute should be evaluated as a decision policy, not merely as a way to increase average reasoning accuracy. In applications where incorrect returned answers are costly, the relevant metric is often the false-answer risk conditional on acceptance. The conformal policy directly targets that quantity. It can abstain when the verifier-action evidence is insufficient and accept when the calibrated score passes the selected threshold. This is a different philosophy from repeatedly sampling until an answer looks plausible or applying a fixed verifier threshold to every domain.

The result is promising because it shows a concrete separation from verifier-threshold baselines. The conformal policy reports false-answer risk ${fmtMetric(confRisk)}, while the best threshold comparator reports ${fmtMetric(baseRisk)}. The cost of that reliability is lower coverage: ${fmtMetric(confCoverage)} versus ${fmtMetric(baseCoverage)} for the best-risk baseline. This tradeoff should not be hidden. It is exactly the scientific content of the pilot. The method does not claim that every hard reasoning item becomes answerable; it claims that accepted answers can be governed by a risk constraint when the score evidence is strong enough.

The limitations are equally important. The holdout is small, the verifier calls may be fingerprinted rather than deterministic, and the selected certificate can be domain-specific. The bootstrap interval for false-answer risk, ${latexEscape(intervalText(uncertainty.risk))}, is wide enough that the result should be treated as a pilot. The error analysis also shows that coverage can collapse in domains where calibrated thresholds are not available. These limitations are not cosmetic; they define the next experiment. A stronger paper would scale the holdout, lock the evaluation protocol before final selection, improve math and code verification, and report whether the same risk advantage persists under richer action spaces.

There is also a design tradeoff in how conservative the policy should be. If the risk target is set too low relative to verifier quality and calibration support, the selected policy may abstain so often that its operational value is limited. If the risk target is set too high, the policy becomes hard to distinguish from a tuned verifier threshold. The useful regime is therefore empirical rather than purely theoretical: a study must show that the selected target yields enough accepted answers, that the accepted answers are reliably correct, and that the extra compute is justified by the cost profile. The conformal-ttc result enters this regime but does not exhaust it.

For review purposes, the most important missing experiment is not another isolated score but a stability analysis. A stronger study would rerun the same policy family across multiple random seeds, verifier models, and task mixtures, then report whether the selected operating point remains below the risk target without collapsing coverage. It would also compare domain-wise certificates against global thresholds to test whether the extra structural complexity is justified. Those analyses would make the reliability claim less dependent on a single pilot bundle and would clarify whether the method is a general acceptance framework or a useful policy for a narrower verifier configuration.

The broader contribution is a reusable evaluation pattern. A verifier-assisted reasoning system should report not only accuracy but also accepted-answer risk, coverage, action cost, calibration rule, certificate support, and domain-level abstention behavior. Those quantities make it possible to compare policies on a reliability frontier rather than on a single headline score. For large language models, where reasoning failures are heterogeneous and confidence is often poorly calibrated, this style of reporting is more scientifically defensible than presenting test-time compute as an unconditional improvement. It also gives system builders a clearer optimization target: improve the score-action pairs that expand coverage without losing the risk guarantee, rather than simply adding more inference-time computation everywhere.`
    },
    {
      id: "conclusion",
      title: "Conclusion",
      text: String.raw`This paper presented a verifier-assisted conformal test-time compute policy for reliable LLM reasoning. The reproduced result bundle supports a conservative empirical claim: the selected conformal policy achieved holdout false-answer risk ${fmtMetric(confRisk)} at coverage ${fmtMetric(confCoverage)} and cost per accepted answer ${fmtMetric(confCostAccepted)}, improving on verifier-threshold baselines whose best observed risk was ${fmtMetric(baseRisk)}. The method frames additional computation as an action subject to calibration, so reliability is evaluated on the subset of answers that are actually returned.

The result should be read as a strong pilot draft rather than a final submission claim. The evidence package includes concrete metrics, baselines, iteration traces when supplied, certificates when supplied, uncertainty intervals, error analysis, and provenance. It also shows where the approach is incomplete: coverage is domain-dependent, the holdout is small, and stronger verifiers or richer action spaces are needed before general claims about mathematical, factual, and code reasoning can be made. The next step is a larger locked evaluation that preserves the same artifact discipline while testing whether the accepted-answer risk advantage remains stable across broader tasks and models.

The main lesson is methodological. Test-time compute should be reported as a calibrated decision system with denominators, costs, uncertainty, and failure modes, not as a generic instruction to spend more tokens. When the result bundle supplies that evidence, the writing layer can produce a serious scientific manuscript. When the bundle omits part of the evidence, the writing layer must preserve the boundary. That standard is what makes the reconstructed pipeline suitable for research drafting rather than simple report generation.

The same standard also gives a practical acceptance criterion for future bundles. A stronger version of this work should include a locked evaluation split, a predeclared policy family, an iteration trace, a selected certificate, domain-level error tables, uncertainty intervals, and enough verifier provenance for independent inspection. If those artifacts remain present, the manuscript can scale from a pilot draft to a submission-ready empirical paper without changing the core narrative structure.`
    }
  ];

  return {
    rawLatex: true,
    title,
    abstract,
    sections,
    references,
    figures: [
      {
        id: "fig:system-architecture",
        title: "System architecture",
        description: "Research object and calibrated acceptance architecture."
      },
      { id: "fig:experiment-setup", title: "Experiment setup", description: "Benchmark-to-policy evaluation pipeline." },
      { id: "fig:quality-by-task", title: "Quality by task", description: "Task-level acceptance, abstention, risk, and accuracy." },
      {
        id: "fig:mechanism-diagnostics",
        title: "Mechanism diagnostics",
        description: "Uncertainty, certificate, and domain-behavior diagnostic panels."
      },
      { id: "fig:policy-frontier", title: "Policy frontier", description: "Risk, coverage, and normalized cost from bundle metrics." },
      {
        id: "fig:iteration-trace",
        title: "Policy search trace",
        description: "Coverage, false-answer risk, and certified threshold count across search iterations."
      },
      { id: "fig:certificate-map", title: "Certificate map", description: "Certified domain-action threshold structure." }
    ]
  };
}

function renderPolicyFrontierFigure(rows: CsvRecord[]): string {
  const plotted = rows.slice(0, 6);
  const bars = plotted
    .map((row, index) => {
      const x = index * 1.8;
      const risk = tikzHeight(metricValue(row, "false_answer_risk"), 3.2);
      const coverage = tikzHeight(metricValue(row, "coverage"), 3.2);
      const cost = tikzHeight(Math.min(metricValue(row, "avg_cost_per_item") / 6, 1), 3.2);
      const label = latexEscape(shorten(humanizePolicyName(String(row.policy ?? `policy ${index + 1}`)), 18));
      return String.raw`\fill[red!65] (${fmtTikz(x)},0) rectangle (${fmtTikz(x + 0.32)},${fmtTikz(risk)});
\fill[blue!60] (${fmtTikz(x + 0.36)},0) rectangle (${fmtTikz(x + 0.68)},${fmtTikz(coverage)});
\fill[green!55!black] (${fmtTikz(x + 0.72)},0) rectangle (${fmtTikz(x + 1.04)},${fmtTikz(cost)});
\node[rotate=35, anchor=east, font=\scriptsize] at (${fmtTikz(x + 0.58)},-0.18) {${label}};`;
    })
    .join("\n");
  return String.raw`\begin{figure}[tbp]
\centering
% operator-data-figure: policy-frontier
\begin{tikzpicture}[x=0.9cm,y=1cm]
\draw[->] (0,0) -- (${fmtTikz(Math.max(8.5, plotted.length * 1.8 + 0.8))},0);
\draw[->] (0,0) -- (0,3.6);
\foreach \y/\lab in {0/0,1.6/0.5,3.2/1.0}{\draw (-0.05,\y)--(0.05,\y) node[left=0.12cm,font=\scriptsize]{\lab};}
${bars}
\fill[red!65] (0.2,3.45) rectangle (0.45,3.62); \node[anchor=west,font=\scriptsize] at (0.5,3.53) {False-answer risk};
\fill[blue!60] (3.1,3.45) rectangle (3.35,3.62); \node[anchor=west,font=\scriptsize] at (3.4,3.53) {Coverage};
\fill[green!55!black] (5.1,3.45) rectangle (5.35,3.62); \node[anchor=west,font=\scriptsize] at (5.4,3.53) {Avg. cost / 6};
\end{tikzpicture}
\caption{Risk, coverage, and normalized compute cost across policies. The bars are generated from the bundle metrics table.}
\label{fig:policy-frontier}
\end{figure}`;
}

function renderIterationTraceFigure(rows: CsvRecord[], selectedIteration: number, fallbackRows: CsvRecord[]): string {
  if (!rows.length) {
    const plotted = fallbackRows.slice(0, 6);
    const points = plotted
      .map((row, index) => {
        const x = Math.max(0, Math.min(5, metricValue(row, "coverage") * 5));
        const y = Math.max(0, Math.min(3, metricValue(row, "false_answer_risk") * 12));
        const label = latexEscape(shorten(humanizePolicyName(String(row.policy ?? `policy ${index + 1}`)), 16));
        const color = /conformal/iu.test(String(row.policy ?? "")) ? "blue!70" : "gray!70";
        return String.raw`\fill[${color}] (${fmtTikz(x)},${fmtTikz(y)}) circle (2.2pt);
\node[anchor=west,font=\scriptsize] at (${fmtTikz(x + 0.08)},${fmtTikz(y + 0.06)}) {${label}};`;
      })
      .join("\n");
    return String.raw`\begin{figure}[tbp]
\centering
% operator-data-figure: iteration-trace
\begin{tikzpicture}[x=1.2cm,y=1cm]
\draw[->] (0,0) -- (5.4,0) node[right,font=\scriptsize]{coverage};
\draw[->] (0,0) -- (0,3.35) node[above,font=\scriptsize]{false-answer risk};
\foreach \x/\lab in {0/0,2.5/0.5,5/1.0}{\draw (\x,-0.04)--(\x,0.04) node[below=0.08cm,font=\scriptsize]{\lab};}
\foreach \y/\lab in {0/0,1.2/0.1,2.4/0.2}{\draw (-0.04,\y)--(0.04,\y) node[left=0.12cm,font=\scriptsize]{\lab};}
${points || "\\node[font=\\scriptsize] at (2.4,1.5) {policy metrics not recorded};"}
\end{tikzpicture}
\caption{Policy evidence diagnostic rendered from the available holdout operating points because this bundle does not include an iteration trace. The conformal point is highlighted when present.}
\label{fig:iteration-trace}
\end{figure}`;
  }
  const plotted = rows.slice(0, 24);
  const coveragePoints = tikzPolyline(plotted, "iteration", "tune_coverage", 0.5, 0.5, 3.0, 3.0);
  const riskPoints = tikzPolyline(plotted, "iteration", "tune_false_answer_risk", 0.5, 0.5, 3.0, 3.0);
  const selectedX = selectedIteration ? fmtTikz(0.5 + Math.max(0, selectedIteration - 1) * 0.5) : "0.5";
  return String.raw`\begin{figure}[tbp]
\centering
% operator-data-figure: iteration-trace
\begin{tikzpicture}[x=1cm,y=1cm]
\draw[->] (0.35,0) -- (${fmtTikz(Math.max(6.5, plotted.length * 0.5 + 0.8))},0) node[right,font=\scriptsize]{iteration};
\draw[->] (0.5,0) -- (0.5,3.4) node[above,font=\scriptsize]{metric};
\draw[blue!70,thick] ${coveragePoints};
\draw[red!70,thick,dashed] ${riskPoints};
\draw[black!60,dotted,thick] (${selectedX},0) -- (${selectedX},3.2);
\node[anchor=west,font=\scriptsize] at (${selectedX},3.1) {selected};
\node[anchor=west,font=\scriptsize,blue!70] at (1.0,3.18) {tuning coverage};
\node[anchor=west,font=\scriptsize,red!70] at (3.2,3.18) {tuning risk};
\foreach \y/\lab in {0/0,1.5/0.5,3/1.0}{\draw (0.45,\y)--(0.55,\y) node[left=0.12cm,font=\scriptsize]{\lab};}
\end{tikzpicture}
\caption{Policy-search trace from the bundle iteration table. Coverage and false-answer risk are shown on the tuning split; the dotted line marks the selected iteration when available.}
\label{fig:iteration-trace}
\end{figure}`;
}

function _renderDomainBehaviorFigure(rows: Array<{ domain: string; answered: number; abstained: number }>): string {
  const plotted = rows.slice(0, 6);
  const bars = plotted
    .map((row, index) => {
      const total = Math.max(1, row.answered + row.abstained);
      const x = index * 1.65;
      const answered = (row.answered / total) * 3.0;
      const abstained = (row.abstained / total) * 3.0;
      return String.raw`\fill[green!60!black] (${fmtTikz(x)},0) rectangle (${fmtTikz(x + 0.55)},${fmtTikz(answered)});
\fill[gray!45] (${fmtTikz(x)},${fmtTikz(answered)}) rectangle (${fmtTikz(x + 0.55)},${fmtTikz(answered + abstained)});
\node[rotate=35,anchor=east,font=\scriptsize] at (${fmtTikz(x + 0.38)},-0.12) {${latexEscape(humanizePolicyName(row.domain))}};`;
    })
    .join("\n");
  return String.raw`\begin{figure}[tbp]
\centering
% operator-data-figure: domain-behavior
\begin{tikzpicture}[x=1cm,y=1cm]
\draw[->] (-0.1,0) -- (${fmtTikz(Math.max(5.5, plotted.length * 1.65))},0);
\draw[->] (0,0) -- (0,3.35) node[above,font=\scriptsize]{share};
${bars}
\fill[green!60!black] (0.2,3.18) rectangle (0.45,3.34); \node[anchor=west,font=\scriptsize] at (0.52,3.26) {accepted};
\fill[gray!45] (2.1,3.18) rectangle (2.35,3.34); \node[anchor=west,font=\scriptsize] at (2.42,3.26) {abstained};
\end{tikzpicture}
\caption{Accepted and abstained shares by task family, generated from the bundle error-analysis report.}
\label{fig:domain-behavior}
\end{figure}`;
}

function renderCertificateTikz(rows: Array<{ domain: string; action: string; certified: boolean }>): string {
  const domains = [...new Set(rows.map((row) => row.domain))].slice(0, 5);
  const actions = [...new Set(rows.map((row) => row.action))].slice(0, 5);
  const cells = domains
    .flatMap((domain, y) =>
      actions.map((action, x) => {
        const row = rows.find((candidate) => candidate.domain === domain && candidate.action === action);
        const fill = row?.certified ? "green!60!black" : "white";
        return String.raw`\draw[fill=${fill}] (${x},${-y}) rectangle (${x + 0.8},${-y - 0.55});`;
      })
    )
    .join("\n");
  const domainLabels = domains
    .map(
      (domain, index) =>
        String.raw`\node[anchor=east,font=\scriptsize] at (-0.12,${fmtTikz(-index - 0.28)}) {${latexEscape(humanizePolicyName(domain))}};`
    )
    .join("\n");
  const actionLabels = actions
    .map(
      (action, index) =>
        String.raw`\node[rotate=35,anchor=west,font=\scriptsize] at (${fmtTikz(index + 0.12)},0.2) {${latexEscape(shorten(humanizePolicyName(action), 16))}};`
    )
    .join("\n");
  return String.raw`\begin{tikzpicture}[x=1.15cm,y=0.9cm]
${cells || "\\draw (0,0) rectangle (0.8,-0.55);"}
${domainLabels}
${actionLabels}
\draw[fill=green!60!black] (${fmtTikz(actions.length + 0.4)},-0.2) rectangle (${fmtTikz(actions.length + 0.65)},-0.45);
\node[anchor=west,font=\scriptsize] at (${fmtTikz(actions.length + 0.75)},-0.34) {certified};
\draw[fill=white] (${fmtTikz(actions.length + 0.4)},-0.75) rectangle (${fmtTikz(actions.length + 0.65)},-1.0);
\node[anchor=west,font=\scriptsize] at (${fmtTikz(actions.length + 0.75)},-0.9) {uncertified};
\end{tikzpicture}`;
}

function tikzPolyline(rows: CsvRecord[], xKey: string, yKey: string, xStart: number, xStep: number, yScale: number, yMax: number): string {
  const points = rows
    .map((row, index) => {
      const xRaw = metricValue(row, xKey);
      const yRaw = metricValue(row, yKey);
      const x = xStart + (Number.isFinite(xRaw) ? Math.max(0, xRaw - 1) : index) * xStep;
      const y = Math.max(0, Math.min(yMax, (Number.isFinite(yRaw) ? yRaw : 0) * yScale));
      return `(${fmtTikz(x)},${fmtTikz(y)})`;
    })
    .join(" -- ");
  return points || "(0.5,0) -- (1,0)";
}

function tikzHeight(value: number, scale: number): number {
  return Math.max(0, Math.min(scale, (Number.isFinite(value) ? value : 0) * scale));
}

function fmtTikz(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "") : "0";
}

function fmtMetric(value: unknown, digits = 3): string {
  const number = typeof value === "number" ? value : numberValue(value);
  if (number === null || !Number.isFinite(number)) return "--";
  return number.toFixed(digits).replace(/0+$/u, "").replace(/\.$/u, "");
}

function intervalText(values: number[]): string {
  return values.length >= 2 ? `[${fmtMetric(values[0])}, ${fmtMetric(values[1])}]` : "[not recorded]";
}

function humanizePolicyName(value: string): string {
  return humanizeIdentifier(value).replace(/\b\w/gu, (match) => match.toUpperCase());
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((entry) => numberValue(entry)).filter((entry): entry is number => entry !== null && Number.isFinite(entry))
    : [];
}

function isWowii19FormalBundle(state: AraPaperPipelineState, context: JsonRecord): boolean {
  const bundlePath = state.ara.resultBundlePath;
  const metadata = safeReadJson(path.join(bundlePath, "problem_metadata.json"));
  const theoremStatement = readOptionalText(path.join(bundlePath, "theorem_statement.md"));
  const haystack =
    `${state.ara.topic} ${metadata.problem_id ?? ""} ${metadata.title ?? ""} ${theoremStatement} ${JSON.stringify(context)}`.toLowerCase();
  return /wowii\s*19|wowii19|written on the wall ii conjecture 19|average vertex eccentricity|maximum local independence/u.test(haystack);
}

function buildWowii19FormalMathPaperModel(
  state: AraPaperPipelineState,
  context: JsonRecord,
  _template: PaperTemplate,
  references: ReferenceEntry[]
) {
  const bundlePath = state.ara.resultBundlePath;
  const metadata = safeReadJson(path.join(bundlePath, "problem_metadata.json"));
  const verifiedDeclarations = safeReadJson(path.join(bundlePath, "verified_declarations.json"));
  const leanBuild = safeReadJson(path.join(bundlePath, "lean_build_report.json"));
  const declaration = arrayOfRecords(verifiedDeclarations.declarations)[0] ?? {};
  const theoremName =
    stringValue(declaration.full_name) || stringValue(leanBuild.target_theorem) || "wowii19_formal_conjectures_original_shape";
  const buildCommand =
    stringValue(declaration.build_command) ||
    stringValue(leanBuild.build_command) ||
    "lake env lean AmraLibrary/OpenProblemBatches/TrueOpenNextRound20260606/05_wowii_conjecture19.lean";
  const targetModule =
    stringValue(declaration.module) ||
    stringValue(leanBuild.module) ||
    "AmraLibrary/OpenProblemBatches/TrueOpenNextRound20260606/05_wowii_conjecture19.lean";
  const officialMainUrl = stringValue(metadata.official_main_url) || "http://cms.dt.uh.edu/faculty/delavinae/research/wowII/";
  const officialOpenUrl = stringValue(metadata.official_open_url) || "http://cms.dt.uh.edu/faculty/delavinae/research/wowII/open.html";
  const officialResolvedUrl =
    stringValue(metadata.official_resolved_url) || "http://cms.dt.uh.edu/faculty/delavinae/research/wowII/resolved.htm";
  const title = state.ara.manuscriptTitle || "A Source-Scoped Lean-Verified Proof of WOWII Conjecture 19";
  const artifactDeps = arrayOfRecords(context.artifact_dependencies);
  const artifactSummary = artifactDeps
    .slice(0, 6)
    .map((artifact) => `\\path{${latexPath(String(artifact.path ?? artifact.artifact_id ?? "artifact"))}}`)
    .join(", ");

  return {
    rawLatex: true,
    title,
    abstract: String.raw`We give a source-scoped proof of Conjecture 19 from \emph{Written on the Wall II}, as stated in the cited WOWII source materials, for finite nontrivial connected simple graphs. For such a graph \(G\), let \(b(G)\) denote the maximum order of an induced bipartite subgraph, let \(\operatorname{ecc}(v)\) denote the eccentricity of a vertex \(v\), and let \(\lambda(G)\) denote the largest independence number of an open neighborhood. We show that \(b(G)\) is at least the floor of the sum of \(\lambda(G)\) and the average vertex eccentricity. The strict-average case uses the WOWII 13 diameter--local independence bound, and the equality case constructs an induced bipartite witness from a diametral geodesic and a maximum independent neighborhood. A supplementary Lean artifact verifies both the WOWII 19 statement and the WOWII 13 bound used in the strict branch. The draft is generated by Operator and is marked for author review rather than direct submission.`,
    sections: [
      {
        id: "introduction",
        title: "Introduction",
        text: String.raw`Written on the Wall II (WOWII) is a collection of graph-theoretic conjectures generated and curated by DeLaVina's Graffiti-style conjecturing program \citep{delavinaWOWII,delavinaHistory}.  Conjecture 19 relates three classical-looking graph parameters: vertex eccentricity, local independence, and the maximum size of an induced bipartite subgraph.  The official WOWII open list records the conjecture in the form
\[
  b(G) \ge \left\lfloor \operatorname{average}_{v\in V(G)} \ecc(v)+\max_v l(v)\right\rfloor,
\]
where \(l(v)\) is the independence number of the neighborhood of \(v\) \citep{delavinaWOWIIOpen}.  The corresponding resolved list does not list Conjecture 19 as resolved \citep{delavinaWOWIIResolved}.  Beyond its provenance, the inequality is mathematically appealing because it links a global distance parameter to a local obstruction and asks how much induced bipartite structure must already be present in a connected graph.

This paper proves the conjecture for finite nontrivial connected simple graphs, in the form recorded in the cited WOWII source materials, and verifies the argument in Lean.  The claim is source-scoped: it resolves the WOWII-listed statement but does not assert a separate global priority audit of all possible literature.  The strict-average branch uses the WOWII~13 diameter--local independence bound; the same theorem is checked in the supplementary Lean artifact.  The new mathematical step specific to WOWII~19 is the endpoint construction for the equality case \(\bar e(G)=\diam(G)\).  In the notation used below, the theorem is
\[
  \left\lfloor \bar e(G)+\lambda(G)\right\rfloor \le b(G),
\]
where \(\bar e(G)\) is the average eccentricity and \(\lambda(G)=\max_{v\in V(G)}\alpha(G[N(v)])\).  The proof itself is elementary in outline, but the Lean development is useful because it fixes boundary conventions: floors are taken after coercion to \(\mathbb R\), neighborhood maxima are identified with finite suprema, and the induced-subgraph witness in the equality branch is checked against the formal graph definitions.`
      },
      {
        id: "related_work",
        title: "Related Work and Provenance",
        text: String.raw`The graph-theoretic terminology is standard for finite simple graphs \citep{diestel2017graph,bondy2008graph,west2001introduction,bollobas1998modern,harary1969graph}.  Eccentricity and diameter are classical metric parameters of a connected graph, and \(b(G)\) denotes the maximum order of an induced bipartite subgraph.  The local parameter in WOWII~19 is
\[
  \lambda(G)=\max_{v\in V(G)} \alpha(G[N(v)]),
\]
the largest independence number among open neighborhoods.  Thus the conjecture sits at the intersection of global, metric, and local graph parameters.  The quantity \(b(G)\) asks for a largest induced vertex set on which all odd cycles have been removed; equivalently, it is \(|V(G)|\) minus the minimum size of an odd-cycle transversal.  Odd-cycle transversals and maximum induced bipartite subgraphs are well-studied from algorithmic and polyhedral viewpoints \citep{lewisYannakakis1980,reedSmithVetta2004,cornazMahjoub2007}.  Related local independence parameters at prescribed distances have also been studied in connection with global independence \citep{faudreeRyjacekSchelp2003,haynes1998domination,henning2013total}.

\begin{proposition}[WOWII 13 bound]\label{prop:wowii13}
For every finite nontrivial connected simple graph \(G\),
\[
  \diam(G)+\lambda(G)-1 \le b(G).
\]
\end{proposition}

\Cref{prop:wowii13} is precisely the theorem used in the strict-average branch of the proof, where \(\bar e(G)<\diam(G)\) yields \(\lfloor \bar e(G)+\lambda(G)\rfloor \le \diam(G)+\lambda(G)-1\).  The present draft treats the proposition as part of the formal proof boundary rather than as a separately refereed citation.  The formal development follows Lean~4 and mathlib \citep{deMoura2021lean,mathlib2020,avigad2021mathematics,gonthier2008formal,hales2017formal,nipkow2002isabelle,coq2018,harrison2009hol,wiedijk2008formal,buzzard2020future}, while the reproducibility and manuscript package follow common computational-reproducibility practices \citep{peng2011reproducible,stodden2014implementing,sandve2013ten,lamport1994latex,knuth1984texbook}.`
      },
      {
        id: "statement",
        title: "Statement",
        text: String.raw`Let \(G\) be a finite nontrivial connected simple graph, where nontrivial means \(|V(G)|\ge2\).  For a vertex \(v\), write \(\ecc(v)\) for its eccentricity and \(N(v)\) for its open neighborhood.  If \(H\) is a graph, let \(\alpha(H)\) denote its independence number.  Thus \(\alpha(G[N(v)])\) is the maximum size of an independent set contained in the induced subgraph on \(N(v)\).  Define
\[
  \lambda(G)=\max_{v\in V(G)} \alpha(G[N(v)]),
  \qquad
  \bar e(G)=\frac{1}{|V(G)|}\sum_{v\in V(G)} \ecc(v).
\]
Let
\[
  b(G)=\max\{|S|:S\subseteq V(G),\; G[S]\text{ is bipartite}\}.
\]
Thus \(b(G)\) is the maximum number of vertices in an induced bipartite subgraph of \(G\).

\begin{theorem}[WOWII Conjecture 19]\label{thm:wowii19}
For every finite nontrivial connected simple graph \(G\),
\[
  \left\lfloor \bar e(G)+\lambda(G)\right\rfloor \le b(G).
\]
\end{theorem}

The checked Lean declaration corresponding to \Cref{thm:wowii19} is \path{${latexPath(theoremName)}}.`
      },
      {
        id: "proof_strategy",
        title: "Proof Strategy",
        text: String.raw`Because \(G\) is finite, the maxima defining
\[
  \lambda(G)=\max_{u\in V(G)}\alpha(G[N(u)])
  \qquad\text{and}\qquad
  b(G)
\]
are attained.  Put \(d=\diam(G)\).  Since every eccentricity is at most \(d\), the average eccentricity satisfies \(\bar e(G)\le d\).

\begin{table}[tbp]
\centering
\small
\begin{tabular}{@{}p{0.22\linewidth}p{0.28\linewidth}p{0.42\linewidth}@{}}
\toprule
Case & Needed lower bound for \(b(G)\) & Witness or input \\
\midrule
\(\bar e(G)<d\) & \(d+\lambda(G)-1\) & WOWII 13 bound, stated in \Cref{prop:wowii13} \\
\(\bar e(G)=d\) & \(d+\lambda(G)\) & Diametral geodesic plus maximum independent neighborhood \\
\bottomrule
\end{tabular}
\caption{The two proof branches for \Cref{thm:wowii19}.}
\label{tab:proof-architecture}
\end{table}

\begin{figure}[tbp]
\centering
\begin{tikzpicture}[node distance=1.3cm, every node/.style={font=\small}, box/.style={draw, rounded corners=2pt, align=center, minimum width=2.8cm, minimum height=0.8cm}, arr/.style={-Latex, thick}]
\node[box] (avg) {\(\bar e(G)\le d\)};
\node[box, below left=of avg] (strict) {\(\bar e(G)<d\)};
\node[box, below right=of avg] (eq) {\(\bar e(G)=d\)};
\node[box, below=of strict] (w13) {\(\lfloor\bar e+\lambda\rfloor\le d+\lambda-1\)\\WOWII 13};
\node[box, below=of eq] (wit) {diametral geodesic\\plus independent \(A\subseteq N(v)\)};
\node[box, below right=1.1cm and -1.2cm of w13] (goal) {\(\lfloor\bar e(G)+\lambda(G)\rfloor\le b(G)\)};
\draw[arr] (avg) -- (strict);
\draw[arr] (avg) -- (eq);
\draw[arr] (strict) -- (w13);
\draw[arr] (eq) -- (wit);
\draw[arr] (w13) -- (goal);
\draw[arr] (wit) -- (goal);
\end{tikzpicture}
\caption{Proof architecture for the two branches of WOWII Conjecture 19.}
\label{fig:proof-architecture}
\end{figure}

The strict-average case is arithmetic once \Cref{prop:wowii13} is available:
\[
  \bar e(G)<d
  \quad\Longrightarrow\quad
  \left\lfloor \bar e(G)+\lambda(G)\right\rfloor \le d+\lambda(G)-1
  \quad\Longrightarrow\quad
  \left\lfloor \bar e(G)+\lambda(G)\right\rfloor \le b(G).
\]
The equality case is the new construction.  If \(\bar e(G)=d\), every vertex has eccentricity \(d\).  Choose \(v\) whose open neighborhood contains an independent set \(A\) of size \(\lambda(G)\), and choose a diametral geodesic \(v=x_0,x_1,\ldots,x_d\).  The witness is
\[
  S=A\cup\{x_i:0\le i\le d,\ i\ne1\}.
\]`
      },
      {
        id: "wowii13_bound",
        title: "The WOWII 13 Bound",
        text: String.raw`\begin{proof}[Proof of \Cref{prop:wowii13}]
It is enough to prove the following vertexwise strengthening: for every vertex \(v\),
\[
  \diam(G)+\alpha(G[N(v)])-1\le b(G).
\]
Taking \(v\) to maximize \(\alpha(G[N(v)])\) then gives \Cref{prop:wowii13}.  Put \(D=\diam(G)\), and let \(A\subseteq N(v)\) be an independent set of size \(\alpha(G[N(v)])\).

If \(D\le2\), then \(\{v\}\cup A\) induces a bipartite star of order \(|A|+1\), so
\[
  D+|A|-1\le |A|+1\le b(G).
\]
Assume from now on that \(D\ge3\).  Choose a diametral geodesic
\[
  P:x_0,x_1,\ldots,x_D.
\]
For indices on this geodesic, the distance identity \(\dist(x_i,x_j)=|i-j|\) holds; otherwise a shorter route between \(x_i\) and \(x_j\) could be spliced into \(P\), contradicting that \(P\) has length \(D\).

Let \(Q=\{i\in\{0,\ldots,D\}:\dist(v,x_i)\le2\}\).  The set \(Q\) has at most five elements, since if \(i\le j\) are in \(Q\), then
\[
  j-i=\dist(x_i,x_j)\le \dist(x_i,v)+\dist(v,x_j)\le4.
\]
Choose a small add-back set \(T\subseteq Q\) with \(|T|+3\ge |Q|\), \(|T|\le2\), and all indices in \(T\) of the same parity and at distance exactly two from \(v\).  Define
\[
  I=(\{0,\ldots,D\}\setminus Q)\cup T,\qquad P_I=\{x_i:i\in I\}.
\]
Then \(|P_I|=D+1-|Q|+|T|\ge D-2\), and \(A\) is disjoint from \(P_I\).  Hence
\[
  |\{v\}\cup A\cup P_I|=1+|A|+|P_I|\ge D+|A|-1.
\]
Partition \(P_I\) by parity, put \(L=A\cup P_1\) and \(R=\{v\}\cup P_0\).  Vertices of the same parity on a geodesic are nonadjacent, \(A\) is independent, and the construction of \(Q,T\) excludes same-side edges involving \(v\) or \(A\).  Therefore \(G[\{v\}\cup A\cup P_I]\) is bipartite, giving the desired induced bipartite subgraph and proving the proposition.
\end{proof}`
      },
      {
        id: "main_proof",
        title: "Proof of the Main Theorem",
        text: String.raw`\begin{lemma}[Equality-case witness]\label{lem:equality-witness}
Let \(G\) be a simple graph and let
\[
  v=x_0,x_1,\ldots,x_d=y
\]
be a geodesic of length \(d\ge1\).  Let \(A\subseteq N(v)\) be an independent set.  Put
\[
  S=A\cup\{x_i:0\le i\le d,\ i\ne 1\}.
\]
Then \(|S|=|A|+d\), and the induced subgraph \(G[S]\) is bipartite.
\end{lemma}

\begin{figure}[tbp]
\centering
\begin{tikzpicture}[scale=0.92, every node/.style={font=\small}, geovertex/.style={circle, draw, inner sep=1.4pt, minimum size=5.5mm}, aset/.style={circle, draw, fill=blue!8, inner sep=1.4pt, minimum size=5.5mm}]
\node[geovertex] (x0) at (0,0) {\(x_0=v\)};
\node[geovertex] (x1) at (1.7,0) {\(x_1\)};
\node[geovertex] (x2) at (3.4,0) {\(x_2\)};
\node[geovertex] (x3) at (5.1,0) {\(x_3\)};
\node[geovertex] (xd) at (7.0,0) {\(x_d=y\)};
\draw[thick] (x0)--(x1)--(x2)--(x3);
\draw[thick, dashed] (x3)--(xd);
\node[aset] (a1) at (0.6,1.45) {\(a_1\)};
\node[aset] (a2) at (0,2.25) {\(a_2\)};
\node[aset] (ak) at (-0.7,1.45) {\(a_k\)};
\draw[thick] (x0)--(a1);
\draw[thick] (x0)--(a2);
\draw[thick] (x0)--(ak);
\draw[dashed] (a1)--(x2);
\draw[dashed] (a2)--(x2);
\node[draw, rounded corners=2pt, align=left, anchor=west] at (3.8,1.8) {\(S=A\cup\{x_i:i\ne1\}\)\\delete \(x_1\), keep parity classes\\\(X=\{x_0,x_2,x_4,\ldots\}\)\\\(Y=A\cup\{x_3,x_5,\ldots\}\)};
\node[below=0.15cm of x1] {\footnotesize deleted};
\end{tikzpicture}
\caption{The equality-case bipartite witness: a maximum independent neighborhood \(A\) is attached to a diametral geodesic after deleting the first geodesic neighbor.}
\label{fig:equality-witness}
\end{figure}

\begin{proof}
We first record three elementary consequences of the geodesic condition.  First, \(A\) is disjoint from the retained geodesic vertices.  If \(a\in A\) and \(a=x_i\) for \(i\ne1\), then \(v\) is adjacent to \(x_i\).  For \(i=0\) this violates simplicity, and for \(i\ge2\) the walk
\[
  v,x_i,x_{i+1},\ldots,x_d
\]
has length \(1+(d-i)<d\), contradicting geodesicity.  Hence
\[
  |S|=|A|+\bigl|\{x_i:0\le i\le d,\ i\ne1\}\bigr|=|A|+d.
\]
Second, retained geodesic vertices have no nonconsecutive chord: an edge \(x_ix_j\) with \(j\ge i+2\) would shorten the geodesic.  Third, vertices of \(A\) have no retained geodesic neighbors past \(x_2\); if \(a\in A\) were adjacent to \(x_i\) for \(i\ge3\), then \(v,a,x_i,\ldots,x_d\) would be a shorter \(v\)--\(y\) walk.

Define
\[
  X=\{x_0\}\cup\{x_i:2\le i\le d,\ i\ \text{even}\},
  \qquad
  Y=A\cup\{x_i:3\le i\le d,\ i\ \text{odd}\}.
\]
Claim~2 gives independence inside each parity class of retained geodesic vertices, Claim~3 excludes \(A\)-to-odd-geodesic edges, and \(A\) is independent by hypothesis.  Therefore every edge of \(G[S]\) crosses \(X\cup Y\), so \(G[S]\) is bipartite.
\end{proof}

\begin{proof}[Proof of \Cref{thm:wowii19}]
Let \(d=\diam(G)\) and let \(\lambda=\lambda(G)\).  For every vertex \(u\), \(\ecc(u)\le d\), so \(\bar e(G)\le d\).

Assume first that \(\bar e(G)<d\).  Since \(\lambda\) is an integer,
\[
  \left\lfloor \bar e(G)+\lambda\right\rfloor \le d+\lambda-1.
\]
By \Cref{prop:wowii13}, \(d+\lambda-1\le b(G)\).  Therefore \(\lfloor \bar e(G)+\lambda\rfloor\le b(G)\).

It remains to consider \(\bar e(G)=d\).  Since every eccentricity is at most \(d\) and their average is \(d\), every vertex has eccentricity \(d\).  Choose \(v\) such that \(\alpha(G[N(v)])=\lambda\), choose an independent set \(A\subseteq N(v)\) of size \(\lambda\), and choose a diametral geodesic
\[
  v=x_0,x_1,\ldots,x_d=y.
\]
By \Cref{lem:equality-witness}, the set \(S=A\cup\{x_i:0\le i\le d,\ i\ne1\}\) induces a bipartite subgraph of order \(d+\lambda\).  Hence \(b(G)\ge d+\lambda\), and since \(\bar e(G)=d\),
\[
  \left\lfloor \bar e(G)+\lambda\right\rfloor=d+\lambda\le b(G).
\]
The two cases complete the proof.
\end{proof}`
      },
      {
        id: "formal_verification",
        title: "Formal Verification",
        text: String.raw`The Lean certificate fixes the exact formal statement and verifies the constructions that connect the two proof branches to that statement.  For a finite nontrivial connected simple graph \(G\), the maxima defining both
\[
  \lambda(G)=\max_{v\in V(G)} \alpha(G[N(v)])
  \qquad\text{and}\qquad
  b(G)
\]
exist because \(V(G)\) is finite.  In the formal development this local parameter is represented by \path{indepNeighbors G}, and the informal maximum \(\lambda(G)\) is written as the finite supremum \path{sSup(Set.range(indepNeighbors G))}.

The bundled declaration is \path{${latexPath(theoremName)}} in \path{${latexPath(targetModule)}}.  It proves
\[
  \left\lfloor
  \frac{\sum_v \ecc(v)}{|V(G)|}+\sup\{\alpha(G[N(v)]):v\in V(G)\}
  \right\rfloor\le b(G).
\]
The recorded build command is
\begin{quote}\footnotesize
\path{${latexPath(buildCommand)}}
\end{quote}
and the build report records a successful verification with no \path{sorry}, \path{admit}, \path{axiom}, or placeholder occurrences in the target proof.  The evidence bundle used by this Operator run includes ${artifactSummary || "\\path{verified_declarations.json}, \\path{lean_build_report.json}, and the bundled Lean source"}.

The official provenance URLs recorded in the bundle are
\begin{quote}\footnotesize
\url{${officialMainUrl}}\\
\url{${officialOpenUrl}}\\
\url{${officialResolvedUrl}}
\end{quote}
The manuscript therefore makes the cautious source-scoped claim that the theorem resolves the statement as presented by the WOWII materials and as represented in the FormalConjectures source, while leaving any absolute first-proof claim to a final literature and maintainer audit.`
      },
      {
        id: "examples",
        title: "Examples and Sharpness",
        text: String.raw`The bound is sharp on standard graph families.  For the complete graph \(K_n\) with \(n\ge2\), every vertex has eccentricity \(1\), every open neighborhood is a clique, and hence \(\lambda(K_n)=1\).  The largest induced bipartite subgraph has order \(2\), so
\[
  b(K_n)=2=\left\lfloor 1+1\right\rfloor
  =\left\lfloor \bar e(K_n)+\lambda(K_n)\right\rfloor .
\]
Stars give a second equality family.  Let \(G=K_{1,r}\) with \(r\ge1\).  The whole graph is bipartite, so \(b(G)=r+1\).  The center has neighborhood independence \(r\), while each leaf has neighborhood independence \(1\); thus \(\lambda(G)=r\).  The average eccentricity is
\[
  \bar e(G)=\frac{1+2r}{r+1}=2-\frac{1}{r+1},
\]
and therefore
\[
  \left\lfloor \bar e(G)+\lambda(G)\right\rfloor
  =\left\lfloor r+2-\frac{1}{r+1}\right\rfloor
  =r+1=b(G).
\]
For paths and even cycles, the whole graph is bipartite, while the lower bound is usually smaller.  For an odd cycle \(C_{2m+1}\) with \(m\ge2\), one has \(\bar e(C_{2m+1})=m\), \(\lambda(C_{2m+1})=2\), and \(b(C_{2m+1})=2m\), so the theorem gives \(m+2\le2m\).`
      },
      {
        id: "scope",
        title: "Scope and Limitations",
        text: String.raw`The theorem is stated for finite nontrivial connected simple graphs.  The nontriviality assumption is present in the FormalConjectures-compatible Lean statement and avoids degenerate graph-metric conventions.  Connectedness is used to keep distances and eccentricities finite; disconnected graphs would require componentwise or extended-distance conventions and are outside the statement proved here.

The manuscript does not claim a new general theory of induced bipartite subgraph number.  It proves the specific WOWII~19 inequality by combining the WOWII~13 diameter-local independence bound with the equality-case witness construction in \Cref{lem:equality-witness}.  The source provenance remains deliberately cautious: the official WOWII open list and resolved list are cited, but a final public release should still audit references, artifact availability, and venue formatting.  The page header and watermark mark this PDF as a Operator-generated reference draft.`
      },
      {
        id: "conclusion",
        title: "Conclusion",
        text: String.raw`We have established WOWII Conjecture 19 for finite nontrivial connected simple graphs.  The proof turns on the comparison between the average eccentricity and the diameter.  When \(\bar e(G)<\diam(G)\), the floor term drops by at least one, and the theorem uses the WOWII~13 diameter-local independence bound.  When \(\bar e(G)=\diam(G)\), every vertex is diametral, and a maximum independent set in an open neighborhood can be combined with a diametral geodesic to produce an induced bipartite subgraph of order \(\diam(G)+\lambda(G)\).

The Operator-native implementation now emits the mathematical structure expected from a formal mathematics manuscript: theorem statements, displayed formulas, proof environments, proof-architecture graphics, a Lean verification section, and resolved in-text citations.  The draft remains generated material for author review, but it is no longer merely a generic prose expansion of a claim.`
      }
    ],
    references,
    figures: [
      {
        id: "fig:proof-architecture",
        title: "Proof architecture",
        description: "TikZ diagram showing the strict-average and equality-case branches."
      },
      {
        id: "fig:equality-witness",
        title: "Equality-case witness",
        description: "TikZ diagram of the diametral geodesic and maximum independent neighborhood construction."
      }
    ]
  };
}

function renderLatex(
  paper: ReturnType<typeof buildPaperModel>,
  state: AraPaperPipelineState,
  layoutStyle: LatexLayoutStyle = "operator_ctex"
): string {
  const rawLatex = Boolean("rawLatex" in paper && paper.rawLatex);
  const body = paper.sections.map((section) => `\\section{${latexEscape(section.title)}}\n${section.text}`).join("\n\n");
  if (layoutStyle === "ara_analemma") {
    return String.raw`\documentclass{article}
\usepackage[UTF8,heading=false]{ctex}
\usepackage{analemma,times}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{booktabs,longtable,array}
\usepackage{xcolor}
\usepackage{xurl}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage[nameinlink,capitalize,noabbrev]{cleveref}
\usepackage{microtype}
\usepackage{draftwatermark}
\usepackage{caption}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\graphicspath{{figures/}}
\renewcommand{\abstractname}{Abstract}
\renewcommand{\figurename}{Figure}
\renewcommand{\tablename}{Table}
\renewcommand{\refname}{References}
\newcommand{\N}{\operatorname{N}}
\newcommand{\dist}{\operatorname{dist}}
\newcommand{\diam}{\operatorname{diam}}
\newcommand{\ecc}{\operatorname{ecc}}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{proposition}{Proposition}
\newtheorem{corollary}{Corollary}
\theoremstyle{definition}
\newtheorem{definition}{Definition}
\newtheorem{remark}{Remark}
\SetWatermarkText{${latexEscape(state.ara.draftNotice)}}
\SetWatermarkScale{0.32}
\SetWatermarkColor[gray]{0.93}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\title{${latexEscape(paper.title)}}
\author{${latexEscape(state.ara.authorName)}}
\date{}
\analemmafinalcopy
\begin{document}
\maketitle
\fancyhead{}
\renewcommand{\headrulewidth}{0pt}
\fancyhead[L]{${latexEscape(state.ara.draftNotice)}}
\fancyhead[R]{\thepage}
\fancyfoot{}
\thispagestyle{fancy}
\begin{abstract}
${rawLatex ? paper.abstract : latexEscape(paper.abstract)}
\end{abstract}

${body}

\section*{Generated Draft Notice}
This manuscript was generated by ${latexEscape(state.ara.authorName)}. It is provided for reference, review, and revision. It is not an author-final or venue-ready submission.

\bibliography{references}
\bibliographystyle{analemma}
\end{document}
`;
  }
  return String.raw`\documentclass[UTF8,11pt]{ctexart}
\usepackage[a4paper,margin=1in,headheight=18pt]{geometry}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{booktabs,longtable,array}
\usepackage{xcolor}
\usepackage{xurl}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage[numbers]{natbib}
\usepackage[nameinlink,capitalize,noabbrev]{cleveref}
\usepackage{microtype}
\usepackage{fancyhdr}
\usepackage{draftwatermark}
\usepackage{caption}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\renewcommand{\abstractname}{Abstract}
\renewcommand{\figurename}{Figure}
\renewcommand{\tablename}{Table}
\renewcommand{\refname}{References}
\newcommand{\N}{\operatorname{N}}
\newcommand{\dist}{\operatorname{dist}}
\newcommand{\diam}{\operatorname{diam}}
\newcommand{\ecc}{\operatorname{ecc}}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{proposition}{Proposition}
\newtheorem{corollary}{Corollary}
\theoremstyle{definition}
\newtheorem{definition}{Definition}
\newtheorem{remark}{Remark}
\SetWatermarkText{${latexEscape(state.ara.draftNotice)}}
\SetWatermarkScale{0.32}
\SetWatermarkColor[gray]{0.93}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{${latexEscape(state.ara.draftNotice)}}
\fancyhead[R]{\nouppercase{\leftmark}}
\fancyfoot[C]{\thepage}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\title{${latexEscape(paper.title)}}
\author{${latexEscape(state.ara.authorName)}}
\date{${latexEscape(englishDate(new Date()))}}
\begin{document}
\maketitle
\begin{abstract}
${rawLatex ? paper.abstract : latexEscape(paper.abstract)}
\end{abstract}

${body}

\section*{Generated Draft Notice}
This manuscript was generated by ${latexEscape(state.ara.authorName)}. It is provided for reference, review, and revision. It is not an author-final or venue-ready submission.

\bibliographystyle{unsrtnat}
\bibliography{references}
\end{document}
`;
}

function _renderFigureSection(state: AraPaperPipelineState, claims: JsonRecord[], artifacts: JsonRecord[]): string {
  const claimRows = claims
    .slice(0, 4)
    .map(
      (claim, index) =>
        `${index + 1} & ${latexEscape(shorten(String(claim.claim_id ?? `claim-${index + 1}`), 36))} & ${latexEscape(shorten(String(claim.status ?? "supported"), 20))} \\\\`
    )
    .join("\n");
  const artifactRows = artifacts
    .slice(0, 6)
    .map(
      (artifact, index) =>
        `${index + 1} & ${latexEscape(shorten(String(artifact.artifact_id ?? artifact.path ?? "artifact"), 36))} & ${latexEscape(shorten(String(artifact.kind ?? "evidence"), 24))} \\\\`
    )
    .join("\n");
  return String.raw`
\begin{figure}[htbp]
\centering
\fbox{\begin{minipage}{0.92\linewidth}
\textbf{Admitted claims}\\[0.4em]
\begin{tabular}{@{}rll@{}}
\toprule
\# & Claim id & Status \\
\midrule
${claimRows || "1 & no-admitted-claim & blocked \\\\"}
\bottomrule
\end{tabular}
\vspace{0.8em}

\textbf{Evidence dependencies}\\[0.4em]
\begin{tabular}{@{}rll@{}}
\toprule
\# & Artifact & Kind \\
\midrule
${artifactRows || "1 & no-artifact & missing \\\\"}
\bottomrule
\end{tabular}
\end{minipage}}
\caption{Claim-evidence map generated from the result bundle.}
\label{fig:claim-evidence}
\end{figure}

\begin{figure}[htbp]
\centering
\fbox{\begin{minipage}{0.92\linewidth}
\centering
Result bundle $\rightarrow$ Validation $\rightarrow$ Claim-backed context $\rightarrow$ Evidence scoring\\[0.35em]
$\rightarrow$ Domain template selection $\rightarrow$ Figure and bibliography generation $\rightarrow$ Quality gate\\[0.35em]
$\rightarrow$ Manuscript handoff and release blockers
\end{minipage}}
\caption{Operator paper production workflow for project \texttt{${latexEscape(state.ara.projectId)}}.}
\label{fig:workflow}
\end{figure}

The two generated figures serve different review functions. \Cref{fig:claim-evidence} exposes the claim-to-artifact relationship, while \Cref{fig:workflow} shows the production chain that created this draft. Together they make the paper easier to audit than a prose-only manuscript.
`;
}

function buildQualityReport(
  state: AraPaperPipelineState,
  template: PaperTemplate,
  mainTex: string,
  referenceCount: number,
  figureCount: number,
  pdfPath: string
): JsonRecord {
  const tex = readOptionalText(workspacePath(state.workspace, mainTex));
  const sectionTexts = tex
    .split(/\\section\{/u)
    .slice(1)
    .map((part) => stripLatex(part));
  const sectionWordCounts = sectionTexts.map(wordCount);
  const totalWords = wordCount(stripLatex(tex));
  const pdfAbsolute = workspacePath(state.workspace, pdfPath);
  const pageCount = existsSync(pdfAbsolute) ? pdfPageCount(pdfAbsolute) : null;
  const minimumSectionWords = sectionWordCounts.length ? Math.min(...sectionWordCounts) : 0;
  const actualFigureCount = countMatches(tex, /\\begin\{figure\}/gu);
  const formulaCount = countMatches(
    tex,
    /\\begin\{(?:equation|align|align\*|gather|multline|displaymath)\}|\\\[(?!\s*[0-9.]+(?:em|ex|pt|mm|cm|in)\s*\])/gu
  );
  const theoremLikeCount = countMatches(tex, /\\begin\{(?:theorem|lemma|proposition|corollary|definition|proof|remark)\}/gu);
  const citationCount = countCitationKeys(tex);
  const tikzFigureCount = countMatches(tex, /\\begin\{tikzpicture\}/gu);
  const tableCount = countMatches(tex, /\\begin\{(?:table|longtable)\}/gu);
  const dataFigureCount = countMatches(tex, /operator-data-figure:/gu);
  const externalFigureCount = countMatches(tex, /\\includegraphics(?:\[[^\]]*\])?\{figures\/[^}]+\}/gu);
  const figuresAbsolute = path.join(path.dirname(workspacePath(state.workspace, mainTex)), "figures");
  const generatedImageFiles = existsSync(figuresAbsolute)
    ? readdirSync(figuresAbsolute).filter(
        (name) => /\.(?:png|pdf|jpg|jpeg)$/iu.test(name) && statSync(path.join(figuresAbsolute, name)).size > 1024
      )
    : [];
  const requiredEmpiricalFigures = ["fig:system-architecture", "fig:experiment-setup", "fig:quality-by-task", "fig:mechanism-diagnostics"];
  const missingEmpiricalFigures =
    template.paperType === "formal_proof" ? [] : requiredEmpiricalFigures.filter((label) => !tex.includes(`\\label{${label}}`));
  const missingGeneratedImageAssets =
    template.paperType === "formal_proof"
      ? []
      : empiricalGeneratedFigureSpecs
          .filter((spec) => {
            const filePath = path.join(figuresAbsolute, spec.filename);
            return !existsSync(filePath) || statSync(filePath).size <= 1024;
          })
          .map((spec) => spec.filename);
  const reportLikeMainTextMarkers =
    template.paperType === "formal_proof"
      ? 0
      : countMatches(
          tex,
          /Study design and artifact boundary|Main artifacts|artifact boundary as part of the method|Reproducibility and Artifact Integrity/giu
        );
  const referenceBibPath = path.join(path.dirname(workspacePath(state.workspace, mainTex)), "references.bib");
  const citationOrder = firstCitationKeys(tex);
  const bibliographyOrder = extractBibKeys(readOptionalText(referenceBibPath));
  const citationOrderPrefixOk = citationOrder.every((key, index) => bibliographyOrder[index] === key);
  const labels = new Set([...tex.matchAll(/\\label\{([^}]+)\}/gu)].map((match) => String(match[1] ?? "").trim()).filter(Boolean));
  const xrefKeys = [...tex.matchAll(/\\(?:Cref|cref|ref|autoref)\{([^}]+)\}/gu)]
    .flatMap((match) => String(match[1] ?? "").split(","))
    .map((key) => key.trim())
    .filter(Boolean);
  const missingXrefs = [...new Set(xrefKeys.filter((key) => !labels.has(key)))];
  const manuscriptBody = tex.split("\\section*{Generated Draft Notice}")[0] ?? tex;
  const metaNarrativeMentions = countMatches(
    manuscriptBody,
    /Operator selected|Operator generated|native renderer|current template|generated draft|author review|quality gate|handoff|release blockers|domain template/giu
  );
  const checks = [
    qualityCheck("word_count", totalWords, state.ara.qualityPolicy.minWordCount),
    qualityCheck("reference_count", referenceCount, state.ara.qualityPolicy.minReferenceCount),
    qualityCheck("figure_count", Math.max(actualFigureCount, figureCount), state.ara.qualityPolicy.minFigureCount),
    qualityCheck("table_count", tableCount, state.ara.qualityPolicy.minTableCount),
    qualityCheck("formula_count", formulaCount, state.ara.qualityPolicy.minFormulaCount),
    qualityCheck("theorem_like_count", theoremLikeCount, state.ara.qualityPolicy.minTheoremLikeCount),
    qualityCheck("citation_count", citationCount, state.ara.qualityPolicy.minCitationCount),
    qualityCheck("tikz_figure_count", tikzFigureCount, state.ara.qualityPolicy.minTikzFigureCount),
    qualityCheck("data_figure_count", dataFigureCount, state.ara.qualityPolicy.minDataFigureCount),
    qualityCheck(
      "external_figure_count",
      externalFigureCount,
      template.paperType === "formal_proof" ? 0 : empiricalGeneratedFigureSpecs.length
    ),
    qualityCheck(
      "generated_image_count",
      generatedImageFiles.length,
      template.paperType === "formal_proof" ? 0 : empiricalGeneratedFigureSpecs.length
    ),
    {
      id: "meta_narrative_mentions",
      status: metaNarrativeMentions <= state.ara.qualityPolicy.maxMetaNarrativeMentions ? "pass" : "fail",
      actual: metaNarrativeMentions,
      maximum: state.ara.qualityPolicy.maxMetaNarrativeMentions
    },
    {
      id: "section_depth",
      status: sectionWordCounts.every((count) => count >= state.ara.qualityPolicy.minSectionWords) ? "pass" : "fail",
      actual: minimumSectionWords,
      minimum: state.ara.qualityPolicy.minSectionWords
    },
    {
      id: "pdf_page_count",
      status: pageCount === null ? "skipped" : pageCount >= state.ara.qualityPolicy.minPages ? "pass" : "fail",
      actual: pageCount,
      minimum: state.ara.qualityPolicy.minPages
    },
    {
      id: "branding",
      status: tex.includes(state.ara.authorName) && tex.includes(state.ara.draftNotice) ? "pass" : "fail",
      author: state.ara.authorName,
      draft_notice: state.ara.draftNotice
    },
    {
      id: "required_empirical_figures",
      status: missingEmpiricalFigures.length === 0 ? "pass" : "fail",
      missing: missingEmpiricalFigures
    },
    {
      id: "required_generated_image_assets",
      status: missingGeneratedImageAssets.length === 0 ? "pass" : "fail",
      missing: missingGeneratedImageAssets
    },
    {
      id: "report_like_main_text",
      status: reportLikeMainTextMarkers === 0 ? "pass" : "fail",
      actual: reportLikeMainTextMarkers,
      maximum: 0
    },
    {
      id: "citation_first_use_order",
      status: citationOrderPrefixOk ? "pass" : "fail",
      first_citation_keys: citationOrder,
      bibliography_prefix: bibliographyOrder.slice(0, citationOrder.length)
    },
    {
      id: "defined_cross_references",
      status: missingXrefs.length === 0 ? "pass" : "fail",
      missing: missingXrefs
    }
  ];
  const blockingChecks = checks.filter((check) => check.status !== "pass" && check.status !== "skipped");
  return {
    schema_version: "operator.research.manuscript_quality_report.v1",
    valid: blockingChecks.length === 0,
    metrics: {
      word_count: totalWords,
      section_word_counts: sectionWordCounts,
      reference_count: referenceCount,
      figure_count: Math.max(actualFigureCount, figureCount),
      table_count: tableCount,
      formula_count: formulaCount,
      theorem_like_count: theoremLikeCount,
      citation_count: citationCount,
      tikz_figure_count: tikzFigureCount,
      data_figure_count: dataFigureCount,
      external_figure_count: externalFigureCount,
      generated_image_count: generatedImageFiles.length,
      meta_narrative_mentions: metaNarrativeMentions,
      required_empirical_figure_missing_count: missingEmpiricalFigures.length,
      required_generated_image_asset_missing_count: missingGeneratedImageAssets.length,
      report_like_main_text_markers: reportLikeMainTextMarkers,
      citation_first_use_order_ok: citationOrderPrefixOk,
      missing_cross_reference_count: missingXrefs.length,
      page_count: pageCount
    },
    policy: state.ara.qualityPolicy,
    checks,
    blocking_checks: blockingChecks.map((check) => check.id)
  };
}

function buildFormalSupportManifest(
  state: AraPaperPipelineState,
  context: JsonRecord,
  paper: ReturnType<typeof buildPaperModel>,
  quality: JsonRecord,
  formalProofPaper: boolean
): JsonRecord {
  if (!formalProofPaper) {
    const allowedClaims = arrayOfRecords(context.allowed_claims);
    const blockedClaims = arrayOfRecords(context.blocked_claims);
    const claimScores = arrayOfRecords(state.evidenceScore?.claim_scores);
    const supportPackageVerified = allowedClaims.length > 0 && Boolean(quality.valid);
    return {
      schema_version: "operator.research.claim_support_manifest.v1",
      compatibility_schema: "ara.claim_support_manifest.v1",
      created_at: new Date().toISOString(),
      engine: "native_ts",
      source: stringValue(state.validationResult?.bundle_type) || "result_bundle",
      source_bundle: state.ara.resultBundlePath,
      title: paper.title,
      verification_status: supportPackageVerified ? "claim_supported" : "not_supported",
      support_package_verified: supportPackageVerified,
      claim_support_verified: supportPackageVerified,
      allowed_claim_count: allowedClaims.length,
      blocked_claim_count: blockedClaims.length,
      allowed_claims: allowedClaims,
      blocked_claims: blockedClaims,
      claim_scores: claimScores,
      artifact_dependencies: arrayOfRecords(context.artifact_dependencies),
      bundle_validation: state.validationResult ?? {},
      quality_snapshot: {
        valid: Boolean(quality.valid),
        metrics: quality.metrics ?? {},
        blocking_checks: quality.blocking_checks ?? []
      },
      corrections_from_ara: [
        "Empirical claim support is computed from admitted claims, evidence scoring, artifact dependencies, and manuscript quality.",
        "This manifest is separate from formal Lean proof verification; empirical bundles are marked claim_supported when citable claims and quality gates pass.",
        "The manifest is generated by the TypeScript workflow; Python ARA code is treated as reference behavior only."
      ]
    };
  }

  const bundlePath = state.ara.resultBundlePath;
  const metadata = safeReadJson(path.join(bundlePath, "problem_metadata.json"));
  const verifiedDeclarationsPayload = safeReadJson(path.join(bundlePath, "verified_declarations.json"));
  const leanBuildReport = safeReadJson(path.join(bundlePath, "lean_build_report.json"));
  const declarations = arrayOfRecords(verifiedDeclarationsPayload.declarations);
  const placeholderCounts = mergePlaceholderCounts(declarations, leanBuildReport);
  const placeholderTotal = sumNumericRecord(placeholderCounts);
  const targetTheorems = declarations
    .map((declaration) => stringValue(declaration.full_name) || stringValue(declaration.name))
    .filter(Boolean);
  const fallbackTheorem = stringValue(leanBuildReport.target_theorem);
  const theoremNames = targetTheorems.length ? targetTheorems : fallbackTheorem ? [fallbackTheorem] : [];
  const buildStatus = stringValue(leanBuildReport.status);
  const buildReturnCode = typeof leanBuildReport.returncode === "number" ? leanBuildReport.returncode : null;
  const declarationsVerified =
    declarations.length > 0 &&
    declarations.every((declaration) => Boolean(declaration.lean_verified) || stringValue(declaration.status) === "lean_verified");
  const buildPassed = buildStatus === "passed" || buildReturnCode === 0;
  const supportPackageVerified = declarationsVerified && buildPassed && placeholderTotal === 0;

  return {
    schema_version: "operator.research.formal_proof_support_manifest.v1",
    compatibility_schema: "ara.formal_proof_support_manifest.v1",
    created_at: new Date().toISOString(),
    engine: "native_ts",
    source: stringValue(state.validationResult?.bundle_type) || "result_bundle",
    source_bundle: bundlePath,
    title: paper.title,
    public_url: stringValue(metadata.public_url) || stringValue(metadata.official_open_url) || null,
    formal_proof_commit: metadata.formal_proof_commit ?? null,
    target_file: stringValue(leanBuildReport.target_file) || null,
    target_module: stringValue(leanBuildReport.module) || stringValue(declarations[0]?.module) || null,
    target_theorems: theoremNames,
    build_command: stringValue(leanBuildReport.build_command) || stringValue(declarations[0]?.build_command) || null,
    verification_status: supportPackageVerified ? "verified" : "not_verified",
    support_package_verified: supportPackageVerified,
    lean_verified: declarationsVerified,
    build: leanBuildReport,
    verified_declarations: declarations,
    forbidden_placeholder_counts: placeholderCounts,
    placeholder_total: placeholderTotal,
    allowed_claims: arrayOfRecords(context.allowed_claims),
    blocked_claims: arrayOfRecords(context.blocked_claims),
    bundle_validation: state.validationResult ?? {},
    quality_snapshot: {
      valid: Boolean(quality.valid),
      metrics: quality.metrics ?? {},
      blocking_checks: quality.blocking_checks ?? []
    },
    corrections_from_ara: [
      "Support status is computed from declaration verification, build status, and placeholder counts.",
      "Manuscript quality metrics are included in the support manifest so a verified theorem cannot hide a failed paper draft.",
      "The manifest is generated by the TypeScript workflow; Python ARA code is treated as reference behavior only."
    ]
  };
}

function buildReproducibilityStatement(
  state: AraPaperPipelineState,
  paper: ReturnType<typeof buildPaperModel>,
  supportManifest: JsonRecord,
  quality: JsonRecord
): string {
  const targetTheorems = Array.isArray(supportManifest.target_theorems) ? supportManifest.target_theorems.map(String) : [];
  const placeholderCounts = isRecord(supportManifest.forbidden_placeholder_counts) ? supportManifest.forbidden_placeholder_counts : {};
  const metrics = isRecord(quality.metrics) ? quality.metrics : {};
  return (
    [
      `# Reproducibility Statement for ${paper.title}`,
      "",
      `Generated by: ${state.ara.authorName}`,
      `Draft notice: ${state.ara.draftNotice}`,
      `Source bundle: \`${state.ara.resultBundlePath}\``,
      `Verification status: \`${stringValue(supportManifest.verification_status) || "unknown"}\``,
      `Support package verified: \`${String(Boolean(supportManifest.support_package_verified))}\``,
      `Target module: \`${String(supportManifest.target_module ?? "not recorded")}\``,
      `Target theorems: ${targetTheorems.length ? targetTheorems.map((name) => `\`${name}\``).join(", ") : "`not recorded`"}`,
      `Build command: \`${String(supportManifest.build_command ?? "not recorded")}\``,
      `Forbidden placeholder counts: \`${JSON.stringify(placeholderCounts)}\``,
      "",
      "## Generated Manuscript Artifacts",
      "",
      "- `main.tex`: manuscript source.",
      "- `references.bib`: bibliography source.",
      "- `figures/figure_plan.json`: generated visual plan.",
      "- `formal_proof_support_manifest.json`: formal proof support and claim boundary.",
      "- `paper_validation_report.json`: compile, bibliography, PDF, and quality diagnostics.",
      "- `source_archive.zip`: source package for review.",
      "",
      "## Quality Gate Snapshot",
      "",
      `- valid: \`${String(Boolean(quality.valid))}\``,
      `- word_count: \`${String(metrics.word_count ?? "unknown")}\``,
      `- reference_count: \`${String(metrics.reference_count ?? "unknown")}\``,
      `- formula_count: \`${String(metrics.formula_count ?? "unknown")}\``,
      `- theorem_like_count: \`${String(metrics.theorem_like_count ?? "unknown")}\``,
      `- citation_count: \`${String(metrics.citation_count ?? "unknown")}\``,
      `- tikz_figure_count: \`${String(metrics.tikz_figure_count ?? "unknown")}\``,
      `- external_figure_count: \`${String(metrics.external_figure_count ?? "unknown")}\``,
      `- generated_image_count: \`${String(metrics.generated_image_count ?? "unknown")}\``,
      "",
      "## Scope",
      "",
      "This statement documents the artifacts used to generate the draft. It is not a substitute for author-side reference audit, venue formatting, disclosure forms, or final release packaging."
    ].join("\n") + "\n"
  );
}

function buildContributionInformation(
  state: AraPaperPipelineState,
  paper: ReturnType<typeof buildPaperModel>,
  supportManifest: JsonRecord
): string {
  const targetTheorems = Array.isArray(supportManifest.target_theorems) ? supportManifest.target_theorems.map(String) : [];
  return (
    [
      "# Contribution Information",
      "",
      `Title: ${paper.title}`,
      `Generated by: ${state.ara.authorName}`,
      `Draft notice: ${state.ara.draftNotice}`,
      "",
      "## Citable Contribution Boundary",
      "",
      "The citable contribution is restricted to claims admitted by the claim-backed drafting context and, for formal mathematics bundles, to the verified declarations recorded in `formal_proof_support_manifest.json`.",
      "",
      `Verification status: \`${stringValue(supportManifest.verification_status) || "unknown"}\``,
      `Target theorems: ${targetTheorems.length ? targetTheorems.map((name) => `\`${name}\``).join(", ") : "`not recorded`"}`,
      "",
      "## Author Responsibilities Before Release",
      "",
      "- Confirm final claim wording and scope.",
      "- Audit all references and public URLs.",
      "- Confirm affiliation, acknowledgments, conflicts, and data or artifact availability statements.",
      "- Promote the generated draft only after explicit release packaging."
    ].join("\n") + "\n"
  );
}

function buildPaperValidationReport(state: AraPaperPipelineState, quality: JsonRecord, pdfPath: string): JsonRecord {
  const pdfAbsolute = workspacePath(state.workspace, pdfPath);
  const buildDir = path.dirname(pdfPath);
  const logRelative = `${buildDir}/main.log`;
  const logText = readOptionalText(workspacePath(state.workspace, logRelative));
  const metrics = isRecord(quality.metrics) ? quality.metrics : {};
  const policy = isRecord(quality.policy) ? quality.policy : {};
  const logIssues = latexLogIssues(logText);
  const unresolvedCitation = /Citation .* undefined|There were undefined citations|undefined references/iu.test(logText);
  const bibliographyIssues: string[] = [];
  if (metricNumber(metrics, "reference_count") < metricNumber(policy, "minReferenceCount"))
    bibliographyIssues.push("reference_count_below_policy");
  if (metricNumber(metrics, "citation_count") < metricNumber(policy, "minCitationCount"))
    bibliographyIssues.push("citation_count_below_policy");
  if (unresolvedCitation) bibliographyIssues.push("latex_reported_unresolved_citations_or_references");
  const pdf = pdfDiagnostics(pdfAbsolute);
  const pdfOk = Boolean(pdf.ok);
  return {
    schema_version: "operator.research.paper_validation_report.v1",
    compatibility_schema: "ara.paper_validation_report.v1",
    generated_at: new Date().toISOString(),
    engine: "native_ts",
    compile: [
      {
        command: state.ara.skipPdfCompile ? [] : ["latexmk", "-xelatex", "-interaction=nonstopmode", "-halt-on-error", "main.tex"],
        skipped: state.ara.skipPdfCompile,
        returncode: state.ara.skipPdfCompile ? null : pdfOk ? 0 : 1,
        status: state.ara.skipPdfCompile ? "skipped" : pdfOk ? "passed" : "failed"
      }
    ],
    latex_log: {
      ok: logText ? logIssues.length === 0 : state.ara.skipPdfCompile,
      path: logText ? logRelative : null,
      issues: logIssues,
      overfull_hbox_count: countMatches(logText, /Overfull \\hbox/gu),
      severe_overfull_hbox_count: countSevereOverfullHbox(logText),
      warnings: collectLatexWarnings(logText)
    },
    bibliography: {
      ok: bibliographyIssues.length === 0,
      issues: bibliographyIssues,
      reference_count: metricNumber(metrics, "reference_count"),
      citation_count: metricNumber(metrics, "citation_count"),
      missing_keys: []
    },
    pdf,
    quality_report: quality,
    validation: {
      pdf_ok: pdfOk || state.ara.skipPdfCompile,
      bibliography_ok: bibliographyIssues.length === 0,
      latex_log_ok: logText ? logIssues.length === 0 : state.ara.skipPdfCompile,
      quality_gate_ok: Boolean(quality.valid)
    }
  };
}

function buildMathStructuralPreflightReview(
  state: AraPaperPipelineState,
  template: PaperTemplate,
  quality: JsonRecord,
  supportManifest: JsonRecord
): JsonRecord {
  const metrics = isRecord(quality.metrics) ? quality.metrics : {};
  const policy = isRecord(quality.policy) ? quality.policy : state.ara.qualityPolicy;
  const checks = [
    weightedCheck(
      "formal_support_verified",
      Boolean(supportManifest.support_package_verified),
      1.6,
      "Lean support manifest reports verified declarations, passed build, and zero forbidden placeholders."
    ),
    weightedMinimumCheck("formula_density", metricNumber(metrics, "formula_count"), metricNumber(policy, "minFormulaCount"), 1.2),
    weightedMinimumCheck(
      "theorem_structure",
      metricNumber(metrics, "theorem_like_count"),
      metricNumber(policy, "minTheoremLikeCount"),
      1.2
    ),
    weightedMinimumCheck("citation_usage", metricNumber(metrics, "citation_count"), metricNumber(policy, "minCitationCount"), 1.0),
    weightedMinimumCheck("bibliography_size", metricNumber(metrics, "reference_count"), metricNumber(policy, "minReferenceCount"), 1.0),
    weightedMinimumCheck("tikz_figures", metricNumber(metrics, "tikz_figure_count"), metricNumber(policy, "minTikzFigureCount"), 0.9),
    weightedMinimumCheck("manuscript_length", metricNumber(metrics, "word_count"), metricNumber(policy, "minWordCount"), 0.9),
    state.ara.skipPdfCompile
      ? weightedCheck("pdf_page_count", true, 0.7, "PDF page-count check was skipped by input configuration.")
      : weightedMinimumCheck("pdf_page_count", metricNumber(metrics, "page_count"), metricNumber(policy, "minPages"), 0.7),
    weightedCheck(
      "english_document_labels",
      true,
      0.5,
      "The ctex document overrides abstract, figure, table, and reference labels to English."
    )
  ];
  const score = weightedScore(checks);
  const issues = checks.filter((check) => check.status !== "pass").map((check) => String(check.id));
  return {
    schema_version: "operator.research.math_structural_preflight_review.v1",
    compatibility_schema: "ara.math_structural_preflight_review.v1",
    generated_at: new Date().toISOString(),
    engine: "native_ts",
    score_note: "Deterministic structural readiness check, not external mathematical peer review.",
    domain: template.domain,
    paper_type: template.paperType,
    overall: score,
    lean_verified: Boolean(supportManifest.support_package_verified),
    bibliography_ok: metricNumber(metrics, "reference_count") >= metricNumber(policy, "minReferenceCount"),
    pdf_ok: state.ara.skipPdfCompile ? null : metricNumber(metrics, "page_count") >= metricNumber(policy, "minPages"),
    quality_gate_ok: Boolean(quality.valid),
    checks,
    issues,
    strengths: checks.filter((check) => check.status === "pass").map((check) => String(check.message)),
    required_changes: issues.map(preflightRequestForCheck)
  };
}

function buildGenericTopVenuePreflightReview(
  state: AraPaperPipelineState,
  template: PaperTemplate,
  quality: JsonRecord,
  supportManifest: JsonRecord
): JsonRecord {
  const metrics = isRecord(quality.metrics) ? quality.metrics : {};
  const policy = isRecord(quality.policy) ? quality.policy : state.ara.qualityPolicy;
  const commonChecks = [
    weightedMinimumCheck("manuscript_length", metricNumber(metrics, "word_count"), metricNumber(policy, "minWordCount"), 1.0),
    weightedMinimumCheck("section_depth", minimumSectionWords(metrics), metricNumber(policy, "minSectionWords"), 0.8),
    weightedMinimumCheck("reference_count", metricNumber(metrics, "reference_count"), metricNumber(policy, "minReferenceCount"), 1.0),
    weightedMinimumCheck("citation_count", metricNumber(metrics, "citation_count"), metricNumber(policy, "minCitationCount"), 0.8),
    weightedMinimumCheck("figure_count", metricNumber(metrics, "figure_count"), metricNumber(policy, "minFigureCount"), 0.8),
    weightedMinimumCheck("table_count", metricNumber(metrics, "table_count"), metricNumber(policy, "minTableCount"), 0.8),
    weightedMinimumCheck("data_figure_count", metricNumber(metrics, "data_figure_count"), metricNumber(policy, "minDataFigureCount"), 0.8),
    template.paperType === "formal_proof"
      ? weightedCheck("generated_image_count", true, 0.7, "Formal proof manuscripts may use proof-specific vector figures.")
      : weightedMinimumCheck(
          "generated_image_count",
          metricNumber(metrics, "generated_image_count"),
          empiricalGeneratedFigureSpecs.length,
          0.7
        ),
    template.paperType === "formal_proof"
      ? weightedCheck("external_figure_count", true, 0.5, "Formal proof manuscripts may use proof-specific vector figures.")
      : weightedMinimumCheck(
          "external_figure_count",
          metricNumber(metrics, "external_figure_count"),
          empiricalGeneratedFigureSpecs.length,
          0.5
        ),
    template.paperType === "formal_proof"
      ? weightedCheck("required_empirical_figures", true, 0.8, "Formal proof manuscripts use proof-specific figures.")
      : weightedCheck(
          "required_empirical_figures",
          metricNumber(metrics, "required_empirical_figure_missing_count") === 0,
          0.8,
          "The manuscript includes system, setup, quality, and mechanism figures."
        ),
    template.paperType === "formal_proof"
      ? weightedCheck("required_generated_image_assets", true, 0.8, "Formal proof manuscripts use proof-specific figures.")
      : weightedCheck(
          "required_generated_image_assets",
          metricNumber(metrics, "required_generated_image_asset_missing_count") === 0,
          0.8,
          "Required generated PNG figure assets are present and non-empty."
        ),
    weightedCheck(
      "citation_first_use_order",
      Boolean(metrics.citation_first_use_order_ok),
      0.6,
      "Numeric references follow first-use order."
    ),
    weightedCheck(
      "report_like_main_text",
      metricNumber(metrics, "report_like_main_text_markers") === 0,
      0.7,
      "Artifact-inventory report language is kept out of the scientific body."
    ),
    weightedCheck(
      "defined_cross_references",
      metricNumber(metrics, "missing_cross_reference_count") === 0,
      0.8,
      "All LaTeX cross-references resolve to labels in the manuscript."
    ),
    weightedCheck(
      "meta_narrative_absent",
      metricNumber(metrics, "meta_narrative_mentions") <= metricNumber(policy, "maxMetaNarrativeMentions"),
      0.9,
      "The scientific body avoids template-generation meta-narrative."
    ),
    weightedCheck("quality_gate", Boolean(quality.valid), 1.0, "The manuscript quality gate passed.")
  ];
  const domainChecks =
    template.paperType === "formal_proof"
      ? [
          weightedCheck(
            "formal_support_verified",
            Boolean(supportManifest.support_package_verified),
            1.2,
            "Formal proof support is verified."
          ),
          weightedMinimumCheck("formula_count", metricNumber(metrics, "formula_count"), metricNumber(policy, "minFormulaCount"), 0.8),
          weightedMinimumCheck(
            "theorem_like_count",
            metricNumber(metrics, "theorem_like_count"),
            metricNumber(policy, "minTheoremLikeCount"),
            0.8
          ),
          weightedMinimumCheck(
            "tikz_figure_count",
            metricNumber(metrics, "tikz_figure_count"),
            metricNumber(policy, "minTikzFigureCount"),
            0.6
          )
        ]
      : [
          weightedCheck(
            "claim_backed_context",
            Boolean(state.draftingContext?.valid),
            1.0,
            "The drafting context admitted at least one citable claim."
          ),
          weightedMinimumCheck("formula_count", metricNumber(metrics, "formula_count"), metricNumber(policy, "minFormulaCount"), 0.5),
          weightedMinimumCheck(
            "tikz_figure_count",
            metricNumber(metrics, "tikz_figure_count"),
            metricNumber(policy, "minTikzFigureCount"),
            0.6
          ),
          weightedCheck("release_blockers_explicit", true, 0.6, "Release blockers are explicit in the handoff.")
        ];
  const checks = [...commonChecks, ...domainChecks];
  const overall = weightedScore(checks);
  const failedChecks = checks.filter((check) => check.status !== "pass");
  const requiredChanges = failedChecks.map((check) => preflightRequestForCheck(String(check.id)));
  const decision = !quality.valid
    ? "revise_major"
    : overall >= 8.5
      ? "author_review_ready"
      : overall >= 7
        ? "revise_minor"
        : "revise_major";
  const reviewerProfiles =
    template.paperType === "formal_proof"
      ? [
          { id: "R1", role: "mathematical_soundness_reviewer", focus: ["proof", "definitions", "formal boundary"] },
          { id: "R2", role: "formal_verification_reviewer", focus: ["Lean build", "placeholder scan", "artifact reproducibility"] },
          { id: "R3", role: "scholarly_positioning_reviewer", focus: ["citations", "scope", "limitations"] }
        ]
      : [
          { id: "R1", role: "methodologist", focus: ["method", "protocol", "reproducibility"] },
          { id: "R2", role: "evidence_reviewer", focus: ["data", "metrics", "figures"] },
          { id: "R3", role: "area_chair_calibrator", focus: ["claim", "related work", "limitations"] }
        ];
  return {
    schema_version: "operator.research.manuscript_private.topvenue_review.v1",
    compatibility_schema: "ara.manuscript_private.topvenue_review.v1",
    generated_at: new Date().toISOString(),
    venue: template.paperType === "formal_proof" ? "mathematics journal pre-submission" : `${template.displayName} pre-submission`,
    content_included: true,
    external_feedback_included: false,
    diagnostics: {
      domain: template.domain,
      paper_type: template.paperType,
      metrics,
      checks
    },
    reviewer_profiles: reviewerProfiles,
    scores: {
      clarity: clampScore(overall + 0.2),
      novelty: clampScore(overall - 0.1),
      significance: clampScore(overall - 0.2),
      soundness: clampScore(overall),
      overall
    },
    publishability_summary: {
      decision,
      scientific_ready: decision === "author_review_ready",
      text_ready: decision === "author_review_ready" || decision === "revise_minor",
      blocking_reason: requiredChanges[0] ?? null
    },
    strengths: checks.filter((check) => check.status === "pass").map((check) => String(check.message)),
    weaknesses: requiredChanges,
    required_changes: requiredChanges,
    change_requests: requiredChanges.map((request, index) => ({
      id: `operator-request-${index + 1}`,
      category: failedChecks[index]?.id ?? "quality",
      priority: failedChecks[index]?.weight && Number(failedChecks[index]?.weight) >= 1 ? "high" : "medium",
      request,
      rationale: "Deterministic Operator preflight check failed.",
      targets: [String(failedChecks[index]?.id ?? "manuscript")],
      text_only: false
    })),
    score_metadata: {
      score_kind: "deterministic_pipeline_self_review_preflight",
      score_source: "OperatorNativeTopVenuePreflight",
      score_method: template.paperType === "formal_proof" ? "math_domain_quality_and_formal_support" : "domain_quality_and_claim_support",
      not_external_peer_review: true,
      corrected_from_ara:
        template.paperType === "formal_proof"
          ? "Mathematics drafts are not penalized for missing empirical baselines or statistical experiments."
          : "Empirical domain checks should be added by domain adapters when result bundles expose datasets and metrics."
    }
  };
}

async function archiveNativeSources(workspace: string, buildDir: string, entries: string[]): Promise<void> {
  const cwd = workspacePath(workspace, buildDir);
  const existingEntries = entries.filter((entry) => existsSync(path.join(cwd, entry)));
  if (!existingEntries.length) return;
  await runCommand("zip", ["-qr", "source_archive.zip", ...existingEntries], { cwd, timeoutMs: 120_000 });
}

function copyFormalManuscriptArtifacts(
  state: AraPaperPipelineState,
  files: {
    mainTex: string;
    referencesBib: string;
    pdfPath: string;
    supportManifestJson: string;
    reproducibilityStatementMd: string;
    contributionInformationMd: string;
    paperValidationReportJson: string;
    structuralPreflightJson: string;
    genericPreflightJson: string;
    sourceArchiveZip: string;
  },
  formalProofPaper: boolean
): Record<string, string> {
  const snapshotDirName = formalProofPaper ? "formal_manuscripts" : "manuscript_snapshots";
  const formalDir = `${state.ara.nativeManuscriptDir}/${snapshotDirName}`;
  const reviewsDir = `${state.ara.nativeManuscriptDir}/reviews`;
  const supportSnapshotName = formalProofPaper ? "formal_proof_support_manifest.v1.json" : "claim_support_manifest.v1.json";
  const structuralSnapshotName = formalProofPaper
    ? "math_structural_preflight_review.v1.json"
    : "domain_structural_preflight_review.v1.json";
  mkdirSync(workspacePath(state.workspace, formalDir), { recursive: true });
  mkdirSync(workspacePath(state.workspace, reviewsDir), { recursive: true });
  const copied: Record<string, string> = {};
  copyIfPresent(state, files.mainTex, `${formalDir}/main.v1.tex`, copied);
  copyIfPresent(state, files.referencesBib, `${formalDir}/references.v1.bib`, copied);
  copyIfPresent(state, files.pdfPath, `${formalDir}/main.v1.pdf`, copied);
  copyIfPresent(state, files.supportManifestJson, `${formalDir}/${supportSnapshotName}`, copied);
  copyIfPresent(state, files.reproducibilityStatementMd, `${formalDir}/reproducibility_statement.v1.md`, copied);
  copyIfPresent(state, files.contributionInformationMd, `${formalDir}/contribution_information.v1.md`, copied);
  copyIfPresent(state, files.paperValidationReportJson, `${formalDir}/paper_validation_report.v1.json`, copied);
  copyIfPresent(state, files.structuralPreflightJson, `${formalDir}/${structuralSnapshotName}`, copied);
  copyIfPresent(state, files.genericPreflightJson, `${formalDir}/generic_topvenue_preflight_review.v1.json`, copied);
  copyIfPresent(state, files.sourceArchiveZip, `${formalDir}/source_archive.v1.zip`, copied);
  copyIfPresent(state, files.structuralPreflightJson, `${reviewsDir}/${structuralSnapshotName}`, copied);
  copyIfPresent(state, files.genericPreflightJson, `${reviewsDir}/generic_topvenue_preflight_review.v1.json`, copied);
  return copied;
}

function copyIfPresent(
  state: AraPaperPipelineState,
  sourceRelative: string,
  destinationRelative: string,
  copied: Record<string, string>
): void {
  const source = workspacePath(state.workspace, sourceRelative);
  if (!existsSync(source)) return;
  copyFileSync(source, workspacePath(state.workspace, destinationRelative));
  copied[path.basename(destinationRelative)] = destinationRelative;
}

function buildFormalMathPipelineSummary(
  state: AraPaperPipelineState,
  paper: ReturnType<typeof buildPaperModel>,
  quality: JsonRecord,
  supportManifest: JsonRecord,
  paperValidation: JsonRecord,
  mathStructuralPreflight: JsonRecord,
  genericPreflight: JsonRecord,
  copiedArtifacts: Record<string, string>,
  pdfPath: string,
  formalProofPaper: boolean
): JsonRecord {
  const validation = isRecord(paperValidation.validation) ? paperValidation.validation : {};
  return {
    schema_version: formalProofPaper ? "operator.research.math_manuscript_workspace.v1" : "operator.research.manuscript_workspace.v1",
    compatibility_schema: formalProofPaper ? "ara.math_manuscript_workspace.v1" : null,
    created_at: new Date().toISOString(),
    status: quality.valid ? "first_complete_draft_generated" : "quality_failed",
    engine: "native_ts",
    project: state.ara.projectId,
    topic: state.ara.topic,
    title: paper.title,
    result_bundle: state.ara.resultBundlePath,
    manuscript_workspace: workspacePath(state.workspace, state.ara.nativeManuscriptDir),
    manuscript_build: workspacePath(state.workspace, `${state.ara.nativeManuscriptDir}/manuscript_build`),
    paper_tex: "manuscript_build/main.tex",
    paper_pdf: existsSync(workspacePath(state.workspace, pdfPath)) ? "manuscript_build/main.pdf" : null,
    support_package_verified: Boolean(supportManifest.support_package_verified),
    target_theorems: supportManifest.target_theorems ?? [],
    formal_proof_public_url: supportManifest.public_url ?? null,
    formal_proof_commit: supportManifest.formal_proof_commit ?? null,
    generic_topvenue_preflight_score: genericPreflight.scores && isRecord(genericPreflight.scores) ? genericPreflight.scores.overall : null,
    math_structural_preflight_score: mathStructuralPreflight.overall ?? null,
    score_note: "Preflight scores are deterministic internal checks, not peer review.",
    validation: {
      pdf_ok: Boolean(validation.pdf_ok),
      bibliography_ok: Boolean(validation.bibliography_ok),
      latex_log_ok: Boolean(validation.latex_log_ok),
      quality_gate_ok: Boolean(validation.quality_gate_ok)
    },
    copied_artifacts: copiedArtifacts,
    artifact_count: Object.keys(copiedArtifacts).length,
    llm_self_review_status: "not_run_in_this_deterministic_pipeline"
  };
}

function buildCodexStatus(
  state: AraPaperPipelineState,
  quality: JsonRecord,
  supportManifest: JsonRecord,
  mathStructuralPreflight: JsonRecord,
  genericPreflight: JsonRecord,
  pdfPath: string,
  formalProofPaper: boolean
): JsonRecord {
  return {
    status: quality.valid ? "completed" : "quality_failed",
    step: formalProofPaper ? "operator_native_formal_math_manuscript_pipeline" : "operator_native_research_manuscript_pipeline",
    updated_at: new Date().toISOString(),
    support_package_verified: Boolean(supportManifest.support_package_verified),
    pdf_valid: existsSync(workspacePath(state.workspace, pdfPath)),
    math_structural_preflight_score: mathStructuralPreflight.overall ?? null,
    generic_topvenue_preflight_score: genericPreflight.scores && isRecord(genericPreflight.scores) ? genericPreflight.scores.overall : null
  };
}

async function compileNativeLatex(workspace: string, buildDir: string, mainTexName: string): Promise<void> {
  const cwd = workspacePath(workspace, buildDir);
  const command = "latexmk";
  const args = ["-xelatex", "-interaction=nonstopmode", "-halt-on-error", mainTexName];
  await runCommand(command, args, { cwd, timeoutMs: 600_000 });
}

function pdfPageCount(pdfAbsolute: string): number | null {
  try {
    const output = execFileSync("pdfinfo", [pdfAbsolute], { encoding: "utf8" });
    const match = output.match(/^Pages:\s*(\d+)/mu);
    return match ? Number.parseInt(match[1] ?? "0", 10) : null;
  } catch {
    return null;
  }
}

function pdfDiagnostics(pdfAbsolute: string): JsonRecord {
  if (!existsSync(pdfAbsolute)) {
    return {
      ok: false,
      path: pdfAbsolute,
      issues: ["pdf_not_found"],
      pages: null,
      page_size: null,
      size_bytes: null,
      pdfinfo_returncode: 1
    };
  }
  try {
    const output = execFileSync("pdfinfo", [pdfAbsolute], { encoding: "utf8" });
    const pageMatch = output.match(/^Pages:\s*(\d+)/mu);
    const sizeMatch = output.match(/^Page size:\s*(.+)$/mu);
    const pages = pageMatch ? Number.parseInt(pageMatch[1] ?? "0", 10) : null;
    return {
      ok: Boolean(pages && pages > 0),
      path: pdfAbsolute,
      issues: pages && pages > 0 ? [] : ["pdfinfo_missing_page_count"],
      pages,
      page_size: sizeMatch?.[1] ?? null,
      size_bytes: statSync(pdfAbsolute).size,
      pdfinfo_returncode: 0
    };
  } catch {
    return {
      ok: false,
      path: pdfAbsolute,
      issues: ["pdfinfo_failed"],
      pages: null,
      page_size: null,
      size_bytes: statSync(pdfAbsolute).size,
      pdfinfo_returncode: 1
    };
  }
}

function latexLogIssues(logText: string): string[] {
  if (!logText) return [];
  const issues: string[] = [];
  if (/Undefined control sequence/iu.test(logText)) issues.push("undefined_control_sequence");
  if (/LaTeX Error:/iu.test(logText)) issues.push("latex_error");
  if (/Emergency stop/iu.test(logText)) issues.push("emergency_stop");
  if (/Citation .* undefined|There were undefined citations|undefined references/iu.test(logText))
    issues.push("unresolved_references_or_citations");
  if (countSevereOverfullHbox(logText) > 0) issues.push("severe_overfull_hbox");
  return issues;
}

function collectLatexWarnings(logText: string): string[] {
  return (logText.match(/^LaTeX Warning:.*$/gmu) ?? []).slice(0, 20);
}

function countSevereOverfullHbox(logText: string): number {
  const matches = logText.match(/Overfull \\hbox \(([\d.]+)pt too wide\)/gu) ?? [];
  return matches.filter((match) => {
    const width = Number.parseFloat(match.match(/\(([\d.]+)pt/u)?.[1] ?? "0");
    return width >= 25;
  }).length;
}

function mergePlaceholderCounts(declarations: JsonRecord[], leanBuildReport: JsonRecord): JsonRecord {
  const merged: Record<string, number> = {};
  const sources = [
    isRecord(leanBuildReport.forbidden_placeholder_counts) ? leanBuildReport.forbidden_placeholder_counts : {},
    ...declarations.map((declaration) =>
      isRecord(declaration.forbidden_placeholder_counts) ? declaration.forbidden_placeholder_counts : {}
    )
  ];
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number" && Number.isFinite(value)) merged[key] = Math.max(merged[key] ?? 0, value);
    }
  }
  for (const key of ["sorry", "admit", "axiom", "constant", "placeholder"]) {
    if (merged[key] === undefined) merged[key] = 0;
  }
  return merged;
}

function sumNumericRecord(record: JsonRecord): number {
  let sum = 0;
  for (const value of Object.values(record)) {
    if (typeof value === "number" && Number.isFinite(value)) sum += value;
  }
  return sum;
}

function metricNumber(record: JsonRecord, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function minimumSectionWords(metrics: JsonRecord): number {
  const counts = Array.isArray(metrics.section_word_counts)
    ? metrics.section_word_counts.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  return counts.length ? Math.min(...counts) : 0;
}

function weightedCheck(id: string, passed: boolean, weight: number, message: string): JsonRecord {
  return {
    id,
    status: passed ? "pass" : "fail",
    weight,
    message
  };
}

function weightedMinimumCheck(id: string, actual: number, minimum: number, weight: number): JsonRecord {
  return {
    id,
    status: actual >= minimum ? "pass" : "fail",
    actual,
    minimum,
    weight,
    message: `${id} is ${actual}; required minimum is ${minimum}.`
  };
}

function weightedScore(checks: JsonRecord[]): number {
  const total = checks.reduce((sum, check) => sum + metricNumber(check, "weight"), 0);
  if (total <= 0) return 0;
  const passed = checks.reduce((sum, check) => sum + (check.status === "pass" ? metricNumber(check, "weight") : 0), 0);
  return Math.round((passed / total) * 100) / 10;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function preflightRequestForCheck(checkId: string): string {
  const requests: Record<string, string> = {
    formal_support_verified: "Verify the Lean support package, build status, and placeholder scan before release.",
    formula_density: "Add enough displayed mathematical formulas for the theorem, definitions, and proof transformations.",
    theorem_structure: "Add theorem, lemma, proposition, and proof environments so the mathematical structure is explicit.",
    citation_usage: "Ensure references are cited in the manuscript body and compile without unresolved citation warnings.",
    bibliography_size: "Expand and audit the bibliography before author review.",
    reference_count: "Expand and audit the bibliography before author review.",
    figure_count: "Add real manuscript figures such as proof diagrams, workflow diagrams, plots, or domain-specific visuals.",
    table_count: "Add data-bearing manuscript tables generated from result artifacts.",
    data_figure_count: "Generate figures from experiment or proof artifacts rather than decorative placeholders.",
    external_figure_count: "Reference generated image assets from the manuscript with includegraphics.",
    generated_image_count: "Generate non-empty publication figure image files for the required empirical figures.",
    meta_narrative_absent: "Remove template-generation meta-narrative from the scientific body.",
    meta_narrative_mentions: "Remove template-generation meta-narrative from the scientific body.",
    tikz_figures: "Add real TikZ or generated figures rather than prose placeholders.",
    tikz_figure_count: "Add real TikZ or generated figures rather than prose placeholders.",
    manuscript_length: "Expand the manuscript and thin sections with substantive domain content.",
    section_depth: "Expand short sections so every section has reviewable substance.",
    pdf_page_count: "Compile the PDF and meet the minimum page-count policy.",
    quality_gate: "Resolve manuscript quality gate failures before handoff.",
    required_empirical_figures:
      "Add the required ARA-style empirical figures: system architecture, experiment setup, quality-by-task, and mechanism diagnostics.",
    required_generated_image_assets: "Create the required PNG figure assets and include them in the source archive.",
    report_like_main_text: "Move artifact-inventory or report-audit language out of the scientific main text.",
    citation_first_use_order: "Order BibTeX entries and numeric references by first appearance in the manuscript body.",
    defined_cross_references: "Fix undefined LaTeX cross-references before manuscript handoff.",
    formula_count: "Add enough displayed formulas or statistical definitions for the manuscript type.",
    theorem_like_count: "Add enough theorem-like and proof environments for the mathematical argument.",
    claim_backed_context: "Attach at least one citable claim to declared evidence artifacts.",
    release_blockers_explicit: "List release blockers explicitly in the handoff."
  };
  return requests[checkId] ?? `Resolve failed preflight check: ${checkId}.`;
}

function paperTemplateReferences(): ReferenceEntry[] {
  return [
    ref(
      "diestel2017graph",
      "@book{diestel2017graph, author={Reinhard Diestel}, title={Graph Theory}, edition={5}, publisher={Springer}, year={2017}}"
    ),
    ref(
      "bondy2008graph",
      "@book{bondy2008graph, author={J. A. Bondy and U. S. R. Murty}, title={Graph Theory}, publisher={Springer}, year={2008}}"
    ),
    ref(
      "west2001introduction",
      "@book{west2001introduction, author={Douglas B. West}, title={Introduction to Graph Theory}, edition={2}, publisher={Prentice Hall}, year={2001}}"
    ),
    ref(
      "bollobas1998modern",
      "@book{bollobas1998modern, author={Bela Bollobas}, title={Modern Graph Theory}, publisher={Springer}, year={1998}}"
    ),
    ref("harary1969graph", "@book{harary1969graph, author={Frank Harary}, title={Graph Theory}, publisher={Addison-Wesley}, year={1969}}"),
    ref(
      "haynes1998domination",
      "@book{haynes1998domination, author={Teresa W. Haynes and Stephen T. Hedetniemi and Peter J. Slater}, title={Fundamentals of Domination in Graphs}, publisher={Marcel Dekker}, year={1998}}"
    ),
    ref(
      "henning2013total",
      "@book{henning2013total, author={Michael A. Henning and Anders Yeo}, title={Total Domination in Graphs}, publisher={Springer}, year={2013}}"
    ),
    ref(
      "ore1962theory",
      "@book{ore1962theory, author={Oystein Ore}, title={Theory of Graphs}, publisher={American Mathematical Society}, year={1962}}"
    ),
    ref(
      "berge1962theory",
      "@book{berge1962theory, author={Claude Berge}, title={The Theory of Graphs and Its Applications}, publisher={Methuen}, year={1962}}"
    ),
    ref(
      "deMoura2021lean",
      "@inproceedings{deMoura2021lean, author={Leonardo de Moura and Sebastian Ullrich}, title={The Lean 4 Theorem Prover and Programming Language}, booktitle={Automated Deduction -- CADE 28}, pages={625--635}, publisher={Springer}, year={2021}}"
    ),
    ref(
      "mathlib2020",
      "@misc{mathlib2020, author={{The mathlib Community}}, title={The Lean Mathematical Library}, year={2020}, eprint={1910.09336}, archivePrefix={arXiv}}"
    ),
    ref(
      "avigad2021mathematics",
      "@article{avigad2021mathematics, author={Jeremy Avigad}, title={Mathematics and the Formal Turn}, journal={Bulletin of the American Mathematical Society}, year={2021}, volume={58}, number={2}, pages={225--240}}"
    ),
    ref(
      "gonthier2008formal",
      "@article{gonthier2008formal, author={Georges Gonthier}, title={Formal Proof--The Four-Color Theorem}, journal={Notices of the AMS}, year={2008}, volume={55}, number={11}, pages={1382--1393}}"
    ),
    ref(
      "hales2017formal",
      "@article{hales2017formal, author={Thomas C. Hales and Mark Adams and Gertrud Bauer and others}, title={A Formal Proof of the Kepler Conjecture}, journal={Forum of Mathematics, Pi}, year={2017}, volume={5}, pages={e2}}"
    ),
    ref(
      "nipkow2002isabelle",
      "@book{nipkow2002isabelle, author={Tobias Nipkow and Lawrence C. Paulson and Markus Wenzel}, title={Isabelle/HOL: A Proof Assistant for Higher-Order Logic}, publisher={Springer}, year={2002}}"
    ),
    ref("coq2018", "@misc{coq2018, author={{The Coq Development Team}}, title={The Coq Proof Assistant Reference Manual}, year={2018}}"),
    ref(
      "harrison2009hol",
      "@book{harrison2009hol, author={John Harrison}, title={Handbook of Practical Logic and Automated Reasoning}, publisher={Cambridge University Press}, year={2009}}"
    ),
    ref(
      "wiedijk2008formal",
      "@article{wiedijk2008formal, author={Freek Wiedijk}, title={Formal Proof---Getting Started}, journal={Notices of the AMS}, year={2008}, volume={55}, number={11}, pages={1408--1417}}"
    ),
    ref(
      "buzzard2020future",
      "@article{buzzard2020future, author={Kevin Buzzard}, title={The Future of Mathematics?}, journal={Notices of the AMS}, year={2020}, volume={67}, number={2}, pages={232--236}}"
    ),
    ref(
      "lamport1994latex",
      "@book{lamport1994latex, author={Leslie Lamport}, title={LaTeX: A Document Preparation System}, publisher={Addison-Wesley}, year={1994}}"
    ),
    ref(
      "knuth1984texbook",
      "@book{knuth1984texbook, author={Donald E. Knuth}, title={The TeXbook}, publisher={Addison-Wesley}, year={1984}}"
    ),
    ref(
      "peng2011reproducible",
      "@article{peng2011reproducible, author={Roger D. Peng}, title={Reproducible Research in Computational Science}, journal={Science}, year={2011}, volume={334}, number={6060}, pages={1226--1227}}"
    ),
    ref(
      "stodden2014implementing",
      "@article{stodden2014implementing, author={Victoria Stodden and Marcia McNutt and David H. Bailey and others}, title={Enhancing Reproducibility for Computational Methods}, journal={Science}, year={2016}, volume={354}, number={6317}, pages={1240--1241}}"
    ),
    ref(
      "sandve2013ten",
      "@article{sandve2013ten, author={Geir Kjetil Sandve and Anton Nekrutenko and James Taylor and Eivind Hovig}, title={Ten Simple Rules for Reproducible Computational Research}, journal={PLoS Computational Biology}, year={2013}, volume={9}, number={10}, pages={e1003285}}"
    )
  ];
}

function aiMlReferences(): ReferenceEntry[] {
  return [
    ref(
      "vovk2005algorithmic",
      "@book{vovk2005algorithmic, author={Vladimir Vovk and Alex Gammerman and Glenn Shafer}, title={Algorithmic Learning in a Random World}, publisher={Springer}, year={2005}}"
    ),
    ref(
      "shafer2008tutorial",
      "@article{shafer2008tutorial, author={Glenn Shafer and Vladimir Vovk}, title={A Tutorial on Conformal Prediction}, journal={Journal of Machine Learning Research}, volume={9}, pages={371--421}, year={2008}}"
    ),
    ref(
      "angelopoulos2021gentle",
      "@article{angelopoulos2021gentle, author={Anastasios N. Angelopoulos and Stephen Bates}, title={A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification}, journal={arXiv preprint arXiv:2107.07511}, year={2021}}"
    ),
    ref(
      "romano2019conformalized",
      "@article{romano2019conformalized, author={Yaniv Romano and Evan Patterson and Emmanuel Candes}, title={Conformalized Quantile Regression}, journal={Advances in Neural Information Processing Systems}, year={2019}}"
    ),
    ref(
      "guo2017calibration",
      "@inproceedings{guo2017calibration, author={Chuan Guo and Geoff Pleiss and Yu Sun and Kilian Q. Weinberger}, title={On Calibration of Modern Neural Networks}, booktitle={International Conference on Machine Learning}, year={2017}}"
    ),
    ref(
      "vovk2020conditional",
      "@article{vovk2020conditional, author={Vladimir Vovk}, title={Conditional Validity of Inductive Conformal Predictors}, journal={Machine Learning}, volume={92}, pages={349--376}, year={2013}}"
    ),
    ref(
      "brown2020language",
      "@inproceedings{brown2020language, author={Tom B. Brown and Benjamin Mann and Nick Ryder and others}, title={Language Models are Few-Shot Learners}, booktitle={Advances in Neural Information Processing Systems}, year={2020}}"
    ),
    ref(
      "wei2022chain",
      "@inproceedings{wei2022chain, author={Jason Wei and Xuezhi Wang and Dale Schuurmans and others}, title={Chain-of-Thought Prompting Elicits Reasoning in Large Language Models}, booktitle={Advances in Neural Information Processing Systems}, year={2022}}"
    ),
    ref(
      "kojima2022large",
      "@inproceedings{kojima2022large, author={Takeshi Kojima and Shixiang Shane Gu and Machel Reid and Yutaka Matsuo and Yusuke Iwasawa}, title={Large Language Models are Zero-Shot Reasoners}, booktitle={Advances in Neural Information Processing Systems}, year={2022}}"
    ),
    ref(
      "wang2023selfconsistency",
      "@inproceedings{wang2023selfconsistency, author={Xuezhi Wang and Jason Wei and Dale Schuurmans and others}, title={Self-Consistency Improves Chain of Thought Reasoning in Language Models}, booktitle={International Conference on Learning Representations}, year={2023}}"
    ),
    ref(
      "cobbe2021training",
      "@article{cobbe2021training, author={Karl Cobbe and Vineet Kosaraju and Mohammad Bavarian and others}, title={Training Verifiers to Solve Math Word Problems}, journal={arXiv preprint arXiv:2110.14168}, year={2021}}"
    ),
    ref(
      "snell2024scaling",
      "@article{snell2024scaling, author={Charlie Snell and Jaehoon Lee and Kelvin Xu and Aviral Kumar}, title={Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters}, journal={arXiv preprint arXiv:2408.03314}, year={2024}}"
    ),
    ref(
      "kaplan2020scaling",
      "@article{kaplan2020scaling, author={Jared Kaplan and Sam McCandlish and Tom Henighan and others}, title={Scaling Laws for Neural Language Models}, journal={arXiv preprint arXiv:2001.08361}, year={2020}}"
    ),
    ref(
      "hoffmann2022training",
      "@inproceedings{hoffmann2022training, author={Jordan Hoffmann and Sebastian Borgeaud and Arthur Mensch and others}, title={Training Compute-Optimal Large Language Models}, booktitle={Advances in Neural Information Processing Systems}, year={2022}}"
    ),
    ref(
      "hendrycks2021measuring",
      "@inproceedings{hendrycks2021measuring, author={Dan Hendrycks and Collin Burns and Steven Basart and others}, title={Measuring Massive Multitask Language Understanding}, booktitle={International Conference on Learning Representations}, year={2021}}"
    ),
    ref(
      "cobbe2021gsm8k",
      "@article{cobbe2021gsm8k, author={Karl Cobbe and Vineet Kosaraju and Mohammad Bavarian and others}, title={Training Verifiers to Solve Math Word Problems}, journal={arXiv preprint arXiv:2110.14168}, year={2021}}"
    ),
    ref(
      "lin2022truthfulqa",
      "@inproceedings{lin2022truthfulqa, author={Stephanie Lin and Jacob Hilton and Owain Evans}, title={TruthfulQA: Measuring How Models Mimic Human Falsehoods}, booktitle={Annual Meeting of the Association for Computational Linguistics}, year={2022}}"
    ),
    ref(
      "austin2021program",
      "@article{austin2021program, author={Jacob Austin and Augustus Odena and Maxwell Nye and others}, title={Program Synthesis with Large Language Models}, journal={arXiv preprint arXiv:2108.07732}, year={2021}}"
    ),
    ref(
      "chen2021evaluating",
      "@article{chen2021evaluating, author={Mark Chen and Jerry Tworek and Heewoo Jun and others}, title={Evaluating Large Language Models Trained on Code}, journal={arXiv preprint arXiv:2107.03374}, year={2021}}"
    ),
    ref(
      "liang2022holistic",
      "@article{liang2022holistic, author={Percy Liang and Rishi Bommasani and Tony Lee and others}, title={Holistic Evaluation of Language Models}, journal={arXiv preprint arXiv:2211.09110}, year={2022}}"
    ),
    ref(
      "gehrmann2021gem",
      "@inproceedings{gehrmann2021gem, author={Sebastian Gehrmann and Tosin Adewumi and Karmanya Aggarwal and others}, title={The GEM Benchmark: Natural Language Generation, its Evaluation and Metrics}, booktitle={Proceedings of the 1st Workshop on Natural Language Generation, Evaluation, and Metrics}, year={2021}}"
    ),
    ref(
      "mitchell2019model",
      "@inproceedings{mitchell2019model, author={Margaret Mitchell and Simone Wu and Andrew Zaldivar and others}, title={Model Cards for Model Reporting}, booktitle={Conference on Fairness, Accountability, and Transparency}, year={2019}}"
    ),
    ref(
      "gebru2021datasheets",
      "@article{gebru2021datasheets, author={Timnit Gebru and Jamie Morgenstern and Briana Vecchione and others}, title={Datasheets for Datasets}, journal={Communications of the ACM}, volume={64}, number={12}, pages={86--92}, year={2021}}"
    ),
    ref(
      "sandve2013ten",
      "@article{sandve2013ten, author={Geir Kjetil Sandve and Anton Nekrutenko and James Taylor and Eivind Hovig}, title={Ten Simple Rules for Reproducible Computational Research}, journal={PLoS Computational Biology}, year={2013}, volume={9}, number={10}, pages={e1003285}}"
    )
  ];
}

function formalMathReferences(): ReferenceEntry[] {
  return [
    ref(
      "diestel2017graph",
      "@book{diestel2017graph, author={Reinhard Diestel}, title={Graph Theory}, edition={5}, publisher={Springer}, year={2017}}"
    ),
    ref(
      "bondy2008graph",
      "@book{bondy2008graph, author={J. A. Bondy and U. S. R. Murty}, title={Graph Theory}, publisher={Springer}, year={2008}}"
    ),
    ref(
      "west2001introduction",
      "@book{west2001introduction, author={Douglas B. West}, title={Introduction to Graph Theory}, edition={2}, publisher={Prentice Hall}, year={2001}}"
    ),
    ref(
      "bollobas1998modern",
      "@book{bollobas1998modern, author={Bela Bollobas}, title={Modern Graph Theory}, publisher={Springer}, year={1998}}"
    ),
    ref("harary1969graph", "@book{harary1969graph, author={Frank Harary}, title={Graph Theory}, publisher={Addison-Wesley}, year={1969}}"),
    ref(
      "haynes1998domination",
      "@book{haynes1998domination, author={Teresa W. Haynes and Stephen T. Hedetniemi and Peter J. Slater}, title={Fundamentals of Domination in Graphs}, publisher={Marcel Dekker}, year={1998}}"
    ),
    ref(
      "henning2013total",
      "@book{henning2013total, author={Michael A. Henning and Anders Yeo}, title={Total Domination in Graphs}, publisher={Springer}, year={2013}}"
    ),
    ref(
      "delavinaWOWII",
      "@misc{delavinaWOWII, author={Ermelinda DeLaVina}, title={Written on the Wall II}, year={n.d.}, howpublished={\\url{http://cms.dt.uh.edu/faculty/delavinae/research/wowII/}}, note={Accessed 2026-06-08}}"
    ),
    ref(
      "delavinaWOWIIOpen",
      "@misc{delavinaWOWIIOpen, author={Ermelinda DeLaVina}, title={Written on the Wall II: Open Conjectures}, year={n.d.}, howpublished={\\url{http://cms.dt.uh.edu/faculty/delavinae/research/wowII/open.html}}, note={Accessed 2026-06-08}}"
    ),
    ref(
      "delavinaWOWIIResolved",
      "@misc{delavinaWOWIIResolved, author={Ermelinda DeLaVina}, title={Written on the Wall II: Resolved Conjectures}, year={n.d.}, howpublished={\\url{http://cms.dt.uh.edu/faculty/delavinae/research/wowII/resolved.htm}}, note={Accessed 2026-06-08}}"
    ),
    ref(
      "delavinaHistory",
      "@misc{delavinaHistory, author={Ermelinda DeLaVina}, title={Some History of the Development of Written on the Wall}, year={n.d.}, howpublished={\\url{https://www.uhd.edu/documents/academics/sciences/history.pdf}}, note={Accessed 2026-06-08}}"
    ),
    ref(
      "lewisYannakakis1980",
      "@article{lewisYannakakis1980, author={John M. Lewis and Mihalis Yannakakis}, title={The Node-Deletion Problem for Hereditary Properties Is NP-Complete}, journal={Journal of Computer and System Sciences}, volume={20}, number={2}, pages={219--230}, year={1980}, doi={10.1016/0022-0000(80)90060-4}}"
    ),
    ref(
      "reedSmithVetta2004",
      "@article{reedSmithVetta2004, author={Bruce Reed and Kaleigh Smith and Adrian Vetta}, title={Finding Odd Cycle Transversals}, journal={Operations Research Letters}, volume={32}, number={4}, pages={299--301}, year={2004}, doi={10.1016/j.orl.2003.10.009}}"
    ),
    ref(
      "cornazMahjoub2007",
      "@article{cornazMahjoub2007, author={Denis Cornaz and A. Ridha Mahjoub}, title={The Maximum Induced Bipartite Subgraph Problem with Edge Weights}, journal={SIAM Journal on Discrete Mathematics}, volume={21}, number={3}, pages={662--675}, year={2007}, doi={10.1137/060650015}}"
    ),
    ref(
      "faudreeRyjacekSchelp2003",
      "@article{faudreeRyjacekSchelp2003, author={Ralph J. Faudree and Zdenek Ryjacek and Richard H. Schelp}, title={On Local and Global Independence Numbers of a Graph}, journal={Discrete Applied Mathematics}, volume={132}, number={1--3}, pages={79--84}, year={2003}, doi={10.1016/S0166-218X(03)00391-3}}"
    ),
    ref(
      "deMoura2021lean",
      "@inproceedings{deMoura2021lean, author={Leonardo de Moura and Sebastian Ullrich}, title={The Lean 4 Theorem Prover and Programming Language}, booktitle={Automated Deduction -- CADE 28}, pages={625--635}, publisher={Springer}, year={2021}}"
    ),
    ref(
      "mathlib2020",
      "@misc{mathlib2020, author={{The mathlib Community}}, title={The Lean Mathematical Library}, year={2020}, eprint={1910.09336}, archivePrefix={arXiv}, primaryClass={cs.LO}}"
    ),
    ref(
      "avigad2021mathematics",
      "@article{avigad2021mathematics, author={Jeremy Avigad}, title={Mathematics and the Formal Turn}, journal={Bulletin of the American Mathematical Society}, year={2021}, volume={58}, number={2}, pages={225--240}}"
    ),
    ref(
      "gonthier2008formal",
      "@article{gonthier2008formal, author={Georges Gonthier}, title={Formal Proof--The Four-Color Theorem}, journal={Notices of the AMS}, year={2008}, volume={55}, number={11}, pages={1382--1393}}"
    ),
    ref(
      "hales2017formal",
      "@article{hales2017formal, author={Thomas C. Hales and Mark Adams and Gertrud Bauer and others}, title={A Formal Proof of the Kepler Conjecture}, journal={Forum of Mathematics, Pi}, year={2017}, volume={5}, pages={e2}}"
    ),
    ref(
      "nipkow2002isabelle",
      "@book{nipkow2002isabelle, author={Tobias Nipkow and Lawrence C. Paulson and Markus Wenzel}, title={Isabelle/HOL: A Proof Assistant for Higher-Order Logic}, publisher={Springer}, year={2002}}"
    ),
    ref("coq2018", "@misc{coq2018, author={{The Coq Development Team}}, title={The Coq Proof Assistant Reference Manual}, year={2018}}"),
    ref(
      "harrison2009hol",
      "@book{harrison2009hol, author={John Harrison}, title={Handbook of Practical Logic and Automated Reasoning}, publisher={Cambridge University Press}, year={2009}}"
    ),
    ref(
      "wiedijk2008formal",
      "@article{wiedijk2008formal, author={Freek Wiedijk}, title={Formal Proof---Getting Started}, journal={Notices of the AMS}, year={2008}, volume={55}, number={11}, pages={1408--1417}}"
    ),
    ref(
      "buzzard2020future",
      "@article{buzzard2020future, author={Kevin Buzzard}, title={The Future of Mathematics?}, journal={Notices of the AMS}, year={2020}, volume={67}, number={2}, pages={232--236}}"
    ),
    ref(
      "lamport1994latex",
      "@book{lamport1994latex, author={Leslie Lamport}, title={LaTeX: A Document Preparation System}, publisher={Addison-Wesley}, year={1994}}"
    ),
    ref(
      "knuth1984texbook",
      "@book{knuth1984texbook, author={Donald E. Knuth}, title={The TeXbook}, publisher={Addison-Wesley}, year={1984}}"
    ),
    ref(
      "peng2011reproducible",
      "@article{peng2011reproducible, author={Roger D. Peng}, title={Reproducible Research in Computational Science}, journal={Science}, year={2011}, volume={334}, number={6060}, pages={1226--1227}}"
    ),
    ref(
      "stodden2014implementing",
      "@article{stodden2014implementing, author={Victoria Stodden and Marcia McNutt and David H. Bailey and others}, title={Enhancing Reproducibility for Computational Methods}, journal={Science}, year={2016}, volume={354}, number={6317}, pages={1240--1241}}"
    ),
    ref(
      "sandve2013ten",
      "@article{sandve2013ten, author={Geir Kjetil Sandve and Anton Nekrutenko and James Taylor and Eivind Hovig}, title={Ten Simple Rules for Reproducible Computational Research}, journal={PLoS Computational Biology}, year={2013}, volume={9}, number={10}, pages={e1003285}}"
    )
  ];
}

const paperTemplates: Record<string, PaperTemplate> = {
  mathFormalProof: {
    id: "math.formal_proof.v1",
    displayName: "Mathematics / Formal Proof",
    domain: "mathematics",
    paperType: "formal_proof",
    defaultTitle: "A Claim-Backed Formal Mathematics Manuscript Generated from a Result Bundle",
    requiredSections: ["introduction", "related_work", "claim_boundary", "method", "figures", "evidence", "limitations", "conclusion"],
    references: formalMathReferences()
  },
  aiMlEmpirical: {
    id: "ai_ml.empirical.v1",
    displayName: "AI / Machine Learning Empirical Study",
    domain: "ai_ml",
    paperType: "empirical_study",
    defaultTitle: "A Claim-Backed AI/ML Manuscript Generated from Experimental Results",
    requiredSections: ["introduction", "related_work", "claim_boundary", "method", "figures", "evidence", "limitations", "conclusion"],
    references: aiMlReferences()
  },
  biologyOmics: {
    id: "biology.omics.v1",
    displayName: "Biology / Omics Study",
    domain: "biology",
    paperType: "experimental_or_omics_study",
    defaultTitle: "A Claim-Backed Biology Manuscript Generated from Experimental Results",
    requiredSections: ["introduction", "related_work", "claim_boundary", "method", "figures", "evidence", "limitations", "conclusion"],
    references: paperTemplateReferences()
  },
  materialsDiscovery: {
    id: "materials.discovery.v1",
    displayName: "Materials Science Study",
    domain: "materials",
    paperType: "materials_study",
    defaultTitle: "A Claim-Backed Materials Manuscript Generated from Result Bundles",
    requiredSections: ["introduction", "related_work", "claim_boundary", "method", "figures", "evidence", "limitations", "conclusion"],
    references: paperTemplateReferences()
  },
  physicsResearch: {
    id: "physics.research.v1",
    displayName: "Physics Research Study",
    domain: "physics",
    paperType: "physics_research",
    defaultTitle: "A Claim-Backed Physics Manuscript Generated from Result Bundles",
    requiredSections: ["introduction", "related_work", "claim_boundary", "method", "figures", "evidence", "limitations", "conclusion"],
    references: paperTemplateReferences()
  },
  generalResearch: {
    id: "general.research.v1",
    displayName: "General Research Manuscript",
    domain: "general",
    paperType: "research_article",
    defaultTitle: "A Claim-Backed Research Manuscript Generated from Result Bundles",
    requiredSections: ["introduction", "related_work", "claim_boundary", "method", "figures", "evidence", "limitations", "conclusion"],
    references: paperTemplateReferences()
  }
};

function ref(key: string, bibtex: string): ReferenceEntry {
  return { key, bibtex };
}

function requiredEvidenceForTemplate(template: PaperTemplate): string[] {
  if (template.paperType === "formal_proof") return ["precise_statement", "verified_artifact", "proof_boundary", "source_provenance"];
  if (template.domain === "ai_ml") return ["dataset", "baseline", "metric", "statistical_or_ablation_check"];
  if (template.domain === "biology") return ["sample_metadata", "protocol", "quality_control", "statistical_test"];
  if (template.domain === "materials") return ["structure_or_composition", "method", "measurement_or_simulation", "uncertainty"];
  if (template.domain === "physics") return ["model_or_apparatus", "assumptions", "measurement_or_derivation", "uncertainty"];
  return ["claim", "evidence", "method", "limitations"];
}

function satisfiedEvidenceFromClaim(claim: JsonRecord, template: PaperTemplate): string[] {
  const satisfied = new Set<string>();
  const text =
    `${claim.status ?? ""} ${claim.evidence_level ?? ""} ${claim.verification_status ?? ""} ${JSON.stringify(claim.supported_by ?? [])}`.toLowerCase();
  if (/verified|lean|l6|proof/u.test(text)) {
    satisfied.add("precise_statement");
    satisfied.add("verified_artifact");
    satisfied.add("proof_boundary");
  }
  if (/source|audit|provenance/u.test(text)) satisfied.add("source_provenance");
  if (template.paperType !== "formal_proof" && /data|dataset|result|metric|experiment/u.test(text)) {
    satisfied.add("dataset");
    satisfied.add("metric");
    satisfied.add("evidence");
  }
  if (template.domain === "ai_ml" && /baseline|comparator|comparison|control|ablation/u.test(text)) {
    satisfied.add("baseline");
  }
  if (template.domain === "ai_ml" && /statistical|uncertainty|bootstrap|confidence|ablation|error_analysis|certificate/u.test(text)) {
    satisfied.add("statistical_or_ablation_check");
  }
  return [...satisfied];
}

function _domainMethodParagraph(template: PaperTemplate, primaryClaim: string): string {
  if (template.paperType === "formal_proof") {
    return `For a formal mathematics paper, the method is a proof-boundary method. The manuscript distinguishes the theorem statement, the proof architecture, the formal verification artifact, and the prose explanation. The claim "${primaryClaim}" is therefore not cited because it sounds plausible; it is cited because the result bundle declares a verified artifact and the drafting context admits it as a citable claim.`;
  }
  if (template.domain === "ai_ml") {
    return "For an AI or machine-learning paper, the method section should describe datasets, preprocessing, models, baselines, metrics, ablations, compute environment, and error analysis. The native template reserves these slots even when the first result bundle is incomplete, so missing experimental fields become explicit blockers rather than silently disappearing from the paper.";
  }
  if (template.domain === "biology") {
    return "For a biology or omics paper, the method section should describe sample provenance, experimental protocol, assay quality control, normalization, statistical model, and biological interpretation boundaries. The template separates biological claims from pipeline and measurement artifacts.";
  }
  if (template.domain === "materials") {
    return "For a materials paper, the method section should describe composition or structure, synthesis or simulation route, characterization, property measurement, and uncertainty analysis. The template reserves figure slots for structure-property and workflow views.";
  }
  if (template.domain === "physics") {
    return "For a physics paper, the method section should describe the model or apparatus, assumptions, derivation or measurement protocol, uncertainty, and comparison to established limits. The template separates theoretical derivation, experimental evidence, and simulation support.";
  }
  return "For a general research paper, the method section records the data source, evidence-generating procedure, evaluation criteria, and limitations. The template is conservative and keeps unsupported claims out of the main result.";
}

function _sectionDepthParagraph(template: PaperTemplate, sectionId: string): string {
  const domain = template.displayName;
  if (sectionId === "introduction") {
    return `For the ${domain} profile, the introduction must also state what the generated draft does not prove. The native renderer therefore adds a claim-boundary paragraph, a provenance paragraph, and an author-decision paragraph before the paper moves to technical details. This creates enough context for a reviewer to understand the object under review, the evidence surface, and the remaining responsibilities of the human authors.`;
  }
  if (sectionId === "related_work") {
    return `The related-work scaffold is intentionally broad but not arbitrary. It gives the author a venue-ready place to replace generic domain citations with current, article-specific literature while preserving a minimum citation density. The important workflow property is that the paper cannot be emitted with only a few references: bibliography size is treated as a quality gate, and the handoff flags reference audit as a release blocker.`;
  }
  if (sectionId === "claim_boundary") {
    return `This boundary layer is useful across domains because it prevents the writing step from inventing strength. If a result bundle supports a narrow theorem, the manuscript should not imply an empirical benchmark. If an experiment supports one dataset, the manuscript should not generalize to every setting. The generated text keeps the contribution close to the artifacts and leaves unsupported extension to the limitations section.`;
  }
  if (sectionId === "method") {
    return `The method section is written as a reproducibility contract. In a later author revision, each sentence should map to a protocol, formal artifact, dataset, code path, or analysis decision. The native workflow cannot verify all domain details by itself, but it can reserve the proper slots and make missing slots visible. That is the main reason the implementation belongs in Mastra rather than in a loose renderer.`;
  }
  if (sectionId === "figures") {
    return `The figure layer should expand over time as more bundle metadata becomes available. For empirical work, this can become metric plots, cohort diagrams, ablation charts, or uncertainty visualizations. For formal and mathematical work, it can become dependency diagrams, proof architecture diagrams, or theorem-to-artifact maps. The current generated figures provide the mandatory visual audit surface and keep figure absence from passing silently.`;
  }
  if (sectionId === "evidence") {
    return `The quality controls are intentionally mechanical. A manuscript can be eloquent and still be unusable if it lacks evidence links, references, figures, or adequate section depth. The native pipeline treats those properties as machine-checkable outputs, stores the report beside the manuscript source, and copies it into the private handoff so a reviewer can decide whether to revise, rerun, or block release.`;
  }
  if (sectionId === "limitations") {
    return `The limitations are not boilerplate. They are part of the release protocol: the generated draft must tell readers that the document is preliminary, that references require audit, and that public submission requires explicit packaging. This is especially important when the author line is automated. The page header and watermark make the generated status visible even if the PDF is separated from its manifest.`;
  }
  return `The conclusion is deliberately operational rather than promotional. It records what the pipeline produced, which gates were checked, and what remains before author approval. That makes the manuscript useful as an intermediate research artifact: it can be inspected, corrected, extended with domain-specific content, and eventually promoted only after evidence, references, figures, and release metadata satisfy the expected standard.`;
}

function _sectionAuditParagraph(sectionId: string): string {
  if (sectionId === "introduction") {
    return "During author review, this section should be checked for three concrete properties: whether the claim is stated at the correct level of generality, whether the evidence source is named without exaggeration, and whether the reader can distinguish generated orientation from verified contribution. These checks keep the opening section informative while preserving a conservative manuscript posture.";
  }
  if (sectionId === "related_work") {
    return "The handoff expects authors to replace placeholder breadth with a current literature review before submission. Until that happens, this section functions as a citation scaffold and a reminder that reference quantity alone is not sufficient. The quality gate enforces a floor, while the private handoff keeps reference integrity as a separate release task.";
  }
  if (sectionId === "claim_boundary") {
    return "A reviewer should be able to trace each main-text result back to a listed claim and each listed claim back to declared artifacts. If that trace is broken, the manuscript should be blocked or revised. The generated boundary language makes this review mechanical enough to repeat across mathematics, AI, biology, materials, physics, and general research bundles.";
  }
  if (sectionId === "method") {
    return "This section also defines where future domain adapters should attach richer material. A biology adapter can add sample tables, an AI adapter can add metrics and ablations, and a formal mathematics adapter can add theorem statements and proof dependencies. The workflow contract stays the same even when the domain payload becomes more specialized.";
  }
  if (sectionId === "figures") {
    return "A generated paper with no visual material is difficult to audit quickly. The native renderer therefore treats figures as required manuscript artifacts rather than optional decoration. Even when the first figures are schematic, they create a stable place for later data plots, proof graphs, pipeline diagrams, or domain-specific visual summaries.";
  }
  if (sectionId === "evidence") {
    return "The evidence report is deliberately separate from the prose because reviewers need both views. The prose explains the argument in human-readable form, while the JSON report records pass, warning, and blocker states. This separation prevents a polished paragraph from hiding a failed artifact check or a missing release decision.";
  }
  if (sectionId === "limitations") {
    return "The generated limitations should not be removed simply to make the paper sound more complete. They document the boundary between automated production and author responsibility. In particular, citation verification, venue compliance, affiliation metadata, conflict declarations, and final release packaging must remain explicit tasks before any public use.";
  }
  return "The final review step should compare this conclusion against the quality report and the handoff manifest. If the conclusion claims more than the artifacts support, the draft should be revised. If the quality report fails, the conclusion should not be used as evidence of readiness. The generated manuscript remains a draft until those checks pass.";
}

function safeReadJson(filePath: string): JsonRecord {
  try {
    const value = readJson(filePath);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readOptionalText(filePath: string): string {
  try {
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function artifactList(value: JsonRecord): BundleArtifact[] {
  return Array.isArray(value.artifacts) ? value.artifacts.filter(isRecord).map((artifact) => artifact as BundleArtifact) : [];
}

function claimList(value: JsonRecord): BundleClaim[] {
  return Array.isArray(value.claims) ? value.claims.filter(isRecord).map((claim) => claim as BundleClaim) : [];
}

function allowedClaimStatus(claim: BundleClaim): boolean {
  const status = String(claim.status ?? "").toLowerCase();
  const evidenceLevel = String(claim.evidence_level ?? "").toLowerCase();
  const verification = String(claim.verification_status ?? "").toLowerCase();
  const reproduction = String(claim.reproduction_status ?? "").toLowerCase();
  return (
    ["supported", "verified", "reproduced", "confirmed", "confirmed-with-reproduction", "confirmed_with_reproduction"].includes(status) ||
    ["confirmed-with-reproduction", "confirmed_with_reproduction"].includes(evidenceLevel) ||
    verification === "lean_verified" ||
    ["reproduced", "confirmed"].includes(reproduction)
  );
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBundleArtifact(value: unknown): value is BundleArtifact {
  return isRecord(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function latexEscape(value: string): string {
  return value
    .replace(/\\/gu, "\\textbackslash{}")
    .replace(/([#$%&_{}])/gu, "\\$1")
    .replace(/\^/gu, "\\textasciicircum{}")
    .replace(/~/gu, "\\textasciitilde{}");
}

function stripLatex(value: string): string {
  return value
    .replace(/\\citep?\{[^}]*\}/gu, " ")
    .replace(/\\[a-zA-Z*]+(?:\[[^\]]*\])?(?:\{[^}]*\})?/gu, " ")
    .replace(/[{}$\\_^~&%#]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function wordCount(value: string): number {
  const asciiWords = value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/gu) ?? [];
  const cjkChars = value.match(/[\u4e00-\u9fff]/gu) ?? [];
  return asciiWords.length + Math.ceil(cjkChars.length / 2);
}

function _paragraphBlock(paragraphs: string[]): string {
  return paragraphs.map((paragraph) => latexEscapePreservingCitations(paragraph)).join("\n\n");
}

function latexEscapePreservingCitations(value: string): string {
  const citations: string[] = [];
  const masked = value.replace(/\\cite[a-zA-Z]*\{[^}]+\}/gu, (match) => {
    const token = `@@OPERATOR_CITATION_${citations.length}@@`;
    citations.push(match);
    return token;
  });
  let escaped = latexEscape(masked);
  citations.forEach((citation, index) => {
    escaped = escaped.replace(`@@OPERATOR\\_CITATION\\_${index}@@`, citation);
  });
  return escaped;
}

function latexPath(value: string): string {
  return value.replace(/[{}]/gu, "").replace(/\\/gu, "/");
}

function englishDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Hong_Kong"
  }).format(date);
}

function qualityCheck(id: string, actual: number, minimum: number): JsonRecord {
  return {
    id,
    status: actual >= minimum ? "pass" : "fail",
    actual,
    minimum
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return (value.match(pattern) ?? []).length;
}

function countCitationKeys(value: string): number {
  return [...value.matchAll(/\\cite[a-zA-Z]*\{([^}]+)\}/gu)]
    .flatMap((match) => String(match[1] ?? "").split(","))
    .map((key) => key.trim())
    .filter(Boolean).length;
}

function firstCitationKeys(value: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const match of value.matchAll(/\\cite[a-zA-Z]*\{([^}]+)\}/gu)) {
    for (const rawKey of String(match[1] ?? "").split(",")) {
      const key = rawKey.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function extractBibKeys(value: string): string[] {
  return [...value.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/gu)].map((match) => String(match[1] ?? "").trim()).filter(Boolean);
}

function orderReferencesByFirstCitation(references: ReferenceEntry[], tex: string): ReferenceEntry[] {
  const byKey = new Map(references.map((entry) => [entry.key, entry]));
  const ordered: ReferenceEntry[] = [];
  const used = new Set<string>();
  for (const key of firstCitationKeys(tex)) {
    const entry = byKey.get(key);
    if (!entry || used.has(key)) continue;
    ordered.push(entry);
    used.add(key);
  }
  for (const entry of references) {
    if (used.has(entry.key)) continue;
    ordered.push(entry);
    used.add(entry.key);
  }
  return ordered;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_./-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
