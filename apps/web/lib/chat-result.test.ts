import type { ArtifactRecord } from "@operator/core";
import { describe, expect, test } from "vitest";
import type { LegacyMastraChatResult } from "./operator-application/legacy-mastra-chat-result";
import { summarizeLegacyMastraChatResult } from "./chat-result";

describe("summarizeLegacyMastraChatResult", () => {
  test("prioritizes requested formats without hiding automatically generated deliverables", () => {
    const summary = summarizeLegacyMastraChatResult(baseResult(), {
      messages: [{ id: "test-guizang-request", role: "user", content: "请用 guizang ppt 生成演示文稿" }],
      artifacts: [
        artifact("output/chat_request.json", "json", "operator_chat"),
        artifact("deck.pptx", "pptx", "operator_agent", 1200),
        artifact("slides.html", "html", "operator_agent", 800),
        artifact("output/codex_stdout.log", "log", "operator_agent", 100)
      ]
    });

    expect(summary).toContain("目标产物：");
    expect(summary).toContain("deck.pptx");
    expect(summary).toContain("slides.html");
    expect(summary).toContain("预览 deck.pptx");
    expect(summary).toContain("下载 deck.pptx");
    expect(summary).not.toContain("chat_request.json");
    expect(summary).not.toContain("codex_stdout.log");
    expect(summary.indexOf("deck.pptx")).toBeLessThan(summary.indexOf("slides.html"));
  });

  test("does not expose selected skill reasons or trace summaries in the final chat text", () => {
    const result = {
      ...baseResult(),
      selected_skills: [
        {
          skill: "industrial-leak-detection",
          output_format: "industrial_analysis",
          reason: "User selected this skill scope. The selected skill package is exposed to the main agent for this run."
        }
      ],
      agent: {
        ...baseResult().agent,
        trace: [{ kind: "action", label: "Main agent attempt", detail: "codex-acp" }]
      }
    } satisfies LegacyMastraChatResult;

    const summary = summarizeLegacyMastraChatResult(result);

    expect(summary).not.toContain("智能体选择的能力");
    expect(summary).not.toContain("User selected this skill scope");
    expect(summary).not.toContain("智能体轨迹摘要");
    expect(summary).not.toContain("Main agent attempt");
  });

  test("does not prepend run metadata to selected skill results", () => {
    const result = {
      ...baseResult(),
      response: "已生成 8 页单文件横向 HTML 演示稿，可离线打开。",
      selected_skills: [
        {
          skill: "guizang-ppt-skill",
          output_format: "html",
          reason: "User selected this skill scope. The selected skill package is exposed to the main agent for this run."
        }
      ]
    } satisfies LegacyMastraChatResult;

    const summary = summarizeLegacyMastraChatResult(result);

    expect(summary).toBe("已生成 8 页单文件横向 HTML 演示稿，可离线打开。\n");
    expect(summary).not.toContain("任务已完成。");
    expect(summary).not.toContain("运行 ID：");
    expect(summary).not.toContain("工作区：/tmp/operator-chat-result-test");
  });

  test("prefers response-mentioned artifacts even when their file extension is not preconfigured", () => {
    const result = {
      ...baseResult(),
      response: "已生成 `adder_8bit.customhdl` 和 `adder_8bit_tb.customhdl`。"
    } satisfies LegacyMastraChatResult;
    const summary = summarizeLegacyMastraChatResult(result, {
      messages: [{ id: "test-verilog-request", role: "user", content: "写一段加法器的verilog代码" }],
      artifacts: [
        artifact("floorplan_85sqm_2br2hall.png", "png", "operator_agent", 53516),
        artifact("adder_8bit.customhdl", "customhdl", "operator_agent", 1888),
        artifact("adder_8bit_tb.customhdl", "customhdl", "operator_agent", 3060)
      ]
    });

    expect(summary).toContain("adder_8bit.customhdl");
    expect(summary).toContain("adder_8bit_tb.customhdl");
    expect(summary).not.toContain("floorplan_85sqm_2br2hall.png");
  });

  test("does not append duplicate target links when preview and download are already linked in the response", () => {
    const result = {
      ...baseResult(),
      response:
        "已生成最终文件：[预览 deck.pptx](/api/operator/artifact?workspace=%2Ftmp%2Foperator-chat-result-test&path=deck.pptx) / [下载 deck.pptx](/api/operator/artifact?workspace=%2Ftmp%2Foperator-chat-result-test&path=deck.pptx&download=1)。"
    } satisfies LegacyMastraChatResult;
    const summary = summarizeLegacyMastraChatResult(result, {
      artifacts: [artifact("deck.pptx", "pptx", "operator_agent", 1200)]
    });

    expect(summary).toContain("已生成最终文件");
    expect(summary).not.toContain("目标产物：");
    expect(summary).toContain("deck.pptx");
  });

  test("adds an explicit download link when the response only includes a preview link", () => {
    const result = {
      ...baseResult(),
      response:
        "已生成网页课件：[guizang_deck.html](/api/operator/artifact?workspace=%2Ftmp%2Foperator-chat-result-test&path=runs%2Fguizang-ppt-skill%2Foutput%2Fguizang_deck.html)。"
    } satisfies LegacyMastraChatResult;
    const summary = summarizeLegacyMastraChatResult(result, {
      messages: [{ id: "test-gaokao-math-request", role: "user", content: "做网页课件《上海高考数学压轴题解析》" }],
      artifacts: [artifact("runs/guizang-ppt-skill/output/guizang_deck.html", "html", "skill_guizang-ppt-skill", 111304)]
    });

    expect(summary).toContain("目标产物：");
    expect(summary).toContain("[下载 guizang_deck.html]");
    expect(summary).not.toContain("[预览 guizang_deck.html]");
    expect(summary).toContain("download=1");
  });

  test("adds an artifact link when the response only mentions the filename", () => {
    const result = {
      ...baseResult(),
      response: "已用图像生成工具生成孙悟空图片，并保存到工作区：sun_wukong_image2.png"
    } satisfies LegacyMastraChatResult;
    const summary = summarizeLegacyMastraChatResult(result, {
      messages: [{ id: "test-image-request", role: "user", content: "生成一张孙悟空的图片" }],
      artifacts: [artifact("output/sun_wukong_image2.png", "png", "operator_agent", 1024)]
    });

    expect(summary).toContain("sun_wukong_image2.png");
    expect(summary).toContain("/api/operator/artifact?");
    expect(summary).toContain("path=output%2Fsun_wukong_image2.png");
  });
});

function baseResult(): LegacyMastraChatResult {
  return {
    run_id: "test_run",
    status: "succeeded",
    response: "已完成。",
    workspace: "/tmp/operator-chat-result-test",
    agent: {
      id: "codex-acp",
      role: "default_main_execution_agent",
      runtime: "mastra-acp-agent",
      execution_status: "used",
      conversation_ids: [],
      trace: [],
      fallback_used: false
    },
    selected_skills: [],
    runs: [],
    outputs: {
      chatRequest: "output/chat_request.json",
      chatPlan: "output/chat_plan.json",
      chatResult: "output/chat_result.json",
      artifactManifest: "output/artifact_manifest.json"
    }
  };
}

function artifact(path: string, type: string, stepId: string, sizeBytes = 0): ArtifactRecord {
  return {
    name: path.split("/").at(-1) ?? path,
    type,
    path,
    mime_type: "application/octet-stream",
    size_bytes: sizeBytes,
    sha256: "",
    step_id: stepId,
    metadata: {}
  };
}
