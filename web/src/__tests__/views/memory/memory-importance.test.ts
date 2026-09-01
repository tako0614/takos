import { describe, expect, test } from "bun:test";
import { getMemoryImportanceStars } from "../../../views/memory/memory-importance.ts";

describe("getMemoryImportanceStars", () => {
  test("maps the public 0..1 range to five stars", () => {
    expect(getMemoryImportanceStars(0)).toEqual({ filled: 0, empty: 5 });
    expect(getMemoryImportanceStars(0.5)).toEqual({ filled: 3, empty: 2 });
    expect(getMemoryImportanceStars(1)).toEqual({ filled: 5, empty: 0 });
  });

  test("clamps legacy or corrupt values without throwing", () => {
    expect(getMemoryImportanceStars(-10)).toEqual({ filled: 0, empty: 5 });
    expect(getMemoryImportanceStars(10)).toEqual({ filled: 5, empty: 0 });
    expect(getMemoryImportanceStars(Number.NaN)).toEqual({
      filled: 0,
      empty: 5,
    });
  });
});
