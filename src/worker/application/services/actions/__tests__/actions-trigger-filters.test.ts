import { assert, assertEquals } from "@std/assert";

import {
  __globCacheInternals,
  globToRegExp,
} from "../actions-trigger-filters.ts";

Deno.test("globToRegExp caches compiled patterns", () => {
  __globCacheInternals.clear();
  const a = globToRegExp("src/**/*.ts");
  const b = globToRegExp("src/**/*.ts");
  assert(a === b, "expected identical RegExp reference from cache");
  assertEquals(__globCacheInternals.size(), 1);
});

Deno.test("globToRegExp glob cache is bounded by max entries", () => {
  __globCacheInternals.clear();
  const max = __globCacheInternals.maxEntries;
  // Fill cache up to the cap.
  for (let i = 0; i < max; i++) {
    globToRegExp(`pattern-${i}/*.ts`);
  }
  assertEquals(__globCacheInternals.size(), max);

  // Inserting one more must trigger the clear-and-replace policy
  // (mirroring l1Cache pattern in services/routing/cache.ts).
  globToRegExp("overflow-trigger/*.ts");
  assert(
    __globCacheInternals.size() <= max,
    `cache size ${__globCacheInternals.size()} must stay <= ${max}`,
  );
  assertEquals(__globCacheInternals.size(), 1);
});

Deno.test("globToRegExp produces working regexes after overflow eviction", () => {
  __globCacheInternals.clear();
  const max = __globCacheInternals.maxEntries;
  for (let i = 0; i < max + 5; i++) {
    const re = globToRegExp(`feat-${i}/**/*.ts`);
    assert(re.test(`feat-${i}/sub/file.ts`));
  }
  assert(__globCacheInternals.size() <= max);
});
