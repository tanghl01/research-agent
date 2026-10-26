import { z } from "zod";
import { OperatorConversationMessageSchema } from "./messages.js";
import { TaskSnapshotSchema } from "./task-snapshot.js";

export const TaskDetailQuerySchema = z.object({
  taskId: z.string().min(1),
  source: z.string().min(1).optional()
});

export type TaskDetailQuery = z.infer<typeof TaskDetailQuerySchema>;

export const TaskMessagesResponseSchema = z.object({
  source: z.enum(["server", "local"]),
  messages: z.array(OperatorConversationMessageSchema)
});

export type TaskMessagesResponse = z.infer<typeof TaskMessagesResponseSchema>;

export const OperatorChatRequestSchema = z.object({
  messages: z.array(z.unknown()).default([])
});

export type OperatorChatRequest = z.infer<typeof OperatorChatRequestSchema>;

export const OperatorApiErrorSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1).optional()
});

export type OperatorApiError = z.infer<typeof OperatorApiErrorSchema>;

export const TaskDetailResponseSchema = TaskSnapshotSchema;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
