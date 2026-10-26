import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { artifactHref, rewriteWorkspaceArtifactLinks } from "./artifact-links";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true });
  }
});

describe("rewriteWorkspaceArtifactLinks", () => {
  test("adds browser-local source to legacy artifact links when requested", () => {
    const workspace = createWorkspace({
      "output/result.md": "ok"
    });

    expect(artifactHref(workspace, "output/result.md", { download: true, source: "browser-local" })).toContain("source=browser-local");

    const rewritten = rewriteWorkspaceArtifactLinks("[result](output/result.md)", workspace, { source: "browser-local" });

    expect(rewritten).toContain("path=output%2Fresult.md");
    expect(rewritten).toContain("source=browser-local");
  });

  test("rewrites relative workspace files to artifact API links", () => {
    const workspace = createWorkspace({
      "runs/gorden-ppt-skill/gorden_deck.pptx": "pptx"
    });

    const rewritten = rewriteWorkspaceArtifactLinks("下载：[gorden_deck.pptx](runs/gorden-ppt-skill/gorden_deck.pptx)", workspace);

    expect(rewritten).toContain("/api/operator/artifact?");
    expect(rewritten).toContain("workspace=");
    expect(rewritten).toContain("path=runs%2Fgorden-ppt-skill%2Fgorden_deck.pptx");
  });

  test("leaves non-artifact links unchanged", () => {
    const workspace = createWorkspace({});
    const text = ["[external](https://example.com/file.pptx)", "[anchor](#section)", "[missing](runs/missing.pptx)"].join("\n");

    expect(rewriteWorkspaceArtifactLinks(text, workspace)).toBe(text);
  });
});

function createWorkspace(files: Record<string, string>): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "operator-artifact-links-"));
  workspaces.push(workspace);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return workspace;
}
