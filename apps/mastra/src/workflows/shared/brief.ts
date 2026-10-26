import { artifactFromFile, resolveWorkspace, writeJson, writeText, workspacePath } from "@operator/core";
import { createTool } from "@mastra/core/tools";
import type { OperatorTaskInputData } from "../../schemas.js";
import { pptWorkflowInputSchema, normalizedBriefSchema } from "../../schemas.js";

export const normalizeBriefTool = createTool({
  id: "operator.presentation.normalize_brief",
  description: "Normalize a user PPT request into a Operator presentation brief.",
  inputSchema: pptWorkflowInputSchema,
  outputSchema: normalizedBriefSchema,
  execute: async (inputData: OperatorTaskInputData) => {
    const runId = inputData.run_id ?? `wr_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const workspace = resolveWorkspace(inputData.workspace, runId);
    const constraints = Array.isArray(inputData.constraints) ? inputData.constraints.filter((item: string) => item.trim()) : [];
    const brief = {
      topic: inputData.topic.trim(),
      audience: clean(inputData.audience, "专业用户"),
      purpose: clean(inputData.purpose, "说明关键方案并推动决策"),
      style: clean(inputData.style, "清晰、克制、专业"),
      constraints,
      quality_bar: [
        "每页只表达一个主观点",
        "产物必须进入 artifact manifest",
        "workflow 选择与 skill 执行边界清晰",
        "最终输出必须可下载、可审计、可复核"
      ]
    };

    const briefJson = "output/brief.json";
    const briefMarkdown = "output/brief.md";
    writeJson(workspacePath(workspace, briefJson), brief);
    writeText(
      workspacePath(workspace, briefMarkdown),
      [
        `# ${brief.topic}`,
        "",
        `- 受众：${brief.audience}`,
        `- 目标：${brief.purpose}`,
        `- 风格：${brief.style}`,
        "",
        "## 约束",
        ...constraints.map((item) => `- ${item}`),
        "",
        "## 质量标准",
        ...brief.quality_bar.map((item) => `- ${item}`),
        ""
      ].join("\n")
    );

    return {
      runId,
      workspace,
      input: { ...inputData, run_id: runId, workspace },
      brief,
      outputs: { briefJson, briefMarkdown },
      artifacts: [
        artifactFromFile({
          workspace,
          path: briefJson,
          stepId: "normalize_brief",
          name: "presentation_brief",
          type: "json"
        }),
        artifactFromFile({
          workspace,
          path: briefMarkdown,
          stepId: "normalize_brief",
          name: "presentation_brief_markdown",
          type: "md"
        })
      ]
    };
  }
});

function clean(value: string | undefined, fallback: string): string {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
}
