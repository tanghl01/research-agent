import type { ScopeItem } from "@/lib/scopes";

export type ScopeTask = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  outputs: string[];
};

export type ScopeGuide = {
  summary: string;
  notice?: string;
  outputs: string[];
  tasks: ScopeTask[];
  advanced: string[];
};

const scopeGuides: Record<string, ScopeGuide> = {
  "dianji-assistant": {
    summary: "优先检索上海电机学院本地知识库，用于查询公开新闻、通知、公告、政策、附件、模板和表格，并可生成可下载的填表草稿。",
    notice: "本技能只使用公开资料；本地知识库未命中时会明确说明，不应编造政策、截止日期、联系方式或办事要求。",
    outputs: ["带来源回答", "资料清单", "附件下载链接", "模板候选", "DOCX/XLSX 草稿"],
    tasks: [
      {
        id: "notice-search",
        title: "查通知",
        description: "按关键词、事项或时间查找电机官网公开通知和公告。",
        prompt: "查询上海电机学院最近关于奖学金的通知，按标题、发布时间、来源链接和重点事项整理。",
        outputs: ["通知列表", "来源链接", "重点摘要"]
      },
      {
        id: "document-search",
        title: "找资料",
        description: "检索培养方案、办事流程、政策文件和附件资料。",
        prompt: "查找上海电机学院学生请假相关公开资料，列出依据、流程、可下载文件和不确定信息。",
        outputs: ["资料清单", "流程摘要", "下载链接"]
      },
      {
        id: "template-fill",
        title: "填表草稿",
        description: "基于公开模板生成 DOCX/XLSX 草稿，不自动提交。",
        prompt: "帮我找电机公开的申请表模板，并告诉我需要提供哪些字段才能生成草稿。",
        outputs: ["模板候选", "字段清单", "草稿 artifact"]
      }
    ],
    advanced: ["本地知识库优先检索", "官网来源引用", "附件下载", "模板识别", "DOCX/XLSX 草稿生成"]
  },
  "qinyan-academic-skills": {
    summary: "用于论文检索、论文分析、引用格式、选题分析、论文润色和学术写作模板。适合把科研问题转成有来源、有边界、可复核的研究产物。",
    notice: "沁言 OpenAPI 子技能需要配置 QINYAN_API_KEY；未配置时应明确说明限制，不能伪造论文、DOI、卷期页码或研究趋势。",
    outputs: ["文献综述", "论文分析", "引用格式", "选题建议", "润色稿", "复核清单"],
    tasks: [
      {
        id: "paper-search",
        title: "论文检索",
        description: "围绕明确主题检索论文，并按数据库、年份、方法和结论整理。",
        prompt: "检索“AI agent 科研工作流”相关论文，输出中文综述，包含检索策略、代表文献、主要方法、研究空白和局限。",
        outputs: ["检索策略", "文献列表", "研究空白"]
      },
      {
        id: "paper-analysis",
        title: "论文分析",
        description: "分析单篇论文的研究目标、方法、发现和限制。",
        prompt: "分析论文 Attention Is All You Need，输出研究目标、方法论、主要贡献、局限和可复现线索。",
        outputs: ["结构化分析", "贡献总结", "局限说明"]
      },
      {
        id: "citation-format",
        title: "引用格式",
        description: "生成 GB/T 7714、APA、IEEE 等格式，并标注缺失元数据。",
        prompt: "整理 Transformer 相关 5 篇代表论文的 GB/T 7714、APA 和 IEEE 引用格式，缺失字段必须标注。",
        outputs: ["引用清单", "缺失字段", "核验建议"]
      },
      {
        id: "topic-analysis",
        title: "选题分析",
        description: "基于文献检索结果提出差异化、可执行的研究选题。",
        prompt: "围绕“大语言模型在教育评价中的应用”生成 3 个研究选题，每个包含研究价值、内容概述、难点和代表文献。",
        outputs: ["选题建议", "研究价值", "相关文献"]
      },
      {
        id: "paper-polish",
        title: "论文润色",
        description: "只优化学术表达，不添加新数据、新结论或未经证实的主张。",
        prompt: "润色一段关于生成式 AI 辅助科研写作规范的中文学术摘要，并附主要修改说明。",
        outputs: ["润色文本", "修改说明", "风险提示"]
      },
      {
        id: "academic-template",
        title: "写作模板",
        description: "生成摘要、引言、开题报告、基金申请等学术写作结构。",
        prompt: "为“图神经网络在材料性质预测中的进展”生成开题报告框架，包含背景、问题、方法、数据和时间计划。",
        outputs: ["报告框架", "章节要点", "复核清单"]
      }
    ],
    advanced: ["沁言 OpenAPI 文献检索", "论文元数据核验", "引用格式转换", "选题差异化分析", "学术润色边界控制"]
  },
  "claude-for-legal": {
    summary: "用于合同、隐私合规、法规检索和法律文档整理。适合把模糊法律问题转成可审查、可修改、可复核的文档产物。",
    notice: "输出内容用于辅助分析和起草，不替代持牌律师的正式法律意见。",
    outputs: ["风险清单", "条款解释", "修改建议", "文档草稿", "复核清单"],
    tasks: [
      {
        id: "contract-review",
        title: "合同审查",
        description: "识别付款、违约、解除、保密、知识产权等条款风险。",
        prompt: "审查这份合同，按红黄绿风险分级列出问题、条款位置、风险原因和修改建议。",
        outputs: ["风险清单", "条款位置", "修订建议"]
      },
      {
        id: "contract-drafting",
        title: "合同起草",
        description: "根据业务背景起草合同初稿、补充协议或单个条款。",
        prompt: "根据下面的业务背景起草一份合同初稿，并列出需要我补充确认的信息。",
        outputs: ["合同草稿", "待确认问题", "条款说明"]
      },
      {
        id: "regulatory-research",
        title: "法规案例检索",
        description: "围绕一个法律问题整理法规、案例、监管文件和适用性分析。",
        prompt: "围绕这个法律问题检索相关法规、案例和监管文件，按来源、结论和适用边界整理。",
        outputs: ["来源列表", "适用性分析", "引用链接"]
      },
      {
        id: "compliance-check",
        title: "合规检查",
        description: "检查隐私政策、用户协议、营销文案、开源许可证等合规风险。",
        prompt: "检查下面这段材料的合规风险，按风险等级、依据、修改建议和复核点输出。",
        outputs: ["风险等级", "替代表述", "复核清单"]
      },
      {
        id: "case-timeline",
        title: "材料整理",
        description: "把来函、合同、证据和会议记录整理成时间线或问题清单。",
        prompt: "把我上传的法律材料整理成案件时间线，标出证据来源、不确定信息和下一步要补充的材料。",
        outputs: ["时间线", "证据索引", "补充材料清单"]
      },
      {
        id: "response-draft",
        title: "函件草稿",
        description: "起草客户回复、律师复核邮件、升级审批邮件等克制文本。",
        prompt: "为下面这个事项写一封回复草稿，语气克制，保留律师复核点和待确认事实。",
        outputs: ["回复草稿", "复核点", "事实确认清单"]
      }
    ],
    advanced: ["合同条款风险抽取", "隐私与数据合规初筛", "法规案例结构化检索", "法律文档对比和摘要", "律师复核清单生成"]
  }
};

export function getScopeGuide(scope: ScopeItem | undefined): ScopeGuide | undefined {
  if (!scope) return undefined;
  return scopeGuides[scope.id];
}
