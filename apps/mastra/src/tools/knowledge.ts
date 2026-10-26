import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

const searchOutputSchema = z.object({
  results: z.array(
    z.object({
      itemId: z.string(),
      versionId: z.string().nullable(),
      title: z.string(),
      resourceKind: z.string(),
      url: z.string(),
      sourceUrl: z.string(),
      summary: z.string(),
      fetchedAt: z.string().nullable(),
      score: z.number()
    })
  )
});

const itemOutputSchema = z.object({
  item: z.unknown(),
  version: z.unknown().nullable(),
  file: z.unknown().nullable()
});

const templatesOutputSchema = z.object({
  templates: z.array(z.unknown())
});

const fillTemplateOutputSchema = z.object({
  artifact: z.object({
    artifactId: z.string(),
    href: z.string(),
    downloadHref: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
    metadata: z.unknown()
  }),
  template: z.object({
    id: z.string(),
    itemId: z.string(),
    versionId: z.string().nullable(),
    title: z.string(),
    sourceUrl: z.string(),
    fieldsSchema: z.unknown()
  })
});

export const knowledgeSearchTool = createTool({
  id: "operator.knowledge.search",
  description: "Search the Operator Knowledge Base. Use for 电机百事通 questions about SDJU public notices, documents, templates, forms, and downloadable files.",
  inputSchema: z.object({
    query: z.string().min(1),
    space: z.string().optional(),
    kind: z.string().optional(),
    limit: z.number().int().positive().max(20).optional()
  }),
  outputSchema: searchOutputSchema,
  execute: async ({ query, space = "dianji", kind, limit = 8 }) => {
    const url = apiUrl("/api/operator/knowledge/search");
    url.searchParams.set("q", query);
    url.searchParams.set("space", space);
    if (kind) url.searchParams.set("kind", kind);
    url.searchParams.set("limit", String(limit));
    return fetchJson(url, searchOutputSchema);
  }
});

export const knowledgeFetchTool = createTool({
  id: "operator.knowledge.fetch",
  description: "Fetch a specific Operator Knowledge Base item by id, including latest version and source file metadata.",
  inputSchema: z.object({
    itemId: z.string().uuid()
  }),
  outputSchema: itemOutputSchema,
  execute: async ({ itemId }) => fetchJson(apiUrl(`/api/operator/knowledge/items/${itemId}`), itemOutputSchema)
});

export const knowledgeFindTemplateTool = createTool({
  id: "operator.knowledge.find_template",
  description: "Find fillable public templates in the Operator Knowledge Base.",
  inputSchema: z.object({
    query: z.string().optional(),
    space: z.string().optional(),
    outputFormat: z.string().optional(),
    limit: z.number().int().positive().max(50).optional()
  }),
  outputSchema: templatesOutputSchema,
  execute: async ({ query, space = "dianji", outputFormat, limit = 20 }) => {
    const url = apiUrl("/api/operator/knowledge/templates");
    url.searchParams.set("space", space);
    if (query) url.searchParams.set("q", query);
    if (outputFormat) url.searchParams.set("format", outputFormat);
    url.searchParams.set("limit", String(limit));
    return fetchJson(url, templatesOutputSchema);
  }
});

export const knowledgeFillTemplateTool = createTool({
  id: "operator.knowledge.fill_template",
  description: "Generate a DOCX/XLSX draft artifact from an Operator Knowledge Base template candidate and user fields.",
  inputSchema: z.object({
    templateId: z.string().uuid(),
    fields: z.record(z.string(), z.unknown()).default({}),
    outputFormat: z.enum(["docx", "xlsx"]).optional()
  }),
  outputSchema: fillTemplateOutputSchema,
  execute: async ({ templateId, fields, outputFormat }) =>
    postJson(apiUrl(`/api/operator/knowledge/templates/${templateId}/fill`), { fields, outputFormat }, fillTemplateOutputSchema)
});

export const operatorKnowledgeTools = {
  knowledgeSearchTool,
  knowledgeFetchTool,
  knowledgeFindTemplateTool,
  knowledgeFillTemplateTool
} as const;

function apiUrl(path: string): URL {
  const base = process.env.OPERATOR_KNOWLEDGE_API_BASE_URL || process.env.OPERATOR_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_OPERATOR_BASE_URL;
  if (!base) {
    throw new Error("OPERATOR_KNOWLEDGE_API_BASE_URL or OPERATOR_PUBLIC_BASE_URL is required for operator.knowledge tools.");
  }
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
}

async function fetchJson<T>(url: URL, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Knowledge API returned HTTP ${response.status}: ${await response.text()}`);
  }
  return schema.parse(await response.json());
}

async function postJson<T>(url: URL, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Knowledge API returned HTTP ${response.status}: ${await response.text()}`);
  }
  return schema.parse(await response.json());
}
