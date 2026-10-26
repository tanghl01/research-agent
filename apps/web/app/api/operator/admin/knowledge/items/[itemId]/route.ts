import { z } from "zod";
import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { patchKnowledgeItem } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

const itemPatchSchema = z.object({
  title: z.string().min(1).optional(),
  resourceKind: z.string().min(1).optional(),
  category: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "archived", "deleted", "stale"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export async function PATCH(req: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-item-patch", points: 60, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const { itemId } = await context.params;
    const body = itemPatchSchema.parse(await req.json());
    return Response.json({ item: await patchKnowledgeItem(itemId, body) });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
