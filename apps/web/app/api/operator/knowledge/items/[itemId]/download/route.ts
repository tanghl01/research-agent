import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { getPublicKnowledgeItem, knowledgeErrorResponse } from "@/lib/operator-backend/knowledge";
import { getObjectStorage } from "@/lib/operator-backend/object-storage";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    await consumeRateLimit(req, { namespace: "operator-knowledge-download", points: 120, durationSeconds: 60 });
    const { itemId } = await context.params;
    const row = await getPublicKnowledgeItem(itemId);
    if (!row.file) return Response.json({ error: "Knowledge item has no source file.", code: "KNOWLEDGE_FILE_NOT_FOUND" }, { status: 404 });
    const body = await getObjectStorage().getObject(row.file.bucket, row.file.objectKey);
    const headers = new Headers({
      "content-type": row.file.contentType,
      "content-length": String(body.byteLength)
    });
    if (new URL(req.url).searchParams.get("download") === "1") {
      headers.set("content-disposition", `attachment; filename="${encodeURIComponent(row.file.filename)}"`);
    }
    return new Response(body as unknown as BodyInit, { headers });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return knowledgeErrorResponse(error);
  }
}
