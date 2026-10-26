import { OperatorAppShell } from "@/components/operator-app-shell";
import { listOperatorTasksWithSource, loadOperatorScopeCatalog } from "@/lib/operator-server-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const [taskPayload, catalog] = await Promise.all([listOperatorTasksWithSource(), Promise.resolve(loadOperatorScopeCatalog())]);

  return (
    <OperatorAppShell initialCatalog={catalog} initialTaskSource={taskPayload.source} initialTasks={taskPayload.tasks} workbenchRoute />
  );
}
