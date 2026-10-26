import { describe, expect, test } from "vitest";
import { repoRoot, resolveWorkspace, workspacePath } from "../src/index.js";

describe("repo root", () => {
  test("uses OPERATOR_REPO_ROOT when production bundles run outside the repository layout", () => {
    const previous = process.env.OPERATOR_REPO_ROOT;
    process.env.OPERATOR_REPO_ROOT = "/opt/operator";
    try {
      expect(repoRoot()).toBe("/opt/operator");
    } finally {
      if (previous === undefined) {
        delete process.env.OPERATOR_REPO_ROOT;
      } else {
        process.env.OPERATOR_REPO_ROOT = previous;
      }
    }
  });
});

describe("workspace path guard", () => {
  test("resolves project-local workspaces and rejects escaping paths", () => {
    const workspace = resolveWorkspace("tmp/test-runs/core-workspace", "wr_core_test");
    expect(workspace).toContain("/tmp/test-runs/core-workspace");
    expect(workspacePath(workspace, "output/file.json")).toContain("/output/file.json");
    expect(() => workspacePath(workspace, "../escape.json")).toThrow(/escapes/);
  });
});
