import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { adjustUserCredits, adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";

export const runtime = "nodejs";

const creditAdjustmentSchema = z.object({
  delta: z.coerce.number().int().min(-1_000_000_000).max(1_000_000_000),
  reason: z.string().trim().min(1).max(200).optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-admin-credit-adjust", points: 20, durationSeconds: 60 });
    const owner = await requirePlatformOwner(req);
    const { userId } = await params;
    const body = await parseJsonBody(req, creditAdjustmentSchema);
    return Response.json(await adjustUserCredits({ userId, delta: body.delta, reason: body.reason, actorUserId: owner.user.id }));
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
