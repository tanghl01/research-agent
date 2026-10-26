import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { updateOperatorUserProfile } from "@/lib/operator-backend/session";

export const runtime = "nodejs";

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  safetyEmail: z.string().trim().email().max(254).optional().or(z.literal(""))
});

export async function PATCH(req: Request) {
  const backend = getOperatorBackendRuntimeStatus();
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-account-profile", points: 10, durationSeconds: 60 });
    if (!backend.enabled) {
      return Response.json({ error: "Operator backend is not available.", backend }, { status: 503 });
    }

    const body = await parseJsonBody(req, profileSchema);
    const user = await updateOperatorUserProfile(req, {
      displayName: body.displayName,
      safetyEmail: body.safetyEmail || null
    });

    return Response.json({
      backend,
      authenticated: true,
      user,
      bootstrapAvailable: backend.serviceConfigured,
      error: null
    });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, backend }, { status: message === "Authentication is required." ? 401 : 400 });
  }
}
