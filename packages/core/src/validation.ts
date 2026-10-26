import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ArtifactRecord, ValidationCheck } from "./types.js";
import { runCommand } from "./process.js";
import { readJson, relativeToWorkspace, repoRoot, workspacePath } from "./workspace.js";

export function validateFileExists(workspace: string, artifactPath: string): ValidationCheck {
  const absolute = workspacePath(workspace, artifactPath);
  if (!existsSync(absolute)) {
    throw new Error(`Expected file to exist: ${absolute}`);
  }
  return { type: "file_exists", status: "passed", path: relativeToWorkspace(workspace, absolute) };
}

export function validateMinFileSize(workspace: string, artifactPath: string, minBytes: number): ValidationCheck {
  const absolute = workspacePath(workspace, artifactPath);
  const size = statSync(absolute).size;
  if (size < minBytes) {
    throw new Error(`Expected ${absolute} to be at least ${minBytes} bytes, got ${size}`);
  }
  return {
    type: "min_file_size",
    status: "passed",
    path: relativeToWorkspace(workspace, absolute),
    size_bytes: size,
    min_bytes: minBytes
  };
}

export async function validatePptxSlideCount(workspace: string, artifactPath: string, minSlides: number): Promise<ValidationCheck> {
  const absolute = workspacePath(workspace, artifactPath);
  const result = await runCommand(process.env.PYTHON ?? "python3", [pptxInspectorScript(), "slide-count", absolute], {
    timeoutMs: 60_000
  });
  const actual = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(actual) || actual < minSlides) {
    throw new Error(`Expected at least ${minSlides} slides in ${absolute}, got ${result.stdout.trim()}`);
  }
  return {
    type: "pptx_slide_count",
    status: "passed",
    path: relativeToWorkspace(workspace, absolute),
    slide_count: actual,
    min_slides: minSlides
  };
}

export async function validatePptxSlideCountExact(
  workspace: string,
  artifactPath: string,
  expectedSlides: number
): Promise<ValidationCheck> {
  const absolute = workspacePath(workspace, artifactPath);
  const result = await runCommand(process.env.PYTHON ?? "python3", [pptxInspectorScript(), "slide-count", absolute], {
    timeoutMs: 60_000
  });
  const actual = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(actual) || actual !== expectedSlides) {
    throw new Error(`Expected exactly ${expectedSlides} slides in ${absolute}, got ${result.stdout.trim()}`);
  }
  return {
    type: "pptx_slide_count_exact",
    status: "passed",
    path: relativeToWorkspace(workspace, absolute),
    slide_count: actual,
    expected_slides: expectedSlides
  };
}

export async function validatePptxTextCoverage(params: {
  workspace: string;
  artifactPath: string;
  requiredTerms: string[];
  forbiddenTerms?: string[];
  minRequiredMatches?: number;
}): Promise<ValidationCheck> {
  const absolute = workspacePath(params.workspace, params.artifactPath);
  const payload = JSON.stringify({
    required_terms: uniqueTerms(params.requiredTerms),
    forbidden_terms: uniqueTerms(params.forbiddenTerms ?? [])
  });
  const result = await runCommand(process.env.PYTHON ?? "python3", [pptxInspectorScript(), "text-coverage", absolute, payload], {
    timeoutMs: 60_000
  });
  const report = JSON.parse(result.stdout) as {
    matched: string[];
    missing: string[];
    forbidden_hits: string[];
    text_chars: number;
  };
  const minRequiredMatches = Math.min(
    uniqueTerms(params.requiredTerms).length,
    params.minRequiredMatches ?? Math.min(3, uniqueTerms(params.requiredTerms).length)
  );
  if (report.matched.length < minRequiredMatches) {
    throw new Error(
      `PPTX text coverage failed for ${absolute}: matched ${report.matched.length}/${minRequiredMatches}; missing ${report.missing.join(", ")}`
    );
  }
  if (report.forbidden_hits.length) {
    throw new Error(`PPTX contains forbidden generic placeholder text: ${report.forbidden_hits.join(", ")}`);
  }
  return {
    type: "pptx_text_coverage",
    status: "passed",
    path: relativeToWorkspace(params.workspace, absolute),
    matched_terms: report.matched,
    missing_terms: report.missing,
    forbidden_hits: report.forbidden_hits,
    text_chars: report.text_chars,
    min_required_matches: minRequiredMatches
  };
}

export async function validatePptxImageCount(workspace: string, artifactPath: string, minImages: number): Promise<ValidationCheck> {
  const absolute = workspacePath(workspace, artifactPath);
  const result = await runCommand(process.env.PYTHON ?? "python3", [pptxInspectorScript(), "image-count", absolute], {
    timeoutMs: 60_000
  });
  const actual = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(actual) || actual < minImages) {
    throw new Error(`Expected at least ${minImages} images in ${absolute}, got ${result.stdout.trim()}`);
  }
  return {
    type: "pptx_image_count",
    status: "passed",
    path: relativeToWorkspace(workspace, absolute),
    image_count: actual,
    min_images: minImages
  };
}

export function validateHtmlSlideCount(workspace: string, artifactPath: string, minSlides: number): ValidationCheck {
  const absolute = workspacePath(workspace, artifactPath);
  const content = String(readJsonOrText(absolute)).replace(/<!--[\s\S]*?-->/gu, "");
  const actual = (content.match(/<section\b[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>/giu) ?? []).length;
  if (actual < minSlides) {
    throw new Error(`Expected at least ${minSlides} slides in ${absolute}, got ${actual}`);
  }
  return {
    type: "html_slide_count",
    status: "passed",
    path: relativeToWorkspace(workspace, absolute),
    slide_count: actual,
    min_slides: minSlides
  };
}

export function validateArtifactManifestContains(workspace: string, manifestPath: string, artifactType: string): ValidationCheck {
  const absolute = workspacePath(workspace, manifestPath);
  const manifest = readJson<{ artifacts?: ArtifactRecord[] }>(absolute);
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!artifacts.some((artifact) => artifact.type === artifactType)) {
    throw new Error(`Artifact manifest ${absolute} does not include type ${artifactType}`);
  }
  return {
    type: "artifact_manifest_contains",
    status: "passed",
    path: relativeToWorkspace(workspace, absolute),
    artifact_type: artifactType
  };
}

function readJsonOrText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function uniqueTerms(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pptxInspectorScript(): string {
  return path.join(repoRoot(), "packages/core/scripts/pptx_inspect.py");
}
