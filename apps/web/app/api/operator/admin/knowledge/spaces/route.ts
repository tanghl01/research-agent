import { z } from "zod";
import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { createKnowledgeSpace } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

const spaceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  domainType: z.string().optional(),
  visibility: z.enum(["public", "organization", "private"]).optional(),
  config: z.record(z.string(), z.unknown()).optional()
});

export async function POST(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-spaces-create", points: 30, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const body = spaceSchema.parse(await req.json());
    return Response.json({ space: await createKnowledgeSpace(body) }, { status: 201 });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
