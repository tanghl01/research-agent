type RuntimeImporter = (specifier: string) => Promise<Record<string, unknown>>;
type OtlpTraceExporterConstructor = new (options: { url: string }) => unknown;
type NodeSdkConstructor = new (config: {
  resource: unknown;
  traceExporter?: unknown;
}) => {
  start(): void;
  shutdown(): Promise<void>;
};

const runtimeImport = new Function("specifier", "return import(specifier)") as RuntimeImporter;

let telemetryStarted = false;

export async function initializeOperatorTelemetry(env: Record<string, string | undefined> = process.env): Promise<void> {
  if (telemetryStarted || env.OPERATOR_OTEL_DISABLED === "true") return;
  telemetryStarted = true;

  const [exporterModule, resourcesModule, sdkModule, semanticModule] = await Promise.all([
    runtimeImport("@opentelemetry/exporter-trace-otlp-http"),
    runtimeImport("@opentelemetry/resources"),
    runtimeImport("@opentelemetry/sdk-node"),
    runtimeImport("@opentelemetry/semantic-conventions")
  ]);

  const OTLPTraceExporter = requireExport<OtlpTraceExporterConstructor>(exporterModule, "OTLPTraceExporter");
  const resourceFromAttributes = requireExport<(attributes: Record<string, string>) => unknown>(resourcesModule, "resourceFromAttributes");
  const NodeSDK = requireExport<NodeSdkConstructor>(sdkModule, "NodeSDK");
  const serviceNameAttribute = stringExport(semanticModule, "ATTR_SERVICE_NAME", "service.name");
  const serviceVersionAttribute = stringExport(semanticModule, "ATTR_SERVICE_VERSION", "service.version");

  const traceExporter = otlpTraceExporter(env, OTLPTraceExporter);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [serviceNameAttribute]: env.OTEL_SERVICE_NAME?.trim() || "operator-web",
      [serviceVersionAttribute]: env.npm_package_version || "0.1.0"
    }),
    ...(traceExporter ? { traceExporter } : {})
  });

  sdk.start();
  registerShutdown(() => {
    void sdk.shutdown().catch(() => undefined);
  });
}

function otlpTraceExporter(env: Record<string, string | undefined>, OTLPTraceExporter: OtlpTraceExporterConstructor): unknown | undefined {
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return endpoint ? new OTLPTraceExporter({ url: endpoint }) : undefined;
}

function requireExport<T>(module: Record<string, unknown>, name: string): T {
  const value = module[name];
  if (!value) throw new Error(`OpenTelemetry export is missing: ${name}`);
  return value as T;
}

function stringExport(module: Record<string, unknown>, name: string, fallback: string): string {
  const value = module[name];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function registerShutdown(handler: () => void): void {
  if (typeof process === "undefined" || !process.once) return;
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
}
