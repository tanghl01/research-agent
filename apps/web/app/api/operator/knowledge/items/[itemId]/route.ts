import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { getPublicKnowledgeItem, knowledgeErrorResponse } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    await consumeRateLimit(req, { namespace: "operator-knowledge-item", points: 120, durationSeconds: 60 });
    const { itemId } = await context.params;
    const row = await getPublicKnowledgeItem(itemId);
    return Response.json({
      item: row.item,
      version: row.version,
      file: row.file
    });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return knowledgeErrorResponse(error);
  }
}
