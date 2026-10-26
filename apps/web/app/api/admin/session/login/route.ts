import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { adminErrorResponse, loginPlatformOwnerWithEmail } from "@/lib/operator-backend/admin";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";

export const runtime = "nodejs";

const adminLoginSchema = z.object({
  email: z.string().email()
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-admin-login", points: 5, durationSeconds: 60 });
    const body = await parseJsonBody(req, adminLoginSchema);
    const result = await loginPlatformOwnerWithEmail(body.email);
    const response = Response.json({
      backend: getOperatorBackendRuntimeStatus(),
      authenticated: true,
      owner: true,
      user: result.session.user,
      error: null
    });
    response.headers.set("set-cookie", result.cookie);
    return response;
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
