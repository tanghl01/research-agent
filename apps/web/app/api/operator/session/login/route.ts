import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { loginOperatorUserWithEmail, loginOperatorUserWithPhone } from "@/lib/operator-backend/session";

export const runtime = "nodejs";

const loginSchema = z
  .object({
    method: z.enum(["email", "phone"]).optional(),
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(32).optional(),
    code: z.string().trim().max(16).optional(),
    displayName: z.string().trim().min(1).max(120).optional()
  })
  .superRefine((body, ctx) => {
    const method = body.method ?? (body.phone ? "phone" : "email");
    if (method === "phone") {
      if (!body.phone) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Phone number is required." });
      }
      if (!body.code) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "Verification code is required." });
      }
      if (body.email && !z.string().email().safeParse(body.email).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Safety email is invalid." });
      }
      return;
    }
    if (!body.email || !z.string().email().safeParse(body.email).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Email is required." });
    }
  });

export async function POST(req: Request) {
  const backend = getOperatorBackendRuntimeStatus();
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-session-login", points: 5, durationSeconds: 60 });
    if (!backend.enabled) {
      return Response.json({ error: "Operator backend is not available.", backend }, { status: 503 });
    }
    const body = await parseJsonBody(req, loginSchema);
    const method = body.method ?? (body.phone ? "phone" : "email");
    const result =
      method === "phone"
        ? await loginOperatorUserWithPhone({
            phone: body.phone ?? "",
            code: body.code ?? "",
            email: body.email,
            displayName: body.displayName,
            request: req
          })
        : await loginOperatorUserWithEmail({ email: body.email ?? "", displayName: body.displayName, request: req });
    const response = Response.json({
      backend,
      authenticated: true,
      user: result.session.user,
      bootstrapAvailable: backend.serviceConfigured,
      error: null
    });
    response.headers.set("set-cookie", result.cookie);
    return response;
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, backend }, { status: 400 });
  }
}
