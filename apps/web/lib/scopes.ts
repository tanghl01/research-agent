import type { OperatorUserScopeItem, OperatorUserScopeSelectionCatalog } from "@operator/contracts";

export type ScopeKind = OperatorUserScopeItem["kind"];
export type ScopeItem = OperatorUserScopeItem;
export type ScopeCatalog = OperatorUserScopeSelectionCatalog;

export type ScopeGroup = {
  id: string;
  label: string;
  description: string;
  items: ScopeItem[];
};

const hiddenHomeScopeIds = new Set(["gorden-ppt-skill"]);
const visibleWorkflowIds = new Set(["industrial.daily-monitoring-report", "research.paper-from-results"]);
const groupItemOrder: Record<string, string[]> = {
  office: ["ppt-master", "guizang-ppt-skill"],
  education: ["dianji-assistant"],
  research: ["scientific-agent-skills", "qinyan-academic-skills", "research.paper-from-results"]
};

const groupRules: Array<{
  id: string;
  label: string;
  description: string;
  match: (item: ScopeItem) => boolean;
}> = [
  {
    id: "office",
    label: "办公",
    description: "PPTX、HTML slides、汇报和结构化办公材料",
    match: (item) => ["pptx", "html"].includes(item.outputFormat ?? "") || hasAnyKeyword(item, ["ppt", "slides", "课件"])
  },
  {
    id: "education",
    label: "教育",
    description: "教学、课程和学习场景能力",
    match: (item) => hasAnyKeyword(item, ["education", "sdju", "上海电机学院", "电机", "高校", "教学"])
  },
  {
    id: "research",
    label: "科研",
    description: "科研 skill、文献综述、数据分析和报告",
    match: (item) =>
      item.outputFormat === "research" ||
      item.id.startsWith("research.") ||
      (hasAnyKeyword(item, ["scientific", "科研", "literature"]) && item.outputFormat !== "cad")
  },
  {
    id: "design",
    label: "设计",
    description: "文本转 CAD、工程建模和制造交付",
    match: (item) => item.outputFormat === "cad" || hasAnyKeyword(item, ["cad", "hardware", "engineering", "制造"])
  },
  {
    id: "industrial",
    label: "工业",
    description: "工业视觉巡检、仪表读数和监测报告",
    match: (item) =>
      item.outputFormat === "industrial_analysis" ||
      item.id.startsWith("industrial.") ||
      hasAnyKeyword(item, [
        "industrial",
        "inspection",
        "leak",
        "meter",
        "monitoring",
        "工业",
        "巡检",
        "漏水",
        "漏油",
        "水渍",
        "漏气",
        "仪表",
        "监测报告"
      ])
  }
];

export function flattenScopeCatalog(catalog: ScopeCatalog): ScopeItem[] {
  return [...catalog.skills, ...catalog.workflows.filter(isUserFacingWorkflow), ...catalog.tools];
}

export function groupScopes(catalog: ScopeCatalog): ScopeGroup[] {
  const items = flattenScopeCatalog(catalog).filter((item) => !hiddenHomeScopeIds.has(item.id));
  return groupRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    description: rule.description,
    items: sortGroupItems(rule.id, items.filter(rule.match))
  }));
}

function hasAnyKeyword(item: ScopeItem, needles: string[]): boolean {
  const haystack = [item.id, item.displayName, item.description, ...item.keywords].join(" ").toLowerCase();
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase();
    if (!/^[a-z0-9][a-z0-9\s_.-]*$/i.test(normalizedNeedle)) {
      return haystack.includes(normalizedNeedle);
    }
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedNeedle)}([^a-z0-9]|$)`).test(haystack);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sortGroupItems(groupId: string, items: ScopeItem[]): ScopeItem[] {
  const orderedIds = groupItemOrder[groupId];
  if (!orderedIds) return items;
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

function isUserFacingWorkflow(item: ScopeItem): boolean {
  return visibleWorkflowIds.has(item.id);
}
