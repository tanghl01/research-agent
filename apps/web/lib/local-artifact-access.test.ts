import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "@operator/core";
import { afterEach, describe, expect, test } from "vitest";
import { LegacyArtifactAccessError, resolveLegacyArtifactFile, writeLegacyArtifactFile } from "./local-artifact-access";

const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveLegacyArtifactFile", () => {
  test("allows files inside configured run workspaces", () => {
    const root = tempRoot();
    const workspace = path.join(root, "tmp", "runs", "web", "task-1");
    const artifact = path.join(workspace, "output", "result.md");
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, "ok");

    expect(resolveLegacyArtifactFile({ root, workspace, artifactPath: "output/result.md" })).toBe(artifact);
  });

  test("rejects using the repository root as a legacy artifact workspace", () => {
    const root = tempRoot();
    const packageFile = path.join(root, "package.json");
    writeFileSync(packageFile, "{}");

    expect(() => resolveLegacyArtifactFile({ root, workspace: root, artifactPath: "package.json" })).toThrow(LegacyArtifactAccessError);
  });

  test("rejects relative paths that escape the requested workspace", () => {
    const root = tempRoot();
    const workspace = path.join(root, "tmp", "runs", "task-1");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(root, "tmp", "runs", "secret.txt"), "secret");

    expect(() => resolveLegacyArtifactFile({ root, workspace, artifactPath: "../secret.txt" })).toThrow(/escapes workflow workspace/);
  });

  test("rejects symlinks that resolve outside the requested workspace", () => {
    const root = tempRoot();
    const workspace = path.join(root, "tmp", "runs", "task-1");
    const outside = path.join(root, "outside.txt");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(outside, "secret");
    symlinkSync(outside, path.join(workspace, "linked.txt"));

    expect(() => resolveLegacyArtifactFile({ root, workspace, artifactPath: "linked.txt" })).toThrow(/resolves outside/);
  });

  test("allows updating an existing artifact", async () => {
    const workspace = path.join(repoRoot(), "tmp", "runs", "web", `artifact-put-${randomUUID()}`);
    const artifact = path.join(workspace, "output", "note.md");
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, "old");
    createdRoots.push(workspace);

    const result = await writeLegacyArtifactFile({
      workspace,
      artifactPath: "output/note.md",
      content: "# Updated"
    });

    expect(result.sizeBytes).toBe(9);
    expect(readFileSync(artifact, "utf8")).toBe("# Updated");
  });
});

function tempRoot(): string {
  const root = path.join(tmpdir(), `operator-artifact-access-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}
