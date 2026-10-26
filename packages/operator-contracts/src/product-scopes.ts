export type OperatorProductScopeKind = "agent" | "skill" | "workflow" | "tool";

export type OperatorSkillOutputFormat = "pptx" | "html" | "research" | "cad" | "legal" | "industrial_analysis" | "knowledge";

export type OperatorProductOutputFormat = OperatorSkillOutputFormat | "workflow_pack" | "markdown" | "pdf";

export type OperatorProductOutputContract = {
  required_output_format: OperatorProductOutputFormat;
  preferred_artifact_path?: string;
  required_slide_count_when_requested?: boolean;
};

export type OperatorSkillCatalogEntry = {
  skillId: string;
  subskillId?: string;
  mastraName: string;
  displayName: string;
  description: string;
  outputFormat: OperatorSkillOutputFormat;
  keywords: string[];
};

export type OperatorWorkflowCatalogEntry = {
  id: string;
  workflowId: string;
  displayName: string;
  description: string;
  keywords: string[];
  outputContract?: OperatorProductOutputContract;
};

export type OperatorToolCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  keywords: string[];
  outputFormat?: OperatorProductOutputFormat;
};

export type OperatorUserScopeItem = {
  id: string;
  kind: OperatorProductScopeKind;
  displayName: string;
  description: string;
  keywords: string[];
  outputFormat?: OperatorProductOutputFormat;
  available?: boolean;
  unavailableReason?: string;
  sourceRoot?: string;
};

export type OperatorUserScopeSelectionCatalog = {
  agents: OperatorUserScopeItem[];
  skills: OperatorUserScopeItem[];
  workflows: OperatorUserScopeItem[];
  tools: OperatorUserScopeItem[];
};

export const operatorSkillCatalog: OperatorSkillCatalogEntry[] = [
  {
    skillId: "GordenPPTSkill",
    mastraName: "gorden-ppt-skill",
    displayName: "GordenPPT",
    description: "基于 GordenPPTSkill 模板和渲染器生成可编辑的 PowerPoint 文件，适合正式汇报、课件和结构化商务材料。",
    outputFormat: "pptx",
    keywords: ["pptx", "powerpoint", "editable", "可编辑", "原生ppt", "gorden", "模板"]
  },
  {
    skillId: "guizang-ppt-skill",
    mastraName: "guizang-ppt-skill",
    displayName: "网页PPT",
    description: "生成单文件横向 HTML 演示稿，适合杂志风、瑞士风、网页课件和浏览器直接展示的视觉化材料。",
    outputFormat: "html",
    keywords: ["html", "web", "网页", "横向翻页", "guizang", "swiss", "瑞士", "杂志"]
  },
  {
    skillId: "ppt-master",
    mastraName: "ppt-master",
    displayName: "PPT大师",
    description: "按 SVG 优先的项目流程制作高视觉密度演示稿，并导出可编辑 PPTX，适合论文解读、技术蓝图和视觉型报告。",
    outputFormat: "pptx",
    keywords: ["ppt", "pptx", "svg", "presentation", "ppt-master", "可编辑", "母版", "视觉"]
  },
  {
    skillId: "scientific-agent-skills",
    mastraName: "scientific-agent-skills",
    displayName: "科研助手",
    description: "科研技能集合，覆盖文献综述、论文评审、数据分析、生物信息、化学、医学、可视化和科研写作等任务。",
    outputFormat: "research",
    keywords: ["science", "research", "paper", "literature", "bioinformatics", "科研", "论文", "文献"]
  },
  {
    skillId: "qinyan-academic-skills",
    mastraName: "qinyan-academic-skills",
    displayName: "沁言学术",
    description: "沁言学术科研论文 Skills 集合，覆盖论文检索、论文分析、引文格式、选题分析、论文润色、学术写作模板和科研示例。",
    outputFormat: "research",
    keywords: [
      "qinyan",
      "academic",
      "research",
      "paper search",
      "paper analysis",
      "citation",
      "topic analysis",
      "科研",
      "论文",
      "文献检索",
      "引文",
      "选题",
      "润色",
      "沁言"
    ]
  },
  {
    skillId: "dianji-assistant",
    mastraName: "dianji-assistant",
    displayName: "电机百事通",
    description: "优先检索上海电机学院本地知识库，查询公开新闻、通知、文档、附件、模板和表格，并支持下载与草稿填表。",
    outputFormat: "knowledge",
    keywords: ["knowledge", "education", "sdju", "上海电机学院", "电机", "高校", "通知", "公告", "新闻", "文档", "附件", "模板", "表格", "填表"]
  },
  {
    skillId: "text-to-cad",
    mastraName: "text-to-cad",
    displayName: "文本转 CAD",
    description: "面向 CAD、CAM、机器人描述和制造交付的技能集合，可从文字、图纸或参考图生成并校验 STEP、DXF、G-code 等工程产物。",
    outputFormat: "cad",
    keywords: ["text-to-cad", "collection", "cad", "cam", "manufacturing", "3d", "robot", "step", "dxf", "硬件", "建模"]
  },
  {
    skillId: "claude-for-legal",
    mastraName: "claude-for-legal",
    displayName: "法律助手",
    description: "法律工作流和技能集合，覆盖合同审查、隐私合规、AI 治理、监管跟踪、诉讼、知识产权和法务学习场景。",
    outputFormat: "legal",
    keywords: ["legal", "law", "contract", "privacy", "compliance", "法律", "合同", "合规"]
  },
  {
    skillId: "industrial-leak-detection",
    mastraName: "industrial-leak-detection",
    displayName: "工业泄漏识别",
    description: "分析工业巡检图片中的漏水、漏油、地面积水、水渍、喷射水雾和疑似气体泄漏视觉线索，输出结构化证据。",
    outputFormat: "industrial_analysis",
    keywords: [
      "industrial",
      "inspection",
      "leak",
      "water leak",
      "oil leak",
      "spray mist",
      "gas leak",
      "工业",
      "巡检",
      "漏水",
      "漏油",
      "水渍",
      "喷射水雾",
      "漏气"
    ]
  },
  {
    skillId: "industrial-meter-reading",
    mastraName: "industrial-meter-reading",
    displayName: "工业仪表读数",
    description: "从工业巡检图片中读取指针表、LED 数显表和其他仪表信息，输出读数、单位、置信度和可见证据。",
    outputFormat: "industrial_analysis",
    keywords: [
      "industrial",
      "inspection",
      "meter",
      "gauge",
      "analog pointer",
      "digital led",
      "reading",
      "工业",
      "巡检",
      "仪表",
      "指针表",
      "LED",
      "数显",
      "读数"
    ]
  }
];

export const operatorWorkflowCatalog: OperatorWorkflowCatalogEntry[] = [
  {
    id: "system.skill2workflow",
    workflowId: "system.skill2workflow",
    displayName: "Skill to Workflow Converter",
    description: "Convert text-heavy open-source skills into generated Mastra workflow packs.",
    keywords: ["skill2workflow", "workflow_pack", "conversion", "codex", "mastra"],
    outputContract: {
      required_output_format: "workflow_pack"
    }
  },
  {
    id: "industrial.daily-monitoring-report",
    workflowId: "industrial.daily-monitoring-report",
    displayName: "工业日常监测报告",
    description:
      "Use Mastra workflow tools to compile industrial leak findings and meter readings into a graphical LaTeX PDF daily report.",
    keywords: [
      "industrial",
      "monitoring",
      "report",
      "latex",
      "pdf",
      "inspection",
      "工业",
      "巡检",
      "日报",
      "监测报告",
      "漏水",
      "漏油",
      "仪表",
      "PDF"
    ],
    outputContract: {
      required_output_format: "pdf",
      preferred_artifact_path: "runs/industrial-daily-report/output/industrial_daily_report.pdf"
    }
  },
  {
    id: "research.paper-from-results",
    workflowId: "research.paper-from-results",
    displayName: "用实验结果写论文",
    description:
      "Use the Mastra-native TypeScript paper pipeline to validate result bundles, build claim-backed drafting context, score evidence gates, and produce branded manuscript handoff artifacts.",
    keywords: [
      "research",
      "paper",
      "manuscript",
      "ara",
      "mastra",
      "native_ts",
      "result_bundle",
      "evidence",
      "references",
      "figures",
      "handoff",
      "论文",
      "实验数据",
      "结果包",
      "证据评分",
      "写作"
    ],
    outputContract: {
      required_output_format: "research",
      preferred_artifact_path: "runs/research-paper/output/paper_pipeline_summary.md"
    }
  }
];

export const operatorToolCatalog: OperatorToolCatalogEntry[] = [
  {
    id: "operator.knowledge.search",
    displayName: "电机知识库检索",
    description: "Search the Operator Knowledge Base for SDJU public notices, news, documents, forms, templates, and downloadable files.",
    keywords: ["knowledge", "education", "sdju", "电机", "上海电机学院", "通知", "公告", "新闻", "文档", "附件", "表格", "模板"],
    outputFormat: "knowledge"
  },
  {
    id: "operator.knowledge.fetch",
    displayName: "电机知识条目读取",
    description: "Fetch a specific Operator Knowledge Base item by id, including the latest version and source file metadata.",
    keywords: ["knowledge", "fetch", "item", "sdju", "电机", "上海电机学院", "来源", "附件", "下载"],
    outputFormat: "knowledge"
  },
  {
    id: "operator.knowledge.find_template",
    displayName: "电机模板检索",
    description: "Find public SDJU templates and forms in the Operator Knowledge Base.",
    keywords: ["knowledge", "template", "form", "docx", "xlsx", "电机", "上海电机学院", "模板", "表格", "表单"],
    outputFormat: "knowledge"
  },
  {
    id: "operator.knowledge.fill_template",
    displayName: "电机模板填充",
    description: "Generate a DOCX/XLSX draft artifact from a public SDJU template candidate and user-provided fields.",
    keywords: ["knowledge", "template", "form", "docx", "xlsx", "artifact", "电机", "上海电机学院", "模板", "表格", "填表"],
    outputFormat: "knowledge"
  }
];

export function listOperatorSkillCatalog(): OperatorSkillCatalogEntry[] {
  return operatorSkillCatalog.map(cloneSkillEntry);
}

export function getOperatorSkillByMastraName(name: string): OperatorSkillCatalogEntry | undefined {
  const skill = operatorSkillCatalog.find((entry) => entry.mastraName === name);
  return skill ? cloneSkillEntry(skill) : undefined;
}

export function listOperatorWorkflowCatalog(): OperatorWorkflowCatalogEntry[] {
  return operatorWorkflowCatalog.map(cloneWorkflowEntry);
}

export function listOperatorToolCatalog(): OperatorToolCatalogEntry[] {
  return operatorToolCatalog.map(cloneToolEntry);
}

export function listUserScopeSelectionCatalog(): OperatorUserScopeSelectionCatalog {
  return {
    agents: [],
    skills: listOperatorSkillCatalog().map((skill) => ({
      id: skill.mastraName,
      kind: "skill" as const,
      displayName: skill.displayName,
      description: skill.description,
      keywords: [...skill.keywords],
      outputFormat: skill.outputFormat
    })),
    workflows: listOperatorWorkflowCatalog()
      .filter((workflow) => workflow.id.startsWith("industrial.") || workflow.id.startsWith("research."))
      .map((workflow) => ({
        id: workflow.id,
        kind: "workflow" as const,
        displayName: workflow.displayName,
        description: workflow.description,
        keywords: [...workflow.keywords],
        outputFormat: workflow.outputContract?.required_output_format
      })),
    tools: listOperatorToolCatalog().map((tool) => ({
      id: tool.id,
      kind: "tool" as const,
      displayName: tool.displayName,
      description: tool.description,
      keywords: [...tool.keywords],
      outputFormat: tool.outputFormat
    }))
  };
}

function cloneSkillEntry(entry: OperatorSkillCatalogEntry): OperatorSkillCatalogEntry {
  return {
    ...entry,
    keywords: [...entry.keywords]
  };
}

function cloneWorkflowEntry(entry: OperatorWorkflowCatalogEntry): OperatorWorkflowCatalogEntry {
  return {
    ...entry,
    keywords: [...entry.keywords],
    outputContract: entry.outputContract ? { ...entry.outputContract } : undefined
  };
}

function cloneToolEntry(entry: OperatorToolCatalogEntry): OperatorToolCatalogEntry {
  return {
    ...entry,
    keywords: [...entry.keywords]
  };
}
