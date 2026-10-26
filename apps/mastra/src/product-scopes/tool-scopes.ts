import type { OperatorToolScope } from "./types.js";

export const toolScopes: OperatorToolScope[] = [
  {
    id: "operator.web.search",
    kind: "tool",
    displayName: "Web Search",
    description: "Search the public web for current information and source discovery.",
    keywords: ["web", "search", "current", "latest", "download", "internet", "网页", "搜索"],
    runtime: "mastra-tool"
  },
  {
    id: "operator.web.fetch_url",
    kind: "tool",
    displayName: "Fetch URL",
    description: "Fetch a URL and return readable text for source verification.",
    keywords: ["web", "fetch", "url", "html", "source", "网页", "抓取"],
    runtime: "mastra-tool"
  },
  {
    id: "operator.web.download_file",
    kind: "tool",
    displayName: "Download File",
    description: "Download a URL into the task workspace and return path, size, MIME type, and sha256.",
    keywords: ["web", "download", "file", "pdf", "artifact", "下载", "文件"],
    runtime: "mastra-tool"
  },
  {
    id: "operator.knowledge.search",
    kind: "tool",
    displayName: "电机百事通",
    description: "Search the Operator Knowledge Base for SDJU public notices, news, documents, templates, forms, and downloadable files.",
    keywords: ["knowledge", "education", "sdju", "电机", "上海电机学院", "通知", "表格", "模板"],
    runtime: "mastra-tool"
  },
  {
    id: "operator.knowledge.fetch",
    kind: "tool",
    displayName: "电机知识条目读取",
    description: "Fetch a specific Operator Knowledge Base item by id, including latest version and source file metadata.",
    keywords: ["knowledge", "fetch", "item", "sdju", "电机", "上海电机学院", "来源", "附件", "下载"],
    runtime: "mastra-tool"
  },
  {
    id: "operator.knowledge.find_template",
    kind: "tool",
    displayName: "电机模板检索",
    description: "Find public SDJU templates and forms in the Operator Knowledge Base.",
    keywords: ["knowledge", "template", "form", "docx", "xlsx", "电机", "模板", "表格"],
    runtime: "mastra-tool"
  },
  {
    id: "operator.knowledge.fill_template",
    kind: "tool",
    displayName: "电机模板填充",
    description: "Generate a DOCX/XLSX draft artifact from a public SDJU template candidate and user-provided fields.",
    keywords: ["knowledge", "template", "form", "docx", "xlsx", "artifact", "电机", "模板", "表格", "填表"],
    runtime: "mastra-tool"
  }
];
