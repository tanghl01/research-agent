import {
  ensureOperatorMessageIds,
  type OperatorConversationMessage as OperatorChatMessage,
  type OperatorConversationMessageInput as OperatorChatMessageInput
} from "@operator/contracts";

export function compactOperatorMessages(messages: readonly OperatorChatMessageInput[], scope = "compact"): OperatorChatMessage[] {
  const compacted: OperatorChatMessage[] = [];
  const seenIds = new Set<string>();

  for (const message of ensureOperatorMessageIds(messages, scope)) {
    if (seenIds.has(message.id)) continue;
    const previous = compacted.at(-1);
    if (previous && sameMessageText(previous, message)) {
      seenIds.add(message.id);
      continue;
    }
    compacted.push(message);
    seenIds.add(message.id);
  }

  return compacted.slice(-12);
}

export function mergeOperatorHistoricalMessages(
  historicalMessages: readonly OperatorChatMessageInput[],
  currentMessages: readonly OperatorChatMessageInput[]
): OperatorChatMessage[] {
  const history = compactOperatorMessages(historicalMessages, "history");
  const current = compactOperatorMessages(currentMessages, "current");
  if (!history.length) return current;
  if (startsWithMessages(current, history)) return current;

  const merged = [...history];
  const seenIds = new Set(merged.map((message) => message.id));
  for (const message of current) {
    if (seenIds.has(message.id)) continue;
    const previous = merged.at(-1);
    if (previous && sameMessageText(previous, message)) continue;
    merged.push(message);
    seenIds.add(message.id);
  }
  return compactOperatorMessages(merged, "merged");
}

function startsWithMessages(messages: OperatorChatMessage[], prefix: OperatorChatMessage[]): boolean {
  if (messages.length < prefix.length) return false;
  return prefix.every((message, index) => sameMessageText(message, messages[index]));
}

function sameMessageText(left: OperatorChatMessage, right: OperatorChatMessage): boolean {
  return left.role === right.role && normalizeMessageContent(left.content) === normalizeMessageContent(right.content);
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\s+/gu, " ").trim();
}
