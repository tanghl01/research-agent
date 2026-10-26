import { listOperatorTasksWithSource } from "@/lib/operator-server-data";

export const runtime = "nodejs";

export async function GET() {
  const payload = await listOperatorTasksWithSource();
  return Response.json(payload);
}
