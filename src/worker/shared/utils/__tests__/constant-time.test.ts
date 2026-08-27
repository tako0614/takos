import { expect, test } from "bun:test";

import { constantTimeEqualsString } from "../constant-time.ts";

test("constantTimeEqualsString compares UTF-8 bytes without a length shortcut", () => {
  expect(constantTimeEqualsString("bearer-token", "bearer-token")).toBe(true);
  expect(constantTimeEqualsString("bearer-token", "bearer-tokem")).toBe(false);
  expect(constantTimeEqualsString("short", "short-but-longer")).toBe(false);
  expect(constantTimeEqualsString("", "x")).toBe(false);
  expect(constantTimeEqualsString("", "")).toBe(true);
});

test("constantTimeEqualsString compares multi-byte UTF-8 content", () => {
  expect(constantTimeEqualsString("トークン", "トークン")).toBe(true);
  expect(constantTimeEqualsString("トークン", "トークソ")).toBe(false);
  // These strings have equal JavaScript code-unit lengths but different UTF-8
  // bytes, so a code-unit comparator would be the wrong primitive.
  expect(constantTimeEqualsString("é", "e")).toBe(false);
});
