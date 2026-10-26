import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, listAdminUsers, requirePlatformOwner } from "@/lib/operator-backend/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-users-list", points: 120, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const url = new URL(req.url);
    const query = url.searchParams.get("q") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 30);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return Response.json(await listAdminUsers({ query, limit, offset }));
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
