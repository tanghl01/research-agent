import { zodToJsonSchema } from "zod-to-json-schema";

type JsonSchema = Record<string, unknown>;

export function toAsyncApiSchema(name: string, schema: Parameters<typeof zodToJsonSchema>[0]): JsonSchema {
  const converted = zodToJsonSchema(schema, { name, target: "jsonSchema7" }) as JsonSchema;
  const definitions = converted.definitions;
  if (isRecord(definitions) && isRecord(definitions[name])) return definitions[name] as JsonSchema;
  return converted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
