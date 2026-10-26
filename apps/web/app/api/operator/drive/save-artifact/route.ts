import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { saveArtifactToDriveForSession, ServerDriveError } from "@/lib/operator-backend/drive";

export const runtime = "nodejs";

const saveArtifactSchema = z.object({
  artifactId: z.string().uuid()
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-drive-save-artifact", points: 60, durationSeconds: 60 });
    const body = await parseJsonBody(req, saveArtifactSchema);
    const object = await saveArtifactToDriveForSession(body.artifactId);
    return Response.json({ object }, { status: 201 });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    if (error instanceof ServerDriveError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
