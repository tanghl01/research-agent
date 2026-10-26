import { z } from "zod";
import { apiSecurityErrorResponse, assertSameOrigin, consumeRateLimit } from "@/lib/api/security";
import { parseJsonBody, validationErrorResponse } from "@/lib/api/schema";
import { createServerChatPersistence } from "@/lib/operator-backend/conversations";
import { getOperatorBackendRuntimeStatus } from "@/lib/operator-backend/config";
import { getOrCreateOperatorSessionUser } from "@/lib/operator-backend/session";
import { loadBrowserLocalOperatorTaskMessages } from "@/lib/operator-server-data";

export const runtime = "nodejs";

const migrateLocalSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().optional()
      })
    )
    .max(50)
    .optional()
    .default([])
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(req, { namespace: "operator-session-migrate-local", points: 10, durationSeconds: 60 });

    const backend = getOperatorBackendRuntimeStatus();
    if (!backend.enabled || !backend.serviceConfigured) {
      return Response.json({ error: "Operator backend is not available.", backend }, { status: 503 });
    }

    const session = await getOrCreateOperatorSessionUser(req);
    if (!session.authenticated) {
      return Response.json({ error: "Authentication is required.", backend }, { status: 401 });
    }

    const body = await parseJsonBody(req, migrateLocalSchema);
    let migrated = 0;

    for (const task of body.tasks) {
      const taskId = task.id;
      if (!isSafeTaskId(taskId)) continue;
      const title = task.title?.trim() || "新任务";
      const messages = loadBrowserLocalOperatorTaskMessages(taskId);
      await createServerChatPersistence({
        session: {
          user: session.user,
          setCookie: session.setCookie
        },
        taskId,
        title,
        currentMessages: messages,
        metadata: {
          migratedFrom: "browser-local"
        }
      });
      migrated += 1;
    }

    const response = Response.json({ ok: true, migrated });
    if (session.setCookie) response.headers.append("set-cookie", session.setCookie);
    return response;
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    const security = apiSecurityErrorResponse(error);
    if (security) return security;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function isSafeTaskId(value: string): boolean {
  return Boolean(value && !value.includes("/") && !value.includes("\\"));
}
