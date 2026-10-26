import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { ensureDianjiKnowledgeSource } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-bootstrap", points: 20, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const source = await ensureDianjiKnowledgeSource();
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
