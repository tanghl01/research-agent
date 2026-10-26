import type { z } from "zod";

export class ApiValidationError extends Error {
  status = 400;
  code = "INVALID_REQUEST_BODY";

  constructor(
    message: string,
    readonly issues?: unknown
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(request: Request, schema: TSchema): Promise<z.infer<TSchema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiValidationError("Request body validation failed.", parsed.error.flatten());
  }
  return parsed.data;
}

export function validationErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ApiValidationError)) return null;
  return Response.json(
    {
      error: error.message,
      code: error.code,
      issues: error.issues
    },
    { status: error.status }
  );
}
