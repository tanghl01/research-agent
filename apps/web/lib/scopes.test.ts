import { listUserScopeSelectionCatalog } from "@operator/contracts";
import { describe, expect, test } from "vitest";
import { groupScopes, type ScopeCatalog } from "./scopes";

const scopeCatalog = listUserScopeSelectionCatalog() as ScopeCatalog;

describe("scope groups", () => {
  test("uses the primary tabs requested by the workbench", () => {
    const groups = groupScopes(scopeCatalog);

    expect(groups.map((group) => group.label)).toEqual(["办公", "教育", "科研", "设计", "工业"]);
    expect(groups.find((group) => group.label === "法律")).toBeUndefined();
    expect(groups.find((group) => group.label === "演示文稿")).toBeUndefined();
    expect(groups.find((group) => group.label === "生物医学")).toBeUndefined();
  });

  test("places scopes into the requested groups", () => {
    const groups = groupScopes(scopeCatalog);
    const idsFor = (groupId: string) => groups.find((group) => group.id === groupId)?.items.map((item) => item.id) ?? [];

    expect(idsFor("office")).toEqual(["ppt-master", "guizang-ppt-skill"]);
    expect(idsFor("office")).not.toContain("gorden-ppt-skill");
    expect(idsFor("education")).toEqual([
      "dianji-assistant",
      "operator.knowledge.search",
      "operator.knowledge.fetch",
      "operator.knowledge.find_template",
      "operator.knowledge.fill_template"
    ]);
    expect(idsFor("research")).toEqual(["scientific-agent-skills", "qinyan-academic-skills", "research.paper-from-results"]);
    expect(idsFor("research")).not.toContain("text-to-cad");
    expect(groups.flatMap((group) => group.items).find((item) => item.id === "research.paper-from-results")?.displayName).toBe(
      "用实验结果写论文"
    );
    expect(idsFor("design")).toEqual(["text-to-cad"]);
    expect(idsFor("industrial")).toEqual(
      expect.arrayContaining(["industrial-leak-detection", "industrial-meter-reading", "industrial.daily-monitoring-report"])
    );
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).not.toContain("claude-for-legal");
  });
});
