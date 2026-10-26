import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { enqueueKnowledgeSourceRun, getKnowledgeSource } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    mode: z.enum(["queue", "inline"]).optional(),
    runType: z.enum(["manual", "scheduled", "full_rescan"]).optional()
  })
  .optional();

export async function POST(req: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-run", points: 20, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const { sourceId } = await context.params;
    await getKnowledgeSource(sourceId);
    const body = await parseJsonBody(req, bodySchema).catch(() => undefined);
    const payload = { sourceId, runType: body?.runType ?? "manual", trigger: "admin" } as const;
    return Response.json({ job: await enqueueKnowledgeSourceRun(payload), mode: "queue" }, { status: 202 });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
