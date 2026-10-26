import {
  type Job as BullJob,
  Queue as BullQueue,
  QueueEvents as BullQueueEvents,
  Worker as BullWorker,
  type JobsOptions,
  type QueueOptions,
  type WorkerOptions
} from "bullmq";
import {
  DisabledJobQueue,
  DisabledJobWorker,
  type JobQueue,
  type JobWorker,
  type QueueJob,
  type QueueJobHandler,
  type QueueJobResult,
  type QueueName
} from "./types.js";

type Env = Record<string, string | undefined>;

type QueueLike = {
  add<TPayload extends Record<string, unknown>>(
    name: string,
    payload: TPayload,
    options?: JobsOptions
  ): Promise<{
    id?: string | number;
    timestamp?: number;
    waitUntilFinished?(queueEvents: BullQueueEvents, ttl?: number): Promise<unknown>;
  }>;
  close(): Promise<void>;
  upsertJobScheduler?<TPayload extends Record<string, unknown>>(
    schedulerId: string,
    repeatOptions: { pattern: string },
    jobTemplate: { name: string; data: TPayload; opts?: JobsOptions }
  ): Promise<{ id?: string | number; timestamp?: number }>;
};

type QueueFactory = (name: QueueName) => QueueLike;

export type RedisJobQueueOptions = {
  redisUrl?: string;
  connection?: QueueOptions["connection"];
  prefix?: string;
  defaultJobOptions?: JobsOptions;
  queueFactory?: QueueFactory;
};

export type RedisJobWorkerOptions<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  queue: QueueName;
  redisUrl?: string;
  connection?: WorkerOptions["connection"];
  prefix?: string;
  handler: QueueJobHandler<TPayload>;
};

export class RedisJobQueue implements JobQueue {
  private readonly queues = new Map<QueueName, QueueLike>();
  private readonly queueEvents = new Map<QueueName, BullQueueEvents>();
  private readonly connection?: QueueOptions["connection"];
  private readonly redisUrl?: string;
  private readonly prefix: string;
  private readonly defaultJobOptions: JobsOptions;
  private readonly queueFactory?: QueueFactory;

  constructor(options: RedisJobQueueOptions = {}) {
    this.prefix = options.prefix ?? "operator";
    this.defaultJobOptions = options.defaultJobOptions ?? {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    };
    this.queueFactory = options.queueFactory;
    if (options.connection) {
      this.connection = options.connection;
    } else if (options.redisUrl) {
      this.redisUrl = options.redisUrl;
    }
  }

  async enqueue<TPayload extends Record<string, unknown>>(queue: QueueName, name: string, payload: TPayload): Promise<QueueJob<TPayload>> {
    const bullQueue = this.queue(queue);
    const job = await bullQueue.add(name, payload, this.defaultJobOptions);
    return queueJobFromBullJob(queue, name, payload, job);
  }

  async enqueueAndWait<TPayload extends Record<string, unknown>, TResult = unknown>(
    queue: QueueName,
    name: string,
    payload: TPayload,
    options: { timeoutMs?: number } = {}
  ): Promise<QueueJobResult<TPayload, TResult>> {
    const bullQueue = this.queue(queue);
    const job = await bullQueue.add(name, payload, this.defaultJobOptions);
    const queuedJob = queueJobFromBullJob(queue, name, payload, job);
    if (!job.waitUntilFinished) {
      throw new Error("BullMQ job waitUntilFinished is unavailable for this queue implementation.");
    }
    const result = (await job.waitUntilFinished(this.queueEvent(queue), options.timeoutMs)) as TResult;
    return { job: queuedJob, result };
  }

  async upsertSchedule<TPayload extends Record<string, unknown>>(
    queue: QueueName,
    scheduleId: string,
    pattern: string,
    name: string,
    payload: TPayload
  ): Promise<QueueJob<TPayload>> {
    const bullQueue = this.queue(queue);
    if (!bullQueue.upsertJobScheduler) {
      throw new Error("BullMQ upsertJobScheduler is unavailable for this queue implementation.");
    }
    const job = await bullQueue.upsertJobScheduler(scheduleId, { pattern }, { name, data: payload, opts: this.defaultJobOptions });
    return queueJobFromBullJob(queue, name, payload, job);
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await Promise.all([...this.queueEvents.values()].map((events) => events.close()));
    this.queues.clear();
    this.queueEvents.clear();
  }

  private queue(name: QueueName): QueueLike {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const created =
      this.queueFactory?.(name) ??
      new BullQueue(name, {
        connection: this.connection ?? this.redisConnection(),
        prefix: this.prefix
      });
    this.queues.set(name, created);
    return created;
  }

  private redisConnection(): QueueOptions["connection"] {
    return redisConnectionOptions(this.redisUrl ?? "redis://127.0.0.1:6379");
  }

  private queueEvent(name: QueueName): BullQueueEvents {
    const existing = this.queueEvents.get(name);
    if (existing) return existing;
    const created = new BullQueueEvents(name, {
      connection: this.connection ?? this.redisConnection(),
      prefix: this.prefix
    });
    this.queueEvents.set(name, created);
    return created;
  }
}

export class RedisJobWorker<TPayload extends Record<string, unknown> = Record<string, unknown>> implements JobWorker {
  private readonly worker: BullWorker<TPayload>;

  constructor(options: RedisJobWorkerOptions<TPayload>) {
    this.worker = new BullWorker<TPayload>(
      options.queue,
      async (job: BullJob<TPayload>) =>
        await options.handler({
          id: String(job.id ?? ""),
          queue: options.queue,
          name: job.name,
          payload: job.data,
          createdAt: new Date(job.timestamp ?? Date.now()).toISOString()
        }),
      {
        connection: options.connection ?? redisConnectionOptions(options.redisUrl ?? "redis://127.0.0.1:6379"),
        prefix: options.prefix ?? "operator"
      }
    );
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

export function createJobQueueFromEnv(env: Env = process.env): JobQueue {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl && isProductionEnv(env) && env.OPERATOR_ALLOW_DISABLED_QUEUE !== "true") {
    throw new Error("REDIS_URL is required for production Operator job queues.");
  }
  return redisUrl ? new RedisJobQueue({ redisUrl }) : new DisabledJobQueue();
}

export function createJobWorkerFromEnv<TPayload extends Record<string, unknown>>(
  queue: QueueName,
  handler: QueueJobHandler<TPayload>,
  env: Env = process.env
): JobWorker {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl && isProductionEnv(env) && env.OPERATOR_ALLOW_DISABLED_QUEUE !== "true") {
    throw new Error("REDIS_URL is required for production Operator job workers.");
  }
  return redisUrl ? new RedisJobWorker({ queue, redisUrl, handler }) : new DisabledJobWorker();
}

function redisConnectionOptions(redisUrl: string): QueueOptions["connection"] {
  const parsed = new URL(redisUrl);
  const db = parsed.pathname && parsed.pathname !== "/" ? Number(parsed.pathname.slice(1)) : undefined;
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 6379,
    username: decodeURIComponent(parsed.username || "") || undefined,
    password: decodeURIComponent(parsed.password || "") || undefined,
    db: Number.isFinite(db) ? db : undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null
  };
}

function queueJobFromBullJob<TPayload extends Record<string, unknown>>(
  queue: QueueName,
  name: string,
  payload: TPayload,
  job: { id?: string | number; timestamp?: number }
): QueueJob<TPayload> {
  return {
    id: String(job.id ?? ""),
    queue,
    name,
    payload,
    createdAt: new Date(job.timestamp ?? Date.now()).toISOString()
  };
}

function isProductionEnv(env: Env): boolean {
  return env.NODE_ENV === "production";
}
