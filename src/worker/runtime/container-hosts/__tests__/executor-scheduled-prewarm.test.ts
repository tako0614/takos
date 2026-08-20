import { describe, expect, test } from "bun:test";
import { isTier1PrewarmEnabled } from "../executor-host.ts";

describe("executor scheduled prewarm", () => {
  test("is disabled unless the operator explicitly opts in", () => {
    expect(isTier1PrewarmEnabled({})).toBe(false);
    expect(
      isTier1PrewarmEnabled({ EXECUTOR_TIER1_PREWARM_ENABLED: "0" }),
    ).toBe(false);
    expect(
      isTier1PrewarmEnabled({ EXECUTOR_TIER1_PREWARM_ENABLED: "true" }),
    ).toBe(false);
  });

  test("accepts only the exact opt-in value", () => {
    expect(
      isTier1PrewarmEnabled({ EXECUTOR_TIER1_PREWARM_ENABLED: "1" }),
    ).toBe(true);
  });
});
