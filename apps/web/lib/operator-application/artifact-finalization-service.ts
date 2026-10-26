import type { ArtifactRecord } from "@operator/core";
import {
  registerServerRunArtifacts,
  type ServerArtifactRegistration
} from "../operator-backend/artifacts";

export type ArtifactFinalizationServiceResult = {
  registrations: ServerArtifactRegistration[];
  error?: unknown;
};

export async function finalizeServerRunArtifacts(params: {
  projectId: string;
  agentRunId: string;
  workspace: string;
  artifacts: ArtifactRecord[];
  createdBy: string;
  timeoutMs: number;
}): Promise<ArtifactFinalizationServiceResult> {
  try {
    const registrations = await withOperationTimeout(
      registerServerRunArtifacts({
        projectId: params.projectId,
        agentRunId: params.agentRunId,
        workspace: params.workspace,
        artifacts: params.artifacts,
        createdBy: params.createdBy
      }),
      params.timeoutMs,
      "Server artifact registration timed out."
    );
    return { registrations };
  } catch (error) {
    console.error("[operator] failed to register server run artifacts", error);
    return { registrations: [], error };
  }
}

export function artifactFinalizationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withOperationTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
