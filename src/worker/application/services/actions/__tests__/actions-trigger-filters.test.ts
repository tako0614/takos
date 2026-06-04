import { test } from "bun:test";
import { assert } from "@takos/test/assert";

import { globMatch } from "takos-actions-engine";

test("globMatch - `*` matches a run of non-slash chars but not `/`", () => {
  assert(globMatch("src/*.ts", "src/index.ts"));
  assert(!globMatch("src/*.ts", "src/sub/index.ts"));
});

test("globMatch - `**` matches any run including `/`", () => {
  assert(globMatch("src/**", "src/index.ts"));
  assert(globMatch("src/**", "src/sub/deep/file.ts"));
  assert(globMatch("src/**/*.ts", "src/sub/deep/file.ts"));
  assert(globMatch("feat-1/**/*.ts", "feat-1/sub/file.ts"));
});

test("globMatch - `?` matches exactly one non-slash char", () => {
  assert(globMatch("file-?.ts", "file-a.ts"));
  assert(!globMatch("file-?.ts", "file-ab.ts"));
  assert(!globMatch("file-?.ts", "file-/.ts"));
});

test("globMatch - literal special chars are matched literally", () => {
  assert(globMatch("a.b+c.ts", "a.b+c.ts"));
  assert(!globMatch("a.b+c.ts", "axbycz.ts"));
});

test("globMatch - is ReDoS-free on adversarial patterns", () => {
  // A backtracking RegExp would blow up on `a*a*...a*x` vs a long `a` run that
  // never reaches the trailing literal; the linear DP returns promptly.
  const pattern = "a*".repeat(40) + "x";
  const value = "a".repeat(200);
  assert(!globMatch(pattern, value));
});
