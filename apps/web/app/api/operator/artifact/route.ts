import { readFile } from "node:fs/promises";
import path from "node:path";
import { LegacyArtifactAccessError, resolveLegacyArtifactFile, writeLegacyArtifactFile } from "@/lib/local-artifact-access";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { responseContentTypeFromFilename } from "@/lib/file-metadata";
import { legacyLocalAccessDisabledResponse, isLegacyLocalOperatorAccessAllowed } from "@/lib/operator-local-access-policy";
import {
  officePdfPreviewResponse,
  officePngPreviewResponse,
  officePreviewExtensions,
  officePreviewMetadataResponse
} from "@/lib/office-preview";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace");
  const artifactPath = url.searchParams.get("path");
  const download = url.searchParams.get("download") === "1";
  const preview = url.searchParams.get("preview");
  const source = url.searchParams.get("source");

  if (!workspace || !artifactPath) {
    return Response.json({ error: "workspace and path are required" }, { status: 400 });
  }
  if (!isLegacyLocalOperatorAccessAllowed(source)) return legacyLocalAccessDisabledResponse();

  try {
    const filePath = resolveLegacyArtifactFile({ workspace, artifactPath });
    if (preview === "metadata" && officePreviewExtensions.has(path.extname(filePath).toLowerCase())) {
      return await officePreviewMetadataResponse(filePath);
    }
    if (preview === "png" && officePreviewExtensions.has(path.extname(filePath).toLowerCase())) {
      return await officePngPreviewResponse(filePath, Number(url.searchParams.get("page") ?? "1"));
    }
    if (preview === "pdf" && officePreviewExtensions.has(path.extname(filePath).toLowerCase())) {
      return await officePdfPreviewResponse(filePath);
    }
    const body = await readFile(filePath);
    const filename = path.basename(filePath);
    return new Response(body, {
      headers: {
        "content-type": responseContentTypeFromFilename(filename),
        "content-length": String(body.byteLength),
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(filename)}"`
      }
    });
  } catch (error) {
    if (error instanceof LegacyArtifactAccessError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace");
  const artifactPath = url.searchParams.get("path");
  const source = url.searchParams.get("source");

  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-legacy-artifact-update", points: 20, durationSeconds: 60 });
    if (!isLegacyLocalOperatorAccessAllowed(source)) return legacyLocalAccessDisabledResponse();
    const payload = (await req.json()) as { content?: unknown; contentBase64?: unknown };
    const result = await writeLegacyArtifactFile({ workspace, artifactPath, ...payload });
    return Response.json({
      ok: true,
      path: artifactPath,
      sizeBytes: result.sizeBytes,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    if (error instanceof LegacyArtifactAccessError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
