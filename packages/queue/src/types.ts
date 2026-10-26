export type QueueName = "agent-run" | "artifact-index" | "drive-maintenance" | "knowledge-ingestion" | "scope-sync" | "workflow-run";

export type QueueJob<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  queue: QueueName;
  name: string;
  payload: TPayload;
  createdAt: string;
};

export type QueueJobResult<TPayload extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> = {
  job: QueueJob<TPayload>;
  result: TResult;
};

export type JobQueue = {
  enqueue<TPayload extends Record<string, unknown>>(queue: QueueName, name: string, payload: TPayload): Promise<QueueJob<TPayload>>;
  upsertSchedule?<TPayload extends Record<string, unknown>>(
    queue: QueueName,
    scheduleId: string,
    pattern: string,
    name: string,
    payload: TPayload
  ): Promise<QueueJob<TPayload>>;
  enqueueAndWait?<TPayload extends Record<string, unknown>, TResult = unknown>(
    queue: QueueName,
    name: string,
    payload: TPayload,
    options?: { timeoutMs?: number }
  ): Promise<QueueJobResult<TPayload, TResult>>;
};

export type QueueJobHandler<TPayload extends Record<string, unknown> = Record<string, unknown>> = (
  job: QueueJob<TPayload>
) => Promise<unknown>;

export type JobWorker = {
  close(): Promise<void>;
};

export class DisabledJobQueue implements JobQueue {
  async enqueue<TPayload extends Record<string, unknown>>(queue: QueueName, name: string, payload: TPayload): Promise<QueueJob<TPayload>> {
    return {
      id: `disabled-${Date.now()}`,
      queue,
      name,
      payload,
      createdAt: new Date().toISOString()
    };
  }

  async enqueueAndWait<TPayload extends Record<string, unknown>, TResult = unknown>(
    queue: QueueName,
    name: string,
    payload: TPayload
  ): Promise<QueueJobResult<TPayload, TResult>> {
    const job = await this.enqueue(queue, name, payload);
    throw new Error(`Queue ${queue}:${name} is disabled and cannot wait for a worker result for job ${job.id}.`);
  }

  async upsertSchedule<TPayload extends Record<string, unknown>>(
    queue: QueueName,
    scheduleId: string,
    _pattern: string,
    name: string,
    payload: TPayload
  ): Promise<QueueJob<TPayload>> {
    return {
      id: `disabled-schedule-${scheduleId}`,
      queue,
      name,
      payload,
      createdAt: new Date().toISOString()
    };
  }
}

export class DisabledJobWorker implements JobWorker {
  async close(): Promise<void> {}
}
