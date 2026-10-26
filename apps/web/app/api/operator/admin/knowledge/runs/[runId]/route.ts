import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { getKnowledgeRun } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-run", points: 120, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const { runId } = await context.params;
    return Response.json({ run: await getKnowledgeRun(runId) });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
