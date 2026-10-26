import { getOperatorBackendRuntimeStatus } from "./operator-backend/config";

type Env = Record<string, string | undefined>;

export const LEGACY_LOCAL_ACCESS_DISABLED_CODE = "LEGACY_LOCAL_ACCESS_DISABLED";

export function isLegacyLocalOperatorAccessAllowed(source: string | null | undefined, env: Env = process.env): boolean {
  if (!getOperatorBackendRuntimeStatus(env).enabled) return true;
  return source === "browser-local" && booleanEnv(env.OPERATOR_ALLOW_LEGACY_LOCAL_TASK_ACCESS) === true;
}

export function legacyLocalAccessDisabledResponse() {
  return Response.json(
    {
      error: "Legacy local Operator task access is disabled while the account backend is enabled.",
      code: LEGACY_LOCAL_ACCESS_DISABLED_CODE
    },
    { status: 403 }
  );
}

function booleanEnv(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}
