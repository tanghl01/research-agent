import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { ApiValidationError, parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { normalizePhoneForLogin, requestOperatorPhoneLoginCode } from "@/lib/operator-backend/session";

export const runtime = "nodejs";

const phoneCodeSchema = z.object({
  phone: z.string().trim().min(1).max(32)
});

export async function POST(req: Request) {
  const backend = getOperatorBackendRuntimeStatus();
  try {
    assertSameOrigin(req);
    if (!backend.enabled) {
      return Response.json({ error: "Operator backend is not available.", backend }, { status: 503 });
    }
    const body = await parseJsonBody(req, phoneCodeSchema);
    const phone = normalizePhoneForLogin(body.phone);
    if (!phone) {
      throw new ApiValidationError("A valid phone number is required.", {
        fieldErrors: { phone: ["A valid phone number is required."] },
        formErrors: []
      });
    }
    await consumeRateLimit(req, { namespace: "operator-phone-login-code", points: 10, durationSeconds: 60 });
    await consumeRateLimit(req, {
      namespace: "operator-phone-login-code-phone",
      points: 3,
      durationSeconds: 300,
      key: phone
    });
    const result = await requestOperatorPhoneLoginCode({ phone });
    return Response.json({
      backend,
      phone: result.phone,
      expiresAt: result.expiresAt,
      debugCode: result.debugCode
    });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, backend }, { status: 400 });
  }
}
