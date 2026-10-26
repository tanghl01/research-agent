import { z } from "zod";

export const OPERATOR_ERROR_CODES = [
  "OPERATOR_RUNTIME_NOT_CONFIGURED",
  "OPERATOR_ACP_CONNECTION_CLOSED",
  "OPERATOR_RUNTIME_TIMEOUT",
  "OPERATOR_RUNTIME_EMPTY_RESPONSE",
  "OPERATOR_RUNTIME_PROTOCOL_ERROR",
  "OPERATOR_RUNTIME_CANCELLED",
  "OPERATOR_WORKFLOW_FAILED",
  "OPERATOR_ARTIFACT_FINALIZATION_FAILED",
  "OPERATOR_PERSISTENCE_FAILED",
  "OPERATOR_RECONCILER_TIMEOUT",
  "OPERATOR_VALIDATION_FAILED",
  "OPERATOR_UNKNOWN_ERROR"
] as const;

export const OPERATOR_ERROR_SOURCES = ["runtime", "workflow", "persistence", "artifact", "event", "reconciler", "web"] as const;

export type OperatorErrorCode = (typeof OPERATOR_ERROR_CODES)[number];
export type OperatorErrorSource = (typeof OPERATOR_ERROR_SOURCES)[number];

export const OperatorErrorCodeSchema = z.enum(OPERATOR_ERROR_CODES);
export const OperatorErrorSourceSchema = z.enum(OPERATOR_ERROR_SOURCES);

export const OperatorErrorSchema = z.object({
  code: OperatorErrorCodeSchema,
  message: z.string().min(1),
  detail: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  source: OperatorErrorSourceSchema.optional(),
  cause: z.unknown().optional()
});

export type OperatorError = z.infer<typeof OperatorErrorSchema>;

export function operatorError(params: {
  code: OperatorErrorCode;
  message: string;
  detail?: string;
  retryable?: boolean;
  source?: OperatorErrorSource;
  cause?: unknown;
}): OperatorError {
  return OperatorErrorSchema.parse(params);
}

export function unknownOperatorError(error: unknown, source?: OperatorErrorSource): OperatorError {
  if (isOperatorError(error)) return error;
  return operatorError({
    code: "OPERATOR_UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
    source,
    cause: error
  });
}

export function isOperatorError(value: unknown): value is OperatorError {
  return OperatorErrorSchema.safeParse(value).success;
}
