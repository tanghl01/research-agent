import { describe, expect, test } from "vitest";
import { getScopePromptPool, getScopePromptPoolStats, promptRequiresAttachment, sampleScopePrompts } from "./scope-prompts";

const visiblePromptScopeIds = [
  "guizang-ppt-skill",
  "ppt-master",
  "scientific-agent-skills",
  "qinyan-academic-skills",
  "research.paper-from-results",
  "text-to-cad"
];

describe("scope prompt pools", () => {
  test("keeps exactly 100 Chinese prompts for office, research, and design scope tags", () => {
    const stats = getScopePromptPoolStats();

    for (const scopeId of visiblePromptScopeIds) {
      expect(stats[scopeId]).toBe(100);
      const pool = getScopePromptPool(scopeId);
      expect(new Set(pool).size).toBe(100);
      const prompts = sampleScopePrompts(scopeId, `test:${scopeId}`);
      expect(prompts).toHaveLength(3);
      expect(prompts.every((prompt) => /[\u4e00-\u9fff]/u.test(prompt))).toBe(true);
    }
  });

  test("falls back to general prompts for the default agent", () => {
    const stats = getScopePromptPoolStats();
    const prompts = sampleScopePrompts(undefined, "default-test");
    expect(stats.default).toBeGreaterThanOrEqual(10);
    expect(prompts).toHaveLength(3);
    expect(prompts.every((prompt) => /[\u4e00-\u9fff]/u.test(prompt))).toBe(true);
  });

  test("keeps updated visible prompt suggestions self-contained except paper-from-results", () => {
    expect(promptRequiresAttachment("请在发送前上传巡检图片；请判断是否存在漏水。")).toBe(true);
    expect(promptRequiresAttachment("输出 PDF 报告《设备间巡检日报》，包含摘要、异常表和复检清单。")).toBe(false);
    expect(promptRequiresAttachment("生成 6 页本科课程讲义 PPTX《Transformer 自注意力机制入门》。")).toBe(false);

    const nonPaperPrompts = visiblePromptScopeIds
      .filter((scopeId) => scopeId !== "research.paper-from-results")
      .flatMap((scopeId) => getScopePromptPool(scopeId));
    expect(nonPaperPrompts.every((prompt) => !promptRequiresAttachment(prompt))).toBe(true);
    expect(nonPaperPrompts.every((prompt) => !requiresUserSuppliedContext(prompt))).toBe(true);

    const paperPrompts = getScopePromptPool("research.paper-from-results");
    expect(paperPrompts).toHaveLength(100);
    expect(paperPrompts.every((prompt) => promptRequiresAttachment(prompt))).toBe(true);
    expect(paperPrompts.every((prompt) => /结果包|result_bundle/u.test(prompt))).toBe(true);
  });
});

function requiresUserSuppliedContext(prompt: string): boolean {
  return /请在发送前上传|上传|附件|请提供|请补充|粘贴|我上传|我提供|根据我|下面这|下面的|待补充/u.test(prompt);
}
