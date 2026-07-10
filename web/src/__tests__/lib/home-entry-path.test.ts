import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";
import { isHomeEntryPath } from "../../lib/home-entry-path.ts";

test("home entry accepts the root and setup completion path only", () => {
  assertEquals(isHomeEntryPath("/"), true);
  assertEquals(isHomeEntryPath("/setup"), true);
  assertEquals(isHomeEntryPath("/unknown"), false);
});
