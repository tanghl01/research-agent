import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { knowledgeErrorResponse, listKnowledgeTemplates } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-knowledge-templates", points: 120, durationSeconds: 60 });
    const url = new URL(req.url);
    const templates = await listKnowledgeTemplates({
      space: url.searchParams.get("space") || "dianji",
      query: url.searchParams.get("q") || undefined,
      outputFormat: url.searchParams.get("format") || undefined,
      limit: Number(url.searchParams.get("limit") || 20)
    });
    return Response.json({ templates });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return knowledgeErrorResponse(error);
  }
}
