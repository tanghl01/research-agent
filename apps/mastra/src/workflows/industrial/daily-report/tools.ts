import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import {
  artifactFromFile,
  readJson,
  resolveWorkspace,
  runCommand,
  validateFileExists,
  validateMinFileSize,
  writeJson,
  writeText,
  workspacePath
} from "@operator/core";
import { operatorTaskInputSchema, workflowDeliverySchema } from "../../../schemas.js";
import {
  industrialReportDataSchema,
  industrialReportRenderedSchema,
  type IndustrialReportData,
  type IndustrialReportRenderedData
} from "./schemas.js";

const workflowId = "industrial.daily-monitoring-report";
const outputDir = "runs/industrial-daily-report/output";

type JsonRecord = Record<string, unknown>;

export const prepareIndustrialMonitoringDataTool = createTool({
  id: "operator.industrial.prepare_monitoring_data",
  description: "Collect industrial analysis JSON files and image attachments from the task workspace.",
  inputSchema: operatorTaskInputSchema,
  outputSchema: industrialReportDataSchema,
  execute: async (inputData) => {
    const runId = inputData.run_id ?? `wr_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const workspace = resolveWorkspace(inputData.workspace, runId);
    const topic = inputData.topic.trim();
    const constraints = Array.isArray(inputData.constraints) ? inputData.constraints.filter(Boolean) : [];
    const imagePaths = discoverImagePaths(workspace);
    const dataPaths = discoverJsonDataPaths(workspace);
    const parsedData = dataPaths.flatMap((dataPath) => safeReadJson(workspace, dataPath).map((value) => ({ path: dataPath, value })));
    const findings = [
      ...parsedData.flatMap(({ path: dataPath, value }) => extractFindings(value, dataPath)),
      ...fallbackFindingsFromText(topic)
    ];
    const readings = [
      ...parsedData.flatMap(({ path: dataPath, value }) => extractReadings(value, dataPath)),
      ...fallbackReadingsFromText(topic)
    ];
    const riskLevel = highestRisk(findings, readings);
    const dataQuality =
      dataPaths.length || findings.length || readings.length
        ? "已接收结构化分析数据，报告按可用字段汇总。"
        : "未发现结构化工业分析数据，报告仅基于用户描述和附件清单生成。";
    const brief = {
      topic,
      audience: inputData.audience?.trim() || "运维、安环和设备管理人员",
      purpose: inputData.purpose?.trim() || "汇总工业现场日常监测异常、仪表读数和整改建议",
      style: inputData.style?.trim() || "图文并茂、便于巡检复核",
      constraints,
      quality_bar: [
        "清楚区分图像证据、仪表数据和人工待复核项",
        "高风险异常必须给出处理建议",
        "PDF 必须由 LaTeX 源文件生成",
        "报告产物必须进入 artifact manifest"
      ]
    };
    const industrial = {
      site: inferSite(topic),
      reportDate: new Date().toISOString().slice(0, 10),
      riskLevel,
      summary: summaryText(findings, readings, imagePaths),
      dataQuality,
      imageCount: imagePaths.length,
      findingCount: findings.length,
      readingCount: readings.length
    };

    const data: IndustrialReportData = {
      runId,
      workflowId,
      workspace,
      outputFormat: "pdf",
      input: { ...inputData, run_id: runId, workspace, workflow_id: workflowId },
      brief,
      outputs: {
        briefJson: `${outputDir}/monitoring_data.json`,
        briefMarkdown: `${outputDir}/monitoring_data.md`
      },
      artifacts: [],
      industrial,
      industrialInputs: {
        imagePaths,
        dataPaths
      },
      findings,
      readings
    };

    writeJson(workspacePath(workspace, data.outputs.briefJson), {
      schema: "operator.industrial.daily_monitoring_data.v1",
      industrial,
      findings,
      readings,
      inputs: data.industrialInputs
    });
    writeText(workspacePath(workspace, data.outputs.briefMarkdown), renderMonitoringDataMarkdown(data));
    data.artifacts = [
      artifactFromFile({
        workspace,
        path: data.outputs.briefJson,
        stepId: "industrial_prepare_data",
        name: "industrial_monitoring_data",
        type: "json"
      }),
      artifactFromFile({
        workspace,
        path: data.outputs.briefMarkdown,
        stepId: "industrial_prepare_data",
        name: "industrial_monitoring_data_markdown",
        type: "md"
      })
    ];
    return data;
  }
});

export const renderIndustrialDailyReportTool = createTool({
  id: "operator.industrial.render_daily_report",
  description: "Render a graphical LaTeX daily monitoring report and compile it to PDF.",
  inputSchema: industrialReportDataSchema,
  outputSchema: industrialReportRenderedSchema,
  execute: async (inputData) => {
    const workspace = inputData.workspace;
    const absoluteOutputDir = workspacePath(workspace, outputDir);
    mkdirSync(absoluteOutputDir, { recursive: true });

    const reportJson = `${outputDir}/industrial_daily_report.json`;
    const reportMarkdown = `${outputDir}/industrial_daily_report.md`;
    const reportTex = `${outputDir}/industrial_daily_report.tex`;
    const reportPdf = `${outputDir}/industrial_daily_report.pdf`;
    const latex = renderLatexReport(inputData, absoluteOutputDir);
    writeJson(workspacePath(workspace, reportJson), {
      schema: "operator.industrial.daily_report.v1",
      industrial: inputData.industrial,
      findings: inputData.findings,
      readings: inputData.readings,
      inputs: inputData.industrialInputs
    });
    writeText(workspacePath(workspace, reportMarkdown), renderReportMarkdown(inputData));
    writeText(workspacePath(workspace, reportTex), latex);
    await compileLatex(absoluteOutputDir, "industrial_daily_report.tex");
    if (!existsSync(workspacePath(workspace, reportPdf))) {
      throw new Error(`LaTeX did not produce expected PDF: ${reportPdf}`);
    }

    const artifacts = [
      ...inputData.artifacts,
      artifactFromFile({
        workspace,
        path: reportJson,
        stepId: "industrial_render_report",
        name: "industrial_daily_report_data",
        type: "json"
      }),
      artifactFromFile({
        workspace,
        path: reportMarkdown,
        stepId: "industrial_render_report",
        name: "industrial_daily_report_markdown",
        type: "md"
      }),
      artifactFromFile({
        workspace,
        path: reportTex,
        stepId: "industrial_render_report",
        name: "industrial_daily_report_latex",
        type: "tex"
      }),
      artifactFromFile({ workspace, path: reportPdf, stepId: "industrial_render_report", name: "industrial_daily_report_pdf", type: "pdf" })
    ];

    return {
      ...inputData,
      outputs: {
        ...inputData.outputs,
        reportJson,
        reportMarkdown,
        reportTex,
        reportPdf
      },
      artifacts,
      usage: {
        latex_engine: "xelatex",
        image_count: inputData.industrialInputs.imagePaths.length,
        finding_count: inputData.findings.length,
        reading_count: inputData.readings.length
      },
      logs: []
    };
  }
});

export const validateIndustrialDailyReportTool = createTool({
  id: "operator.industrial.validate_daily_report",
  description: "Validate industrial daily report PDF, LaTeX source, JSON data, and Markdown summary.",
  inputSchema: industrialReportRenderedSchema,
  outputSchema: workflowDeliverySchema,
  execute: async (inputData) => {
    const reportPdf = requiredOutput(inputData, "reportPdf");
    const checks = [
      validateFileExists(inputData.workspace, reportPdf),
      validateMinFileSize(inputData.workspace, reportPdf, 2_000),
      validateFileExists(inputData.workspace, requiredOutput(inputData, "reportTex")),
      validateFileExists(inputData.workspace, requiredOutput(inputData, "reportJson")),
      validateFileExists(inputData.workspace, requiredOutput(inputData, "reportMarkdown"))
    ];
    return {
      ...inputData,
      validation: {
        validated: true as const,
        checks
      }
    };
  }
});

export const industrialDailyReportTools = {
  prepareIndustrialMonitoringDataTool,
  renderIndustrialDailyReportTool,
  validateIndustrialDailyReportTool
} as const;

function discoverImagePaths(workspace: string): string[] {
  return listWorkspaceFiles(workspace)
    .filter((filePath) => /^input\/attachments\//u.test(filePath) || /^runs\/industrial-/u.test(filePath))
    .filter((filePath) => /\.(?:png|jpe?g|webp)$/iu.test(filePath))
    .slice(0, 12);
}

function discoverJsonDataPaths(workspace: string): string[] {
  return listWorkspaceFiles(workspace)
    .filter((filePath) => /\.json$/iu.test(filePath))
    .filter((filePath) => !/^output\/(?:chat_|artifact_manifest)/u.test(filePath))
    .filter((filePath) => !/^input\/attachments\//u.test(filePath))
    .filter((filePath) => /industrial|leak|meter|reading|monitor|analysis|report/iu.test(filePath))
    .slice(0, 30);
}

function listWorkspaceFiles(workspace: string, relativeDir = ""): string[] {
  const absoluteDir = workspacePath(workspace, relativeDir || ".");
  if (!existsSync(absoluteDir)) return [];
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name).split(path.sep).join("/");
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return listWorkspaceFiles(workspace, relativePath);
    return entry.isFile() ? [relativePath] : [];
  });
}

function safeReadJson(workspace: string, relativePath: string): Array<unknown> {
  try {
    return [readJson(workspacePath(workspace, relativePath))];
  } catch {
    return [];
  }
}

function extractFindings(value: unknown, source: string) {
  const records = collectRecords(value).filter(isFindingRecord);
  return records
    .map((record) => ({
      source,
      type: stringValue(record.type) || stringValue(record.finding_type) || stringValue(record.category) || "industrial_observation",
      severity: normalizeSeverity(stringValue(record.severity) || stringValue(record.risk_level)),
      confidence: numberValue(record.confidence, 0.5),
      evidence: stringValue(record.evidence) || stringValue(record.description) || stringValue(record.notes) || "来自结构化分析数据。",
      recommended_action: stringValue(record.recommended_action) || stringValue(record.action),
      image_path: stringValue(record.image_path) || stringValue(record.path)
    }))
    .filter((finding) => !/normal/iu.test(finding.type) || finding.evidence);
}

function extractReadings(value: unknown, source: string) {
  const records = collectRecords(value).filter(isReadingRecord);
  return records.map((record) => ({
    source,
    meter_type: stringValue(record.meter_type) || stringValue(record.type) || "unknown",
    value: numberOrString(record.value),
    unit: stringValue(record.unit),
    display_text: stringValue(record.display_text) || stringValue(record.text),
    confidence: numberValue(record.confidence, 0.5),
    status: stringValue(record.status) || "unknown",
    evidence: stringValue(record.evidence) || stringValue(record.description) || "来自结构化仪表读数数据。",
    image_path: stringValue(record.image_path) || stringValue(record.path)
  }));
}

function collectRecords(value: unknown): JsonRecord[] {
  const records: JsonRecord[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    records.push(item);
    for (const key of ["findings", "readings", "measurements", "images", "results", "detections"]) visit(item[key]);
  };
  visit(value);
  return records;
}

function fallbackFindingsFromText(text: string) {
  const findings = [];
  const candidates = [
    ["water_leak", /漏水|渗水|喷水|喷射水雾|water leak|spray/iu],
    ["oil_leak", /漏油|油污|oil leak/iu],
    ["water_stain", /水渍|积水|wet floor|stain/iu],
    ["suspected_gas_leak_proxy", /漏气|气体|gas leak|vapor|mist/iu]
  ] as const;
  for (const [type, pattern] of candidates) {
    if (pattern.test(text)) {
      findings.push({
        source: "user_prompt",
        type,
        severity: type === "suspected_gas_leak_proxy" ? "high" : "medium",
        confidence: 0.35,
        evidence: "用户描述中包含该异常关键词，需结合现场图片复核。",
        recommended_action: "安排现场复核并补充照片证据。"
      });
    }
  }
  return findings;
}

function fallbackReadingsFromText(text: string) {
  const matches = [...text.matchAll(/([+-]?\d+(?:\.\d+)?)\s*(MPa|kPa|bar|℃|°C|V|A|mA|Hz|rpm|%)/giu)];
  return matches.slice(0, 12).map((match) => ({
    source: "user_prompt",
    meter_type: "unknown",
    value: Number(match[1]),
    unit: match[2],
    display_text: `${match[1]} ${match[2]}`,
    confidence: 0.4,
    status: "unknown",
    evidence: "用户文本中出现疑似仪表读数。"
  }));
}

function highestRisk(findings: Array<{ severity: string }>, readings: Array<{ status: string }>): string {
  const scores: Record<string, number> = { unknown: 0, low: 1, normal: 1, medium: 2, warning: 2, high: 3, alarm: 3, critical: 4 };
  const values = [
    ...findings.map((finding) => scores[finding.severity.toLowerCase()] ?? 0),
    ...readings.map((reading) => scores[reading.status.toLowerCase()] ?? 0)
  ];
  const max = Math.max(0, ...values);
  return max >= 4 ? "critical" : max === 3 ? "high" : max === 2 ? "medium" : max === 1 ? "low" : "unknown";
}

function summaryText(findings: Array<unknown>, readings: Array<unknown>, imagePaths: string[]): string {
  return `本次汇总包含 ${imagePaths.length} 张现场图片、${findings.length} 条异常发现、${readings.length} 条仪表读数。`;
}

function inferSite(text: string): string {
  const match = /(?:站点|车间|区域|装置|site|area)[:：]\s*([^\n,，。]+)/iu.exec(text);
  return match?.[1]?.trim() || "未指定工业现场";
}

function renderMonitoringDataMarkdown(data: IndustrialReportData): string {
  return [
    `# ${data.brief.topic}`,
    "",
    `- 报告日期：${data.industrial.reportDate}`,
    `- 现场：${data.industrial.site}`,
    `- 风险等级：${data.industrial.riskLevel}`,
    `- 图片数量：${data.industrial.imageCount}`,
    `- 异常数量：${data.industrial.findingCount}`,
    `- 读数数量：${data.industrial.readingCount}`,
    "",
    data.industrial.dataQuality,
    ""
  ].join("\n");
}

function renderReportMarkdown(data: IndustrialReportData): string {
  return [
    `# 工业日常监测报告`,
    "",
    data.industrial.summary,
    "",
    "## 异常发现",
    ...(data.findings.length
      ? data.findings.map((item, index) => `${index + 1}. ${item.type} / ${item.severity} / ${item.evidence}`)
      : ["未发现结构化异常记录。"]),
    "",
    "## 仪表读数",
    ...(data.readings.length
      ? data.readings.map((item, index) => `${index + 1}. ${item.display_text ?? item.value ?? "未知"} ${item.unit ?? ""} / ${item.status}`)
      : ["未发现结构化仪表读数。"]),
    ""
  ].join("\n");
}

function renderLatexReport(data: IndustrialReportData, absoluteOutputDir: string): string {
  const imageBlocks = data.industrialInputs.imagePaths.slice(0, 6).map((imagePath, index) => {
    const absoluteImage = workspacePath(data.workspace, imagePath);
    const relativeImage = toPosix(path.relative(absoluteOutputDir, absoluteImage));
    return [
      "\\begin{figure}[h]",
      "\\centering",
      `\\includegraphics[width=0.82\\linewidth,height=0.32\\textheight,keepaspectratio]{${latexPath(relativeImage)}}`,
      `\\caption{现场图片 ${index + 1}: ${escapeLatex(imagePath)}}`,
      "\\end{figure}"
    ].join("\n");
  });
  return [
    "\\documentclass[UTF8,11pt]{ctexart}",
    "\\usepackage[a4paper,margin=1.8cm]{geometry}",
    "\\usepackage{graphicx}",
    "\\usepackage[table]{xcolor}",
    "\\usepackage{booktabs,longtable,array}",
    "\\usepackage{hyperref}",
    "\\usepackage{float}",
    "\\usepackage{fancyhdr}",
    "\\pagestyle{fancy}",
    "\\fancyhf{}",
    "\\lhead{工业日常监测}",
    "\\rhead{Operator}",
    "\\cfoot{\\thepage}",
    "\\definecolor{operatorRed}{HTML}{B42318}",
    "\\definecolor{operatorAmber}{HTML}{B54708}",
    "\\definecolor{operatorGreen}{HTML}{027A48}",
    "\\definecolor{operatorBlue}{HTML}{175CD3}",
    "\\begin{document}",
    "\\begin{center}",
    "{\\LARGE\\bfseries 工业日常监测报告}\\\\[6pt]",
    `{\\large ${escapeLatex(data.industrial.site)} \\quad ${escapeLatex(data.industrial.reportDate)}}`,
    "\\end{center}",
    "\\vspace{0.5em}",
    "\\noindent\\fcolorbox{black!15}{black!3}{\\begin{minipage}{0.96\\linewidth}",
    `\\textbf{综合风险：} ${riskLabel(data.industrial.riskLevel)}\\\\`,
    `\\textbf{摘要：} ${escapeLatex(data.industrial.summary)}\\\\`,
    `\\textbf{数据质量：} ${escapeLatex(data.industrial.dataQuality)}`,
    "\\end{minipage}}",
    "\\section*{现场图片}",
    imageBlocks.length ? imageBlocks.join("\n") : "\\noindent 未提供现场图片附件。\\\\",
    "\\section*{异常发现}",
    renderFindingsTable(data),
    "\\section*{仪表读数}",
    renderReadingsTable(data),
    "\\section*{处置建议}",
    renderActions(data),
    "\\end{document}"
  ].join("\n");
}

function renderFindingsTable(data: IndustrialReportData): string {
  if (!data.findings.length) return "\\noindent 未发现结构化异常记录。\\\\";
  return [
    "\\small",
    "\\begin{longtable}{p{0.18\\linewidth}p{0.12\\linewidth}p{0.12\\linewidth}p{0.46\\linewidth}}",
    "\\toprule",
    "类型 & 严重度 & 置信度 & 证据 \\\\",
    "\\midrule",
    ...data.findings.map(
      (item) =>
        `${escapeLatex(item.type)} & ${escapeLatex(item.severity)} & ${Math.round(item.confidence * 100)}\\% & ${escapeLatex(item.evidence)} \\\\`
    ),
    "\\bottomrule",
    "\\end{longtable}",
    "\\normalsize"
  ].join("\n");
}

function renderReadingsTable(data: IndustrialReportData): string {
  if (!data.readings.length) return "\\noindent 未发现结构化仪表读数。\\\\";
  return [
    "\\small",
    "\\begin{longtable}{p{0.18\\linewidth}p{0.20\\linewidth}p{0.12\\linewidth}p{0.38\\linewidth}}",
    "\\toprule",
    "仪表类型 & 读数 & 状态 & 证据 \\\\",
    "\\midrule",
    ...data.readings.map(
      (item) =>
        `${escapeLatex(item.meter_type)} & ${escapeLatex(String(item.display_text ?? item.value ?? "未知"))} ${escapeLatex(item.unit ?? "")} & ${escapeLatex(item.status)} & ${escapeLatex(item.evidence)} \\\\`
    ),
    "\\bottomrule",
    "\\end{longtable}",
    "\\normalsize"
  ].join("\n");
}

function renderActions(data: IndustrialReportData): string {
  const actions = data.findings.map((finding) => finding.recommended_action).filter((item): item is string => Boolean(item?.trim()));
  const defaults =
    data.industrial.riskLevel === "high" || data.industrial.riskLevel === "critical"
      ? ["立即安排现场复核；必要时隔离区域、挂牌并通知安环/设备负责人。"]
      : ["按巡检计划复核异常点位，补充同角度复拍图片并记录处理闭环。"];
  return [
    "\\begin{enumerate}",
    ...[...actions, ...defaults].slice(0, 8).map((item) => `\\item ${escapeLatex(item)}`),
    "\\end{enumerate}"
  ].join("\n");
}

async function compileLatex(cwd: string, texFile: string): Promise<void> {
  await runCommand("xelatex", ["-interaction=nonstopmode", "-halt-on-error", texFile], { cwd, timeoutMs: 120_000 });
}

function requiredOutput(inputData: IndustrialReportRenderedData, key: string): string {
  const value = inputData.outputs[key];
  if (!value) throw new Error(`Industrial report output is missing required key: ${key}`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAnyKey(record: JsonRecord, keys: string[]): boolean {
  return keys.some((key) => key in record);
}

function isFindingRecord(record: JsonRecord): boolean {
  return hasAnyKey(record, [
    "type",
    "finding",
    "finding_type",
    "category",
    "severity",
    "risk_level",
    "evidence",
    "description",
    "recommended_action",
    "action"
  ]);
}

function isReadingRecord(record: JsonRecord): boolean {
  return hasAnyKey(record, ["meter_type", "value", "unit", "display_text", "text", "status", "evidence", "description"]);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrString(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : value.trim();
  }
  return undefined;
}

function normalizeSeverity(value: string): string {
  const normalized = value.toLowerCase();
  if (["critical", "high", "medium", "low"].includes(normalized)) return normalized;
  if (/严重|紧急|critical/u.test(value)) return "critical";
  if (/高|alarm|high/u.test(value)) return "high";
  if (/中|warning|medium/u.test(value)) return "medium";
  if (/低|low|normal/u.test(value)) return "low";
  return "unknown";
}

function riskLabel(risk: string): string {
  const color =
    risk === "critical" || risk === "high"
      ? "operatorRed"
      : risk === "medium"
        ? "operatorAmber"
        : risk === "low"
          ? "operatorGreen"
          : "operatorBlue";
  return `\\textcolor{${color}}{\\textbf{${escapeLatex(risk)}}}`;
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/gu, "\\textbackslash{}")
    .replace(/[{}]/gu, (match) => `\\${match}`)
    .replace(/[#$%&_]/gu, (match) => `\\${match}`)
    .replace(/\^/gu, "\\textasciicircum{}")
    .replace(/~/gu, "\\textasciitilde{}");
}

function latexPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/([{}#%&])/gu, "\\$1");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
