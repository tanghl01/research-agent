import path from "node:path";
import { downloadServerArtifactForSession, ServerArtifactError } from "@/lib/operator-backend/artifacts";
import { officePngPreviewResponseFromBuffer, officePreviewExtensions, officePreviewMetadataResponseFromBuffer } from "@/lib/office-preview";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  const preview = url.searchParams.get("preview");

  try {
    const artifact = await downloadServerArtifactForSession(artifactId);
    if (preview === "metadata" && officePreviewExtensions.has(path.extname(artifact.record.filename).toLowerCase())) {
      return await officePreviewMetadataResponseFromBuffer(artifact.record.filename, artifact.body);
    }
    if (preview === "png" && officePreviewExtensions.has(path.extname(artifact.record.filename).toLowerCase())) {
      return await officePngPreviewResponseFromBuffer(artifact.record.filename, artifact.body, Number(url.searchParams.get("page") ?? "1"));
    }
    return new Response(new Uint8Array(artifact.body), {
      headers: {
        "content-type": artifact.record.content_type,
        "content-length": String(artifact.body.byteLength),
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(artifact.record.filename)}"`
      }
    });
  } catch (error) {
    if (error instanceof ServerArtifactError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
