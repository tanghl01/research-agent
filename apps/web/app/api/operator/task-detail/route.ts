import { loadOperatorTaskDetail } from "@/lib/operator-application/task-query-service";
import { isLegacyLocalOperatorAccessAllowed, legacyLocalAccessDisabledResponse } from "@/lib/operator-local-access-policy";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");
  const source = url.searchParams.get("source");
  if (!taskId || taskId.includes("/") || taskId.includes("\\")) {
    return Response.json({ taskId, workspace: undefined, exists: false });
  }

  if (source === "browser-local" && !isLegacyLocalOperatorAccessAllowed(source)) {
    return legacyLocalAccessDisabledResponse();
  }

  return Response.json(
    await loadOperatorTaskDetail({
      taskId,
      source,
      legacyLocalAccessAllowed: isLegacyLocalOperatorAccessAllowed(source)
    })
  );
}
