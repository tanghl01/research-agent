import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, getAdminUserDetail, requirePlatformOwner } from "@/lib/operator-backend/admin";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-user-detail", points: 120, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const { userId } = await params;
    return Response.json(await getAdminUserDetail(userId));
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
