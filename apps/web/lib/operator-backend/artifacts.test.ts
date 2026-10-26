import { describe, expect, test } from "vitest";
import { rewriteRegisteredArtifactLinks, type ServerArtifactRegistration } from "./artifacts";

describe("Operator server artifact registration", () => {
  test("rewrites legacy workspace artifact download links to artifact id download routes", () => {
    const text = "目标产物下载：\n- [deck.pptx](/api/operator/artifact?workspace=%2Ftmp%2Foperator&path=runs%2Fdeck.pptx&download=1)";

    const rewritten = rewriteRegisteredArtifactLinks(text, [registration("runs/deck.pptx", "00000000-0000-4000-8000-000000000123")]);

    expect(rewritten).toContain("/api/operator/artifacts/00000000-0000-4000-8000-000000000123/download?download=1");
    expect(rewritten).not.toContain("workspace=");
    expect(rewritten).not.toContain("path=");
  });

  test("preserves preview and download semantics when rewriting paired target links", () => {
    const text =
      "目标产物：\n- [预览 deck.pptx](/api/operator/artifact?workspace=%2Ftmp%2Foperator&path=runs%2Fdeck.pptx) / [下载 deck.pptx](/api/operator/artifact?workspace=%2Ftmp%2Foperator&path=runs%2Fdeck.pptx&download=1)";

    const rewritten = rewriteRegisteredArtifactLinks(text, [registration("runs/deck.pptx", "00000000-0000-4000-8000-000000000123")]);

    expect(rewritten).toContain("[预览 deck.pptx](/api/operator/artifacts/00000000-0000-4000-8000-000000000123/download)");
    expect(rewritten).toContain("[下载 deck.pptx](/api/operator/artifacts/00000000-0000-4000-8000-000000000123/download?download=1)");
  });

  test("leaves unknown legacy artifact links unchanged", () => {
    const text = "[missing](/api/operator/artifact?workspace=%2Ftmp%2Foperator&path=missing.txt&download=1)";

    expect(rewriteRegisteredArtifactLinks(text, [registration("runs/deck.pptx")])).toBe(text);
  });
});

function registration(localPath: string, artifactId = "00000000-0000-4000-8000-000000000124"): ServerArtifactRegistration {
  return {
    artifactId,
    localPath,
    href: `/api/operator/artifacts/${artifactId}/download`,
    downloadHref: `/api/operator/artifacts/${artifactId}/download?download=1`,
    record: {
      id: artifactId,
      project_id: "00000000-0000-4000-8000-000000000125",
      agent_run_id: null,
      job_id: null,
      type: "pptx",
      file_asset_id: "00000000-0000-4000-8000-000000000127",
      bucket_id: "operator-artifacts",
      object_path: `objects/${artifactId}`,
      filename: "deck.pptx",
      content_type: "application/octet-stream",
      sha256: "hash",
      size_bytes: 1,
      metadata: {},
      created_by: "00000000-0000-4000-8000-000000000126",
      created_at: "2026-06-16T00:00:00.000Z"
    }
  };
}
