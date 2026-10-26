import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer("operator-mastra");

export async function withMastraOperatorSpan<T>(name: string, attributes: Attributes, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
