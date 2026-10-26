import type { OperatorTaskDataSource } from "./operator-server-data";
import { saveTasks, type OperatorTask } from "./tasks";

export type TaskDataSource = OperatorTaskDataSource;
export type TaskDateGroup = {
  label: string;
  tasks: OperatorTask[];
};

export function inferTaskSource(tasks: OperatorTask[]): TaskDataSource {
  return tasks.some((task) => taskSourceValue(task) === "server") ? "server" : "local";
}

export function persistTasks(source: TaskDataSource, tasks: OperatorTask[]): void {
  if (source === "local") saveTasks(tasks);
}

export function mergeTasks(localTasks: OperatorTask[], serverTasks: OperatorTask[]): OperatorTask[] {
  const merged: OperatorTask[] = [];
  for (const task of serverTasks) upsertTask(merged, task);
  for (const task of localTasks) {
    upsertTask(merged, task);
  }
  return merged.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function compactTaskTitle(text: string): string | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

export function groupTasksByDate(tasks: OperatorTask[]): TaskDateGroup[] {
  const groups = new Map<string, OperatorTask[]>();
  for (const task of tasks) {
    const label = historyDateLabel(task.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), task]);
  }
  return [...groups.entries()].map(([label, groupTasks]) => ({ label, tasks: groupTasks }));
}

function taskSourceValue(task: OperatorTask): unknown {
  return (task as OperatorTask & { source?: unknown }).source;
}

function upsertTask(tasks: OperatorTask[], task: OperatorTask): void {
  const index = tasks.findIndex((existing) => existing.id === task.id || taskKey(existing) === taskKey(task));
  if (index === -1) {
    tasks.push(task);
    return;
  }

  const existing = tasks[index];
  tasks[index] = {
    ...existing,
    title: taskTitleToKeep(existing.title, task.title),
    updatedAt: Date.parse(existing.updatedAt) > Date.parse(task.updatedAt) ? existing.updatedAt : task.updatedAt
  };
}

function taskKey(task: OperatorTask): string {
  return task.title.replace(/\s+/gu, " ").trim().toLowerCase() || task.id;
}

function taskTitleToKeep(existingTitle: string, nextTitle: string): string {
  if (!existingTitle || existingTitle === "新任务") return nextTitle;
  if (nextTitle && nextTitle !== "新任务" && nextTitle.length > existingTitle.length) return nextTitle;
  return existingTitle;
}

function historyDateLabel(isoDate: string): string {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return "较早";
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return "最近 7 天";
  return "更早";
}
