import { test } from "bun:test";
import { assertEquals, assertThrows } from "@std/assert";

import { compareSemver, getUpdateType } from "../store-install.ts";

test("compareSemver orders semver values correctly", () => {
  assertEquals(compareSemver("1.0.0", "1.1.0"), -1);
  assertEquals(compareSemver("2.0.0", "1.0.0"), 1);
  assertEquals(compareSemver("1.0.0", "1.0.0"), 0);
  assertEquals(compareSemver("v1.0.0", "v1.1.0"), -1);
});

test("compareSemver rejects invalid semver", () => {
  assertThrows(() => compareSemver("1.0", "1.0.0"), Error, "Invalid semver");
  assertThrows(() => compareSemver("abc", "1.0.0"), Error, "Invalid semver");
  assertThrows(() => compareSemver("1.0.0", ""), Error, "Invalid semver");
});

test("getUpdateType detects update class", () => {
  assertEquals(getUpdateType("1.0.0", "1.0.1"), "patch");
  assertEquals(getUpdateType("1.0.0", "1.1.0"), "minor");
  assertEquals(getUpdateType("1.0.0", "2.0.0"), "major");
  assertEquals(getUpdateType("v1.0.0", "v2.0.0"), "major");
});
