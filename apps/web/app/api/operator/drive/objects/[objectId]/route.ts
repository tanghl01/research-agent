import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { deleteDriveObjectForSession, ServerDriveError } from "@/lib/operator-backend/drive";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ objectId: string }> }) {
  try {
    assertSameOrigin(_req);
    await consumeRateLimit(_req, { namespace: "operator-drive-delete", points: 60, durationSeconds: 60 });
    const { objectId } = await params;
    return Response.json(await deleteDriveObjectForSession(objectId));
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    if (error instanceof ServerDriveError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
