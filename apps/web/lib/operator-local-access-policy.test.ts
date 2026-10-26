import { describe, expect, test } from "vitest";
import { isLegacyLocalOperatorAccessAllowed } from "./operator-local-access-policy";

const backendEnv = {
  DATABASE_URL: "postgres://localhost/operator",
  OPERATOR_SESSION_SECRET: "operator-session-secret-with-enough-length"
};

describe("Operator legacy local access policy", () => {
  test("allows local task files when the account backend is disabled", () => {
    expect(isLegacyLocalOperatorAccessAllowed(null, {})).toBe(true);
  });

  test("blocks implicit local fallback when the account backend is enabled", () => {
    expect(isLegacyLocalOperatorAccessAllowed(null, backendEnv)).toBe(false);
    expect(isLegacyLocalOperatorAccessAllowed("browser-local", backendEnv)).toBe(false);
  });

  test("requires explicit opt-in for browser-local access with the account backend enabled", () => {
    expect(
      isLegacyLocalOperatorAccessAllowed("browser-local", {
        ...backendEnv,
        OPERATOR_ALLOW_LEGACY_LOCAL_TASK_ACCESS: "true"
      })
    ).toBe(true);
  });
});
