import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { listKnowledgeRuns } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-runs", points: 120, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const url = new URL(req.url);
    return Response.json({
      runs: await listKnowledgeRuns({
        sourceId: url.searchParams.get("sourceId") || undefined,
        limit: Number(url.searchParams.get("limit") || 20)
      })
    });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
