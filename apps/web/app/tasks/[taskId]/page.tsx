import { OperatorAppShell } from "@/components/operator-app-shell";
import { loadOperatorTaskMessagesPayload } from "@/lib/operator-application/task-query-service";
import { isLegacyLocalOperatorAccessAllowed } from "@/lib/operator-local-access-policy";
import { listOperatorTasksWithSource, loadOperatorScopeCatalog } from "@/lib/operator-server-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [taskPayload, messagePayload, catalog] = await Promise.all([
    listOperatorTasksWithSource(),
    loadOperatorTaskMessagesPayload({ taskId, source: null, legacyLocalAccessAllowed: isLegacyLocalOperatorAccessAllowed(null) }),
    Promise.resolve(loadOperatorScopeCatalog())
  ]);

  return (
    <OperatorAppShell
      initialCatalog={catalog}
      initialHistoryMessages={{ [taskId]: messagePayload.messages }}
      initialTaskSource={messagePayload.source}
      initialTasks={taskPayload.tasks}
      taskId={taskId}
      workbenchRoute
    />
  );
}
