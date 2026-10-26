import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { knowledgeErrorResponse, searchPublicKnowledge } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-knowledge-search", points: 120, durationSeconds: 60 });
    const url = new URL(req.url);
    const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
    if (!query.trim()) return Response.json({ results: [] });
    const results = await searchPublicKnowledge({
      space: url.searchParams.get("space") || "dianji",
      query,
      resourceKind: url.searchParams.get("kind") || undefined,
      limit: Number(url.searchParams.get("limit") || 10)
    });
    return Response.json({ results });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return knowledgeErrorResponse(error);
  }
}
