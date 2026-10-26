import { describe, expect, test } from "vitest";
import { formatAccountName, formatAccountPhone } from "./account-display";

describe("account display helpers", () => {
  test("hides the default mainland China country code", () => {
    expect(formatAccountPhone("+8613800138000")).toBe("13800138000");
    expect(formatAccountPhone("+14155552671")).toBe("+14155552671");
  });

  test("uses formatted phone when display name is the stored phone identity", () => {
    expect(
      formatAccountName({
        displayName: "+8613800138000",
        phone: "+8613800138000",
        email: null
      })
    ).toBe("13800138000");
  });
});
