import { z } from "zod";
import { apiSecurityErrorResponse, consumeRateLimit } from "@/lib/api/security";
import { fillKnowledgeTemplateForRequest, knowledgeErrorResponse } from "@/lib/operator-backend/knowledge";

export const runtime = "nodejs";

const fillSchema = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  outputFormat: z.string().optional()
});

export async function POST(req: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    await consumeRateLimit(req, { namespace: "operator-knowledge-template-fill", points: 30, durationSeconds: 60 });
    const { templateId } = await context.params;
    const body = fillSchema.parse(await req.json().catch(() => ({})));
    const result = await fillKnowledgeTemplateForRequest(req, {
      templateId,
      fields: body.fields,
      outputFormat: body.outputFormat
    });
    const { setCookie, ...payload } = result;
    const headers = new Headers();
    if (setCookie) headers.set("set-cookie", setCookie);
    return Response.json(payload, { headers });
  } catch (error) {
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return knowledgeErrorResponse(error);
  }
}
