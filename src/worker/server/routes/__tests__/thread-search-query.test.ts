import { describe, expect, test } from "bun:test";
import {
  THREAD_SEARCH_QUERY_MAX_LENGTH,
  threadSearchQuerySchema,
} from "../threads/search-query.ts";

describe("thread search query boundary", () => {
  test("trims a bounded query and defaults to the combined search", () => {
    expect(threadSearchQuerySchema.parse({ q: "  hello  " })).toEqual({
      q: "hello",
      type: "all",
    });
  });

  test("accepts only current search modes", () => {
    expect(
      threadSearchQuerySchema.parse({ q: "hello", type: "semantic" }).type,
    ).toBe("semantic");
    expect(
      threadSearchQuerySchema.safeParse({ q: "hello", type: "filename" })
        .success,
    ).toBeFalse();
  });

  test("rejects missing, blank, and oversized work before AI or D1", () => {
    expect(threadSearchQuerySchema.safeParse({}).success).toBeFalse();
    expect(threadSearchQuerySchema.safeParse({ q: "   " }).success).toBeFalse();
    expect(
      threadSearchQuerySchema.safeParse({
        q: "x".repeat(THREAD_SEARCH_QUERY_MAX_LENGTH + 1),
      }).success,
    ).toBeFalse();
  });
});
