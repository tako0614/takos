import { expect, test } from "bun:test";
import { constantTimeEqualsString } from "../constant-time.ts";

test("constantTimeEqualsString compares equal and unequal strings", () => {
  expect(constantTimeEqualsString("bearer-token", "bearer-token")).toBe(true);
  expect(constantTimeEqualsString("bearer-token", "bearer-tokem")).toBe(false);
});

test("constantTimeEqualsString rejects length mismatches", () => {
  expect(constantTimeEqualsString("short", "short-but-longer")).toBe(false);
  expect(constantTimeEqualsString("", "x")).toBe(false);
  expect(constantTimeEqualsString("", "")).toBe(true);
});

test("constantTimeEqualsString compares UTF-8 bytes", () => {
  expect(constantTimeEqualsString("トークン", "トークン")).toBe(true);
  expect(constantTimeEqualsString("トークン", "トークソ")).toBe(false);
  // Canonically equivalent-looking strings still have different encodings;
  // comparisons must preserve the input bytes rather than normalize them.
  expect(constantTimeEqualsString("é", "e\u0301")).toBe(false);
});
