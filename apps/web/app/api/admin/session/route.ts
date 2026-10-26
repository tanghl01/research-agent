import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, getAdminSession } from "@/lib/operator-backend/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-session", points: 120, durationSeconds: 60 });
    return Response.json(await getAdminSession(req));
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
