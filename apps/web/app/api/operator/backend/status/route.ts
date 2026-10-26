import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "operator-web-backend",
    backend: getOperatorBackendRuntimeStatus()
  });
}
