import { apiSecurityErrorResponse, assertSameOrigin } from "@/lib/api/security";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { signOutOperatorSession } from "@/lib/operator-backend/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    throw error;
  }

  const backend = getOperatorBackendRuntimeStatus();
  const clearCookie = await signOutOperatorSession(req);
  const response = Response.json({
    ok: true,
    backend,
    authenticated: false,
    user: null
  });
  response.headers.set("set-cookie", clearCookie);
  return response;
}
