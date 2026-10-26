import { z } from "zod";

export const OPERATOR_MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export const OPERATOR_CONVERSATION_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type OperatorMessageRole = (typeof OPERATOR_MESSAGE_ROLES)[number];
export type OperatorConversationMessageRole = (typeof OPERATOR_CONVERSATION_MESSAGE_ROLES)[number];

export const OperatorMessageRoleSchema = z.enum(OPERATOR_MESSAGE_ROLES);
export const OperatorConversationMessageRoleSchema = z.enum(OPERATOR_CONVERSATION_MESSAGE_ROLES);

export const OperatorConversationMessageSchema = z.object({
  id: z.string().min(1),
  role: OperatorConversationMessageRoleSchema,
  content: z.string()
});

export type OperatorConversationMessage = z.infer<typeof OperatorConversationMessageSchema>;
export type OperatorConversationMessageInput = Omit<OperatorConversationMessage, "id"> & { id?: string };

export const MessageContractSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  role: OperatorMessageRoleSchema,
  content: z.string(),
  createdAt: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});

export type MessageContract = z.infer<typeof MessageContractSchema>;

export function hasAssistantFinalMessage(messages: Array<Pick<MessageContract, "role" | "content">>): boolean {
  return messages.some((message) => message.role === "assistant" && message.content.trim().length > 0);
}

export function hasAssistantFinalMessageAfterLatestUser(messages: Array<Pick<MessageContract, "role" | "content">>): boolean {
  const latestUserIndex = findLatestUserMessageIndex(messages);
  if (latestUserIndex === -1) return hasAssistantFinalMessage(messages);
  return messages
    .slice(latestUserIndex + 1)
    .some((message) => message.role === "assistant" && message.content.trim().length > 0);
}

export function findLatestUserMessageIndex(messages: Array<Pick<MessageContract, "role">>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

export function createOperatorMessageId(prefix = "msg"): string {
  return `${prefix}_${randomIdSegment()}`;
}

export function ensureOperatorMessageIds(
  messages: readonly OperatorConversationMessageInput[],
  scope = "message"
): OperatorConversationMessage[] {
  return messages.map((message, index) => ({
    id: message.id?.trim() || stableOperatorMessageId(scope, message, index),
    role: message.role,
    content: message.content
  }));
}

export function stableOperatorMessageId(
  scope: string,
  message: Pick<OperatorConversationMessage, "role" | "content">,
  index: number
): string {
  return `legacy_${safeMessageIdSegment(scope)}_${index}_${message.role}_${stableTextKey(message.content)}`;
}

function randomIdSegment(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.replaceAll("-", "").slice(0, 16);
  return Math.random().toString(36).slice(2, 18).padEnd(16, "0");
}

function stableTextKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function safeMessageIdSegment(value: string): string {
  const normalized = value.replace(/[^a-z0-9_-]+/giu, "_").replace(/^_+|_+$/gu, "");
  return (normalized || "message").slice(0, 48);
}
