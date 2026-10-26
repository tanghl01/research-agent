import { loadOperatorTaskMessagesPayload } from "@/lib/operator-application/task-query-service";
import { isLegacyLocalOperatorAccessAllowed, legacyLocalAccessDisabledResponse } from "@/lib/operator-local-access-policy";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("source") === "browser-local") {
    if (!isLegacyLocalOperatorAccessAllowed("browser-local")) return legacyLocalAccessDisabledResponse();
  }
  const source = url.searchParams.get("source");
  const payload = await loadOperatorTaskMessagesPayload({
    taskId: url.searchParams.get("taskId"),
    source,
    legacyLocalAccessAllowed: isLegacyLocalOperatorAccessAllowed(source)
  });
  return Response.json(payload);
}
