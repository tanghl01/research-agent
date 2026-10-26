import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { listDriveObjectsForSession, ServerDriveError, uploadDriveObjectForSession } from "@/lib/operator-backend/drive";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await listDriveObjectsForSession());
  } catch (error) {
    return driveErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-drive-upload", points: 30, durationSeconds: 60 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "file is required", code: "FILE_REQUIRED" }, { status: 400 });
    }
    const body = Buffer.from(await file.arrayBuffer());
    const object = await uploadDriveObjectForSession({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      body
    });
    return Response.json({ object }, { status: 201 });
  } catch (error) {
    return driveErrorResponse(error);
  }
}

function driveErrorResponse(error: unknown): Response {
  const security = apiSecurityErrorResponse(error);
  if (security) return security;
  if (error instanceof ServerDriveError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}
