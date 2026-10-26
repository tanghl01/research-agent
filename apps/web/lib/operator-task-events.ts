import IORedis from "ioredis";
import type { OperatorTaskAgUiEvent } from "./operator-task-event-contract";

const TASK_EVENT_CHANNEL_PREFIX = "operator:task-ag-ui";

export {
  OPERATOR_TASK_AG_UI_SSE_EVENT,
  isTerminalOperatorTaskAgUiEvent,
  operatorTaskAgUiEventTimestamp
} from "./operator-task-event-contract";
export type { OperatorTaskAgUiEvent } from "./operator-task-event-contract";

type OperatorTaskAgUiEventListener = (event: OperatorTaskAgUiEvent) => void;

export type OperatorTaskAgUiEventScope = {
  userId?: string;
  projectId?: string;
  conversationId?: string;
  taskId: string;
};

export type OperatorTaskAgUiEventBus = {
  publish(channelId: string, event: OperatorTaskAgUiEvent): Promise<void>;
  subscribe(channelId: string, listener: OperatorTaskAgUiEventListener): () => void;
};

let sharedBus: OperatorTaskAgUiEventBus | undefined;

export async function publishOperatorTaskAgUiEvent(event: OperatorTaskAgUiEvent, options: { channelId?: string } = {}): Promise<void> {
  await operatorTaskAgUiEventBus().publish(options.channelId ?? operatorTaskAgUiEventChannel({ taskId: event.taskId }), event);
}

export function subscribeOperatorTaskAgUiEvents(
  taskId: string,
  listener: OperatorTaskAgUiEventListener,
  options: { channelId?: string } = {}
): () => void {
  return operatorTaskAgUiEventBus().subscribe(options.channelId ?? operatorTaskAgUiEventChannel({ taskId }), listener);
}

export function operatorTaskAgUiEventChannel(scope: OperatorTaskAgUiEventScope): string {
  if (scope.userId && scope.projectId && scope.conversationId) {
    return [
      "server",
      "user",
      safeChannelSegment(scope.userId),
      "project",
      safeChannelSegment(scope.projectId),
      "conversation",
      safeChannelSegment(scope.conversationId),
      "task",
      safeChannelSegment(scope.taskId)
    ].join(":");
  }
  return ["local", "task", safeChannelSegment(scope.taskId)].join(":");
}

export function operatorTaskAgUiEventBus(env: Record<string, string | undefined> = process.env): OperatorTaskAgUiEventBus {
  sharedBus ??= createOperatorTaskAgUiEventBus(env);
  return sharedBus;
}

export function setOperatorTaskAgUiEventBusForTests(bus: OperatorTaskAgUiEventBus | undefined): void {
  sharedBus = bus;
}

export function createOperatorTaskAgUiEventBus(env: Record<string, string | undefined> = process.env): OperatorTaskAgUiEventBus {
  const redisUrl = env.REDIS_URL?.trim();
  if (redisUrl) return new RedisOperatorTaskAgUiEventBus(redisUrl);
  if (env.NODE_ENV === "production" && env.OPERATOR_ALLOW_LOCAL_TASK_EVENT_BUS !== "true") {
    throw new Error("REDIS_URL is required for production Operator task AG-UI events.");
  }
  return new LocalOperatorTaskAgUiEventBus();
}

export class RedisOperatorTaskAgUiEventBus implements OperatorTaskAgUiEventBus {
  constructor(private readonly redisUrl: string) {}

  async publish(channelId: string, event: OperatorTaskAgUiEvent): Promise<void> {
    const publisher = new IORedis(this.redisUrl, { maxRetriesPerRequest: 1 });
    try {
      await publisher.publish(taskEventChannel(channelId), JSON.stringify(event));
    } finally {
      publisher.disconnect();
    }
  }

  subscribe(channelId: string, listener: OperatorTaskAgUiEventListener): () => void {
    const subscriber = new IORedis(this.redisUrl, { maxRetriesPerRequest: 1 });
    const channel = taskEventChannel(channelId);
    let closed = false;

    subscriber.on("message", (receivedChannel, message) => {
      if (closed || receivedChannel !== channel) return;
      const event = parseTaskAgUiEvent(message);
      if (event) listener(event);
    });
    void subscriber.subscribe(channel).catch(() => {
      if (!closed) subscriber.disconnect();
    });

    return () => {
      closed = true;
      void subscriber.unsubscribe(channel).finally(() => subscriber.disconnect());
    };
  }
}

export class LocalOperatorTaskAgUiEventBus implements OperatorTaskAgUiEventBus {
  private readonly subscribersByChannelId = new Map<string, Set<OperatorTaskAgUiEventListener>>();

  async publish(channelId: string, event: OperatorTaskAgUiEvent): Promise<void> {
    const subscribers = this.subscribersByChannelId.get(channelId);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber(event);
  }

  subscribe(channelId: string, listener: OperatorTaskAgUiEventListener): () => void {
    const subscribers = this.subscribersByChannelId.get(channelId) ?? new Set<OperatorTaskAgUiEventListener>();
    subscribers.add(listener);
    this.subscribersByChannelId.set(channelId, subscribers);
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) this.subscribersByChannelId.delete(channelId);
    };
  }
}

function taskEventChannel(channelId: string): string {
  return `${TASK_EVENT_CHANNEL_PREFIX}:${safeChannelSegment(channelId)}`;
}

function safeChannelSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.:-]/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || "unknown";
}

function parseTaskAgUiEvent(message: string): OperatorTaskAgUiEvent | undefined {
  try {
    const parsed = JSON.parse(message) as unknown;
    if (!isRecord(parsed) || typeof parsed.taskId !== "string" || !isRecord(parsed.event)) return undefined;
    return {
      taskId: parsed.taskId,
      event: parsed.event as OperatorTaskAgUiEvent["event"],
      source: parsed.source === "persisted" ? "persisted" : "live"
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
