import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LegacyArtifactAccessError } from "@/lib/local-artifact-access";

const execFileAsync = promisify(execFile);

export const officePreviewExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);

export type OfficePreviewMetadata = {
  pageCount: number;
};

export async function officePdfPreviewResponse(filePath: string): Promise<Response> {
  const pdfPath = await convertOfficeArtifactToPdf(filePath);
  const body = await readFile(pdfPath);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(body.byteLength),
      "content-disposition": `inline; filename="${encodeURIComponent(path.basename(filePath, path.extname(filePath)))}.pdf"`
    }
  });
}

export async function officePngPreviewResponse(filePath: string, page = 1): Promise<Response> {
  const metadata = await officePreviewMetadata(filePath);
  const safePage = clampPage(page, metadata.pageCount);
  const pngPath = await convertOfficeArtifactToPng(filePath, safePage);
  const body = await readFile(pngPath);
  return pngResponse(body, path.basename(filePath, path.extname(filePath)), safePage, metadata.pageCount);
}

export async function officePngPreviewResponseFromBuffer(filename: string, body: Buffer, page = 1): Promise<Response> {
  const sourcePath = await cachedOfficeSourceFile(filename, body);
  return officePngPreviewResponse(sourcePath, page);
}

export async function officePreviewMetadataResponse(filePath: string): Promise<Response> {
  const metadata = await officePreviewMetadata(filePath);
  return Response.json(metadata);
}

export async function officePreviewMetadataResponseFromBuffer(filename: string, body: Buffer): Promise<Response> {
  const sourcePath = await cachedOfficeSourceFile(filename, body);
  return officePreviewMetadataResponse(sourcePath);
}

async function cachedOfficeSourceFile(filename: string, body: Buffer): Promise<string> {
  const extension = path.extname(filename).toLowerCase();
  const basename = path.basename(filename, extension) || "artifact";
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const outputDir = path.join(os.tmpdir(), "operator-artifact-previews", bodyHash);
  const sourcePath = path.join(outputDir, `${basename}${extension || ".pptx"}`);
  if (existsSync(sourcePath)) return sourcePath;
  await mkdir(outputDir, { recursive: true });
  await writeFile(sourcePath, body);
  return sourcePath;
}

async function convertOfficeArtifactToPdf(filePath: string): Promise<string> {
  const sourceStat = await stat(filePath);
  const cacheKey = createHash("sha256").update(`${filePath}:${sourceStat.size}:${sourceStat.mtimeMs}`).digest("hex");
  const outputDir = path.join(os.tmpdir(), "operator-artifact-previews", cacheKey);
  const outputPath = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
  if (existsSync(outputPath)) return outputPath;

  await mkdir(outputDir, { recursive: true });
  try {
    await execFileAsync(
      "soffice",
      ["--headless", "--nologo", "--nofirststartwizard", "--convert-to", "pdf", "--outdir", outputDir, filePath],
      { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 }
    );
  } catch (error) {
    if (existsSync(outputPath)) return outputPath;
    throw new LegacyArtifactAccessError(
      `office preview conversion failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
      "LEGACY_ARTIFACT_PREVIEW_FAILED"
    );
  }

  if (!existsSync(outputPath)) {
    throw new LegacyArtifactAccessError("office preview conversion did not produce a PDF", 500, "LEGACY_ARTIFACT_PREVIEW_FAILED");
  }
  return outputPath;
}

async function officePreviewMetadata(filePath: string): Promise<OfficePreviewMetadata> {
  const pdfPath = await convertOfficeArtifactToPdf(filePath);
  try {
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath], {
      timeout: 15_000,
      maxBuffer: 512 * 1024
    });
    const pageCount = Number(/^Pages:\s+(\d+)/imu.exec(stdout)?.[1] ?? "1");
    return { pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1 };
  } catch (error) {
    throw new LegacyArtifactAccessError(
      `office preview metadata failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
      "LEGACY_ARTIFACT_PREVIEW_FAILED"
    );
  }
}

async function convertOfficeArtifactToPng(filePath: string, page: number): Promise<string> {
  const pdfPath = await convertOfficeArtifactToPdf(filePath);
  const outputDir = path.dirname(pdfPath);
  const outputPrefix = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}-page-${page}`);
  const outputPath = `${outputPrefix}.png`;
  if (existsSync(outputPath)) return outputPath;

  try {
    await execFileAsync("pdftoppm", ["-png", "-singlefile", "-r", "144", "-f", String(page), "-l", String(page), pdfPath, outputPrefix], {
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024
    });
  } catch (error) {
    throw new LegacyArtifactAccessError(
      `office preview image conversion failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
      "LEGACY_ARTIFACT_PREVIEW_FAILED"
    );
  }

  if (!existsSync(outputPath)) {
    throw new LegacyArtifactAccessError("office preview image conversion did not produce a PNG", 500, "LEGACY_ARTIFACT_PREVIEW_FAILED");
  }
  return outputPath;
}

function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(pageCount, 1));
}

function pngResponse(body: Buffer, basename: string, page: number, pageCount: number): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "image/png",
      "content-length": String(body.byteLength),
      "content-disposition": `inline; filename="${encodeURIComponent(`${basename}-page-${page}`)}.png"`,
      "x-operator-preview-page": String(page),
      "x-operator-preview-page-count": String(pageCount)
    }
  });
}
