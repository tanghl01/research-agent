import { z } from "zod";

export const PRODUCT_EVENT_KINDS = [
  "run.created",
  "run.started",
  "run.progress",
  "run.waiting",
  "run.paused",
  "run.succeeded",
  "run.failed",
  "run.cancelled",
  "run.skipped",
  "runtime.trace",
  "artifact.finalization_started",
  "artifact.finalization_succeeded",
  "artifact.finalization_failed",
  "reconciler.repaired",
  "reconciler.skipped"
] as const;

export type ProductEventKind = (typeof PRODUCT_EVENT_KINDS)[number];

export const ProductEventKindSchema = z.enum(PRODUCT_EVENT_KINDS);

export const ProductEventSchema = z
  .object({
    id: z.string().min(1).optional(),
    specversion: z.literal("1.0").optional(),
    source: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    runId: z.string().min(1),
    taskId: z.string().min(1),
    seq: z.number().int().nonnegative().optional(),
    kind: ProductEventKindSchema,
    type: z.string().min(1).optional(),
    time: z.string().min(1).optional(),
    timestamp: z.string().min(1),
    payload: z.record(z.unknown()),
    data: z.record(z.unknown()).optional()
  })
  .refine((event) => !event.type || event.type === productEventType(event.kind), {
    message: "ProductEvent.type must use operator.<kind>"
  });

export type ProductEvent = z.infer<typeof ProductEventSchema>;

export function productEventType(kind: ProductEventKind): string {
  return `operator.${kind}`;
}

export function productEventSubject(taskId: string, runId: string): string {
  return `tasks/${taskId}/runs/${runId}`;
}

export function createProductEvent(params: {
  id?: string;
  source: string;
  runId: string;
  taskId: string;
  seq?: number;
  kind: ProductEventKind;
  timestamp?: string;
  payload?: Record<string, unknown>;
}): ProductEvent {
  const timestamp = params.timestamp ?? new Date().toISOString();
  const payload = params.payload ?? {};
  return ProductEventSchema.parse({
    id: params.id,
    specversion: "1.0",
    source: params.source,
    subject: productEventSubject(params.taskId, params.runId),
    runId: params.runId,
    taskId: params.taskId,
    seq: params.seq,
    kind: params.kind,
    type: productEventType(params.kind),
    time: timestamp,
    timestamp,
    payload,
    data: payload
  });
}
