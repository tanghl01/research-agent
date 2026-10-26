import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, getAdminDashboardSummary, requirePlatformOwner } from "@/lib/operator-backend/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-summary", points: 120, durationSeconds: 60 });
    await requirePlatformOwner(req);
    return Response.json(await getAdminDashboardSummary());
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
