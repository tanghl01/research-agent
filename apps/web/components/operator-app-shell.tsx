"use client";

import { usePathname } from "next/navigation";
import { OperatorWorkbench } from "@/components/operator-workbench";
import type { HistoryMessage } from "@/components/operator-thread";
import type { ScopeCatalog } from "@/lib/scopes";
import type { OperatorTaskDataSource } from "@/lib/operator-server-data";
import type { OperatorTask } from "@/lib/tasks";

export function OperatorAppShell({
  children,
  initialCatalog,
  initialHistoryMessages,
  initialTaskSource,
  initialTasks,
  taskId: initialTaskId,
  workbenchRoute = false
}: {
  children?: React.ReactNode;
  initialCatalog?: ScopeCatalog;
  initialHistoryMessages?: Record<string, HistoryMessage[]>;
  initialTaskSource?: OperatorTaskDataSource;
  initialTasks?: OperatorTask[];
  taskId?: string;
  workbenchRoute?: boolean;
}) {
  const pathname = usePathname();
  const taskId = initialTaskId ?? taskIdFromPathname(pathname);
  const isWorkbenchRoute = workbenchRoute || pathname === "/" || pathname.startsWith("/tasks/");

  if (!isWorkbenchRoute) return <>{children}</>;
  return (
    <OperatorWorkbench
      initialCatalog={initialCatalog}
      initialHistoryMessages={initialHistoryMessages}
      initialTaskSource={initialTaskSource}
      initialTasks={initialTasks}
      taskId={taskId}
    />
  );
}

function taskIdFromPathname(pathname: string): string | undefined {
  const match = /^\/tasks\/([^/?#]+)/u.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}
