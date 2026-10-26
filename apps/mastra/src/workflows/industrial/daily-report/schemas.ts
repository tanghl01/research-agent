import { z } from "zod/v4";
import { normalizedBriefSchema, renderedDeckSchema } from "../../../schemas.js";

export const industrialFindingSchema = z.object({
  source: z.string(),
  type: z.string(),
  severity: z.string(),
  confidence: z.number(),
  evidence: z.string(),
  recommended_action: z.string().optional(),
  image_path: z.string().optional()
});

export const industrialReadingSchema = z.object({
  source: z.string(),
  meter_type: z.string(),
  value: z.union([z.number(), z.string()]).optional(),
  unit: z.string().optional(),
  display_text: z.string().optional(),
  confidence: z.number(),
  status: z.string(),
  evidence: z.string(),
  image_path: z.string().optional()
});

export const industrialReportDataSchema = normalizedBriefSchema.extend({
  workflowId: z.literal("industrial.daily-monitoring-report"),
  outputFormat: z.literal("pdf"),
  industrial: z.object({
    site: z.string(),
    reportDate: z.string(),
    riskLevel: z.string(),
    summary: z.string(),
    dataQuality: z.string(),
    imageCount: z.number(),
    findingCount: z.number(),
    readingCount: z.number()
  }),
  industrialInputs: z.object({
    imagePaths: z.array(z.string()),
    dataPaths: z.array(z.string())
  }),
  findings: z.array(industrialFindingSchema),
  readings: z.array(industrialReadingSchema)
});

export const industrialReportRenderedSchema = renderedDeckSchema.extend({
  workflowId: z.literal("industrial.daily-monitoring-report"),
  outputFormat: z.literal("pdf"),
  industrial: industrialReportDataSchema.shape.industrial,
  industrialInputs: industrialReportDataSchema.shape.industrialInputs,
  findings: z.array(industrialFindingSchema),
  readings: z.array(industrialReadingSchema)
});

export type IndustrialReportData = z.infer<typeof industrialReportDataSchema>;
export type IndustrialReportRenderedData = z.infer<typeof industrialReportRenderedSchema>;
