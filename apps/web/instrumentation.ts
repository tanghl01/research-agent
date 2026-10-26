export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { initializeOperatorTelemetry } = await import("./lib/operator-application/telemetry");
  await initializeOperatorTelemetry();
}
