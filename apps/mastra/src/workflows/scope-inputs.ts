import type { OperatorAgentMessage } from "../agents/runtime.js";
import type { OperatorWorkflowScope } from "../product-scopes/catalog.js";

export function workflowInputForScope(
  scopedWorkflow: OperatorWorkflowScope,
  messages: OperatorAgentMessage[],
  workspace: string,
  runId: string
) {
  const topic = latestUserMessage(messages);
  const base = {
    topic,
    output_format: scopedWorkflow.outputContract?.required_output_format,
    workspace,
    run_id: runId,
    workflow_id: scopedWorkflow.workflowId
  };

  if (scopedWorkflow.workflowId === "industrial.daily-monitoring-report") {
    return {
      ...base,
      audience: "运维、安环和设备管理人员",
      purpose: "汇总工业现场日常监测异常、仪表读数和整改建议",
      style: "图文并茂、LaTeX PDF、便于人工复核",
      constraints: [
        "优先使用工作区内已有工业视觉分析 JSON 和仪表读数 JSON",
        "图片证据来自 input/attachments 或 runs/industrial-* 下的现场图片",
        "报告必须生成 PDF、LaTeX 源文件、Markdown 摘要和结构化 JSON"
      ]
    };
  }

  if (scopedWorkflow.workflowId === "research.paper-from-results") {
    return {
      ...base,
      audience: "论文作者和研究负责人",
      purpose: "从实验或形式化结果包生成可复核的论文生产交付物",
      style: "证据优先、claim-backed、保守写作、图文并茂、产物可追踪",
      constraints: [
        "只使用 result bundle 和 claim-backed drafting context 允许的 claims",
        "默认使用 Mastra native TypeScript 论文管线，不依赖旧 Python 渲染器",
        "生成论文源码、质量报告、至少 20 篇参考文献、至少 2 张图和 private handoff",
        "作者写为算子AI，页眉和水印写为：算子AI生成，仅供参考",
        "默认不执行外部实验 deepening，除非显式开启 run_improvement_loop"
      ],
      paper_engine: "native_ts",
      result_bundle_path: inferResultBundlePath(topic)
    };
  }

  return base;
}

function latestUserMessage(messages: OperatorAgentMessage[]): string {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() || "工业日常监测报告"
  );
}

function inferResultBundlePath(text: string): string | undefined {
  const labeled = text.match(
    /(?:result_bundle_path|result bundle|result_bundle|domain_result_bundle|结果包|bundle)\s*[:：=]?\s*([`"']?)([^`"',，。；;\s]+)\1/iu
  );
  const raw = labeled?.[2] ?? text.match(/(?:\\\\wsl\.localhost\\Ubuntu\\|\/home\/|~\/|\.\/)[^\s，。；;'"`]+/iu)?.[0];
  return raw?.trim();
}
