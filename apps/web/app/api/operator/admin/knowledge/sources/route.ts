import { z } from "zod";
import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { adminErrorResponse, requirePlatformOwner } from "@/lib/operator-backend/admin";
import { createKnowledgeSource, listKnowledgeSources } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

const sourceSchema = z.object({
  spaceKey: z.string().min(1),
  baseUrl: z.string().url(),
  type: z.string().optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
  crawlerConfig: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().nullable().optional()
});

export async function GET(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-sources", points: 120, durationSeconds: 60 });
    await requirePlatformOwner(req);
    return Response.json({ sources: await listKnowledgeSources() });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await consumeRateLimit(req, { namespace: "operator-admin-knowledge-sources-create", points: 30, durationSeconds: 60 });
    await requirePlatformOwner(req);
    const body = sourceSchema.parse(await req.json());
    return Response.json({ source: await createKnowledgeSource(body) }, { status: 201 });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return adminErrorResponse(error);
  }
}
