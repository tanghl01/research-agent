import { z } from "zod";

export const RunIdentitySchema = z.object({
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  runId: z.string().min(1),
  turnId: z.string().min(1),
  userMessageId: z.string().min(1),
  scopeId: z.string().min(1).optional()
});

export type RunIdentity = z.infer<typeof RunIdentitySchema>;
