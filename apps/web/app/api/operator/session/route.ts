import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { getOrCreateOperatorSessionUser } from "@/lib/operator-backend/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const backend = getOperatorBackendRuntimeStatus();
  const session = await getOrCreateOperatorSessionUser(req);

  const response = Response.json({
    backend,
    authenticated: session.authenticated,
    user: session.authenticated ? session.user : null,
    bootstrapAvailable: backend.serviceConfigured,
    error: session.error
  });
  if (session.setCookie) response.headers.append("set-cookie", session.setCookie);
  return response;
}
