import { describe, expect, it } from "bun:test";
import { maskEnvVars } from "../crypto.ts";

describe("maskEnvVars", () => {
  it("never reveals any plaintext of a value (no prefix/suffix leak)", () => {
    const masked = maskEnvVars({
      API_KEY: "sk-live-1234567890abcdef",
      SHORT: "abc",
    });
    // Must not contain any source characters — the old mask leaked the first
    // and last two chars (e.g. "sk****ef"), exposing most of a short secret.
    expect(masked.API_KEY).toBe("********");
    expect(masked.SHORT).toBe("********");
    expect(masked.API_KEY).not.toContain("sk");
    expect(masked.API_KEY).not.toContain("ef");
  });

  it("does not encode the value length into the mask", () => {
    const masked = maskEnvVars({ A: "x", B: "x".repeat(200) });
    expect(masked.A).toBe(masked.B);
  });

  it("renders an empty value as empty (set vs unset stays truthful)", () => {
    expect(maskEnvVars({ EMPTY: "" }).EMPTY).toBe("");
  });
});
