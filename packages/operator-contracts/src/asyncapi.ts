import { ArtifactContractSchema } from "./artifacts.js";
import { ReconcileDecisionSchema, RunReconcileJobPayloadSchema } from "./reconciler.js";
import { toAsyncApiSchema } from "./schema-conversion.js";
import { ProductEventSchema } from "./run-events.js";
import { z } from "zod";

const AgUiEventProjectionSchema = z.object({
  type: z.string().min(1),
  threadId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  timestamp: z.union([z.string().min(1), z.number()]).optional()
});

export type OperatorAsyncApiDocument = {
  asyncapi: "3.0.0";
  info: {
    title: string;
    version: string;
  };
  channels: Record<string, unknown>;
  operations: Record<string, unknown>;
  components: {
    messages: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
};

export function createOperatorAsyncApiDocument(): OperatorAsyncApiDocument {
  return {
    asyncapi: "3.0.0",
    info: {
      title: "Operator Product Events",
      version: "0.1.0"
    },
    channels: {
      productEvents: {
        address: "operator.product-events",
        messages: {
          ProductEvent: {
            $ref: "#/components/messages/ProductEvent"
          }
        }
      },
      artifactFinalization: {
        address: "operator.artifact-finalization",
        messages: {
          ArtifactContract: {
            $ref: "#/components/messages/ArtifactContract"
          }
        }
      },
      taskAgUiEvents: {
        address: "operator.task-ag-ui.{taskId}",
        messages: {
          AgUiEventProjection: {
            $ref: "#/components/messages/AgUiEventProjection"
          }
        }
      },
      runReconciliationJobs: {
        address: "operator.queue.agent-run.reconcile-run",
        messages: {
          RunReconcileJobPayload: {
            $ref: "#/components/messages/RunReconcileJobPayload"
          },
          ReconcileDecision: {
            $ref: "#/components/messages/ReconcileDecision"
          }
        }
      }
    },
    operations: {
      publishProductEvent: {
        action: "send",
        channel: {
          $ref: "#/channels/productEvents"
        },
        messages: [{ $ref: "#/channels/productEvents/messages/ProductEvent" }]
      },
      publishTaskAgUiEvent: {
        action: "send",
        channel: {
          $ref: "#/channels/taskAgUiEvents"
        },
        messages: [{ $ref: "#/channels/taskAgUiEvents/messages/AgUiEventProjection" }]
      },
      enqueueRunReconciliation: {
        action: "send",
        channel: {
          $ref: "#/channels/runReconciliationJobs"
        },
        messages: [{ $ref: "#/channels/runReconciliationJobs/messages/RunReconcileJobPayload" }]
      }
    },
    components: {
      messages: {
        AgUiEventProjection: {
          payload: {
            $ref: "#/components/schemas/AgUiEventProjection"
          }
        },
        ProductEvent: {
          payload: {
            $ref: "#/components/schemas/ProductEvent"
          }
        },
        ArtifactContract: {
          payload: {
            $ref: "#/components/schemas/ArtifactContract"
          }
        },
        RunReconcileJobPayload: {
          payload: {
            $ref: "#/components/schemas/RunReconcileJobPayload"
          }
        },
        ReconcileDecision: {
          payload: {
            $ref: "#/components/schemas/ReconcileDecision"
          }
        }
      },
      schemas: {
        AgUiEventProjection: toAsyncApiSchema("AgUiEventProjection", AgUiEventProjectionSchema),
        ProductEvent: toAsyncApiSchema("ProductEvent", ProductEventSchema),
        ArtifactContract: toAsyncApiSchema("ArtifactContract", ArtifactContractSchema),
        RunReconcileJobPayload: toAsyncApiSchema("RunReconcileJobPayload", RunReconcileJobPayloadSchema),
        ReconcileDecision: toAsyncApiSchema("ReconcileDecision", ReconcileDecisionSchema)
      }
    }
  };
}
