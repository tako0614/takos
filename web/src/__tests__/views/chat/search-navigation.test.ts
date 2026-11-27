import { strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import {
  isSearchListboxVisible,
  nextSearchResultIndex,
} from "../../../views/chat/search-navigation.ts";

test("isSearchListboxVisible - gates visibility on loading, error, non-empty query, and non-empty results", () => {
  strictEqual(
    isSearchListboxVisible({
      loading: false,
      error: null,
      query: "hello",
      resultCount: 2,
    }),
    true,
  );
  strictEqual(
    isSearchListboxVisible({
      loading: true,
      error: null,
      query: "hello",
      resultCount: 2,
    }),
    false,
  );
  strictEqual(
    isSearchListboxVisible({
      loading: false,
      error: "network error",
      query: "hello",
      resultCount: 2,
    }),
    false,
  );
  strictEqual(
    isSearchListboxVisible({
      loading: false,
      error: null,
      query: "   ",
      resultCount: 2,
    }),
    false,
  );
  strictEqual(
    isSearchListboxVisible({
      loading: false,
      error: null,
      query: "hello",
      resultCount: 0,
    }),
    false,
  );
});

test("nextSearchResultIndex - returns -1 for empty result sets", () => {
  strictEqual(nextSearchResultIndex(-1, 0, "ArrowDown"), -1);
  strictEqual(nextSearchResultIndex(0, 0, "ArrowUp"), -1);
  strictEqual(nextSearchResultIndex(0, 0, "Home"), -1);
  strictEqual(nextSearchResultIndex(0, 0, "End"), -1);
});

test("nextSearchResultIndex - handles ArrowDown, ArrowUp, Home, End, and wrapping", () => {
  strictEqual(nextSearchResultIndex(-1, 3, "ArrowDown"), 0);
  strictEqual(nextSearchResultIndex(0, 3, "ArrowDown"), 1);
  strictEqual(nextSearchResultIndex(2, 3, "ArrowDown"), 0);

  strictEqual(nextSearchResultIndex(-1, 3, "ArrowUp"), 2);
  strictEqual(nextSearchResultIndex(0, 3, "ArrowUp"), 2);
  strictEqual(nextSearchResultIndex(2, 3, "ArrowUp"), 1);

  strictEqual(nextSearchResultIndex(1, 3, "Home"), 0);
  strictEqual(nextSearchResultIndex(1, 3, "End"), 2);

  strictEqual(nextSearchResultIndex(0, 1, "ArrowDown"), 0);
  strictEqual(nextSearchResultIndex(0, 1, "ArrowUp"), 0);
});
