import { loadOperatorScopeCatalog } from "@/lib/operator-server-data";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    version: "1.0",
    catalog: loadOperatorScopeCatalog()
  });
}
