import { zodToJsonSchema } from "zod-to-json-schema";
import { OperatorApiErrorSchema, OperatorChatRequestSchema, TaskMessagesResponseSchema } from "./api.js";
import { ArtifactContractSchema } from "./artifacts.js";
import { MessageContractSchema } from "./messages.js";
import { ProductEventSchema } from "./run-events.js";
import { RuntimeAdapterResultSchema } from "./runtime-adapter.js";
import { TaskSnapshotSchema } from "./task-snapshot.js";

type JsonSchema = Record<string, unknown>;

export type OperatorOpenApiDocument = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
  };
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, JsonSchema>;
  };
};

export function createOperatorOpenApiDocument(): OperatorOpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "Operator Product Contracts API",
      version: "0.1.0"
    },
    paths: {
      "/api/operator/task-detail": {
        get: {
          operationId: "getOperatorTaskDetail",
          parameters: [queryParameter("taskId", true), queryParameter("source", false)],
          responses: {
            "200": jsonResponse("TaskSnapshot"),
            "400": jsonResponse("OperatorApiError")
          }
        }
      },
      "/api/operator/task-messages": {
        get: {
          operationId: "getOperatorTaskMessages",
          parameters: [queryParameter("taskId", true), queryParameter("source", false)],
          responses: {
            "200": jsonResponse("TaskMessagesResponse"),
            "400": jsonResponse("OperatorApiError")
          }
        }
      },
      "/api/operator/chat": {
        post: {
          operationId: "postOperatorChat",
          parameters: [queryParameter("taskId", false), queryParameter("scope", false)],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OperatorChatRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Vercel AI SDK UI message stream containing AG-UI event parts and final text."
            },
            "400": jsonResponse("OperatorApiError"),
            "500": jsonResponse("OperatorApiError")
          }
        }
      },
      "/api/operator/task-events": {
        get: {
          operationId: "streamOperatorTaskEvents",
          parameters: [queryParameter("taskId", true), queryParameter("source", false), queryParameter("after", false)],
          responses: {
            "200": {
              description: "Server-sent event stream. Event name: ag-ui-event. Payload: AG-UI event projection."
            },
            "400": jsonResponse("OperatorApiError"),
            "503": jsonResponse("OperatorApiError")
          }
        }
      }
    },
    components: {
      schemas: {
        ArtifactContract: toJsonSchema("ArtifactContract", ArtifactContractSchema),
        MessageContract: toJsonSchema("MessageContract", MessageContractSchema),
        OperatorApiError: toJsonSchema("OperatorApiError", OperatorApiErrorSchema),
        OperatorChatRequest: toJsonSchema("OperatorChatRequest", OperatorChatRequestSchema),
        ProductEvent: toJsonSchema("ProductEvent", ProductEventSchema),
        RuntimeAdapterResult: toJsonSchema("RuntimeAdapterResult", RuntimeAdapterResultSchema),
        TaskMessagesResponse: toJsonSchema("TaskMessagesResponse", TaskMessagesResponseSchema),
        TaskSnapshot: toJsonSchema("TaskSnapshot", TaskSnapshotSchema)
      }
    }
  };
}

function queryParameter(name: string, required: boolean): Record<string, unknown> {
  return {
    name,
    in: "query",
    required,
    schema: { type: "string" }
  };
}

function jsonResponse(schemaName: string): Record<string, unknown> {
  return {
    description: schemaName,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` }
      }
    }
  };
}

function toJsonSchema(name: string, schema: Parameters<typeof zodToJsonSchema>[0]): JsonSchema {
  const converted = zodToJsonSchema(schema, { name, target: "openApi3" }) as JsonSchema;
  const definitions = converted.definitions;
  if (isRecord(definitions) && isRecord(definitions[name])) return definitions[name] as JsonSchema;
  return converted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
