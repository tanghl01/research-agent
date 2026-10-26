import { describe, expect, test } from "vitest";
import { compactTaskTitle, inferTaskSource, mergeTasks } from "./task-history";
import type { OperatorTask } from "./tasks";

describe("task history helpers", () => {
  test("merges matching tasks and keeps the newest update time", () => {
    const merged = mergeTasks(
      [task({ id: "local-1", title: "  Same Task  ", updatedAt: "2026-06-20T10:00:00.000Z" })],
      [task({ id: "server-1", title: "same task", updatedAt: "2026-06-20T09:00:00.000Z" })]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "server-1",
      title: "  Same Task  ",
      updatedAt: "2026-06-20T10:00:00.000Z"
    });
  });

  test("sorts merged tasks by updated time descending", () => {
    const merged = mergeTasks(
      [task({ id: "old", title: "old", updatedAt: "2026-06-19T10:00:00.000Z" })],
      [task({ id: "new", title: "new", updatedAt: "2026-06-20T10:00:00.000Z" })]
    );

    expect(merged.map((item) => item.id)).toEqual(["new", "old"]);
  });

  test("infers server source from server-provided task metadata", () => {
    expect(inferTaskSource([task({ id: "server", title: "server", source: "server" })])).toBe("server");
    expect(inferTaskSource([task({ id: "local", title: "local" })])).toBe("local");
  });

  test("compacts blank and long user prompts into task titles", () => {
    expect(compactTaskTitle("   ")).toBeUndefined();
    expect(compactTaskTitle("hello\nworld")).toBe("hello world");
    expect(compactTaskTitle("一".repeat(40))).toBe(`${"一".repeat(32)}...`);
  });
});

function task(fields: Partial<OperatorTask> & { source?: unknown }): OperatorTask {
  return {
    id: "task",
    title: "task",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...fields
  };
}
