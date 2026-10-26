export type OperatorTask = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

const storageKey = "operator.tasks.v1";

export function createTask(title = "新任务"): OperatorTask {
  const now = new Date().toISOString();
  return {
    id: `task_${createTaskIdFragment()}`,
    title,
    createdAt: now,
    updatedAt: now
  };
}

function createTaskIdFragment(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return randomId.replaceAll("-", "").slice(0, 12).padEnd(12, "0");
}

export function loadTasks(): OperatorTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OperatorTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: OperatorTask[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(tasks));
}
