import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { bootstrapOperatorUser } from "@/lib/operator-backend/bootstrap";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { getOrCreateOperatorSessionUser } from "@/lib/operator-backend/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-session-bootstrap", points: 60, durationSeconds: 60 });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    throw error;
  }

  const backend = getOperatorBackendRuntimeStatus();
  if (!backend.enabled) {
    return Response.json(
      {
        error: "Operator backend is disabled.",
        backend
      },
      { status: 503 }
    );
  }
  if (!backend.serviceConfigured) {
    return Response.json(
      {
        error: "Operator backend configuration is required for session bootstrap.",
        backend
      },
      { status: 503 }
    );
  }

  const session = await getOrCreateOperatorSessionUser(req);
  if (!session.authenticated) {
    return Response.json(
      {
        error: "Authentication is required.",
        backend
      },
      { status: 401 }
    );
  }

  const bootstrap = await bootstrapOperatorUser(session.user);
  const response = Response.json({
    backend,
    authenticated: true,
    user: session.user,
    bootstrap
  });
  if (session.setCookie) response.headers.append("set-cookie", session.setCookie);
  return response;
}
