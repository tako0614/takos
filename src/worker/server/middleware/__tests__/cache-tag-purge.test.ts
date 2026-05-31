import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { Hono } from "hono";

import {
  _resetCacheTagIndexForTests,
  invalidateCache,
  withCache,
} from "../cache.ts";

type CacheEntry = { body: string; headers: Headers; status: number };

function installFakeCachesDefault(): {
  deleted: string[];
  map: Map<string, CacheEntry>;
} {
  const map = new Map<string, CacheEntry>();
  const deleted: string[] = [];
  const fakeCache = {
    async match(req: Request): Promise<Response | undefined> {
      const entry = map.get(req.url);
      if (!entry) return undefined;
      return new Response(entry.body, {
        status: entry.status,
        headers: entry.headers,
      });
    },
    async put(req: Request, res: Response): Promise<void> {
      const body = await res.text();
      map.set(req.url, {
        body,
        headers: new Headers(res.headers),
        status: res.status,
      });
    },
    async delete(req: Request | string): Promise<boolean> {
      const url = typeof req === "string" ? req : req.url;
      deleted.push(url);
      return map.delete(url);
    },
  };
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: fakeCache },
  });
  return { deleted, map };
}

function uninstallFakeCachesDefault(): void {
  // Re-define as undefined; the next install will overwrite it.
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: undefined,
  });
}

test("invalidateCache - tag-based purge deletes URLs stored under the tag", async () => {
  _resetCacheTagIndexForTests();
  const { deleted, map } = installFakeCachesDefault();
  try {
    const app = new Hono();
    app.use(
      "/explore/*",
      withCache({ ttl: 60, cacheTag: "explore" }),
    );
    app.get("/explore/a", (c) => c.text("alpha"));
    app.get("/explore/b", (c) => c.text("beta"));

    // Prime the cache for two URLs sharing the same Cache-Tag.
    await app.request("https://example.com/explore/a");
    await app.request("https://example.com/explore/b");
    assertEquals(map.size, 2);

    await invalidateCache({ tags: ["explore"] });

    // Both URLs should have been deleted from the cache.
    assertEquals(deleted.sort(), [
      "https://example.com/explore/a",
      "https://example.com/explore/b",
    ]);
    assertEquals(map.size, 0);

    // Subsequent purge for the same tag must not re-delete anything; the
    // index entry was consumed on the first call.
    deleted.length = 0;
    await invalidateCache({ tags: ["explore"] });
    assertEquals(deleted, []);
  } finally {
    _resetCacheTagIndexForTests();
    uninstallFakeCachesDefault();
  }
});

test("invalidateCache - URL[] form keeps deleting explicit URLs", async () => {
  _resetCacheTagIndexForTests();
  const { deleted } = installFakeCachesDefault();
  try {
    await invalidateCache([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    assertEquals(deleted.sort(), [
      "https://example.com/a",
      "https://example.com/b",
    ]);
  } finally {
    _resetCacheTagIndexForTests();
    uninstallFakeCachesDefault();
  }
});

test("invalidateCache - mixed urls + tags purge dedupes by URL", async () => {
  _resetCacheTagIndexForTests();
  const { deleted, map } = installFakeCachesDefault();
  try {
    const app = new Hono();
    app.use("/x", withCache({ ttl: 60, cacheTag: "tag-x" }));
    app.get("/x", (c) => c.text("x"));
    await app.request("https://example.com/x");
    assertEquals(map.size, 1);

    await invalidateCache({
      urls: ["https://example.com/x"],
      tags: ["tag-x"],
    });
    // Even though both inputs reference the same URL, it is deleted exactly
    // once (Set-based dedup).
    assertEquals(deleted, ["https://example.com/x"]);
  } finally {
    _resetCacheTagIndexForTests();
    uninstallFakeCachesDefault();
  }
});

test("invalidateCache - comma-separated Cache-Tag header registers each tag", async () => {
  _resetCacheTagIndexForTests();
  const { deleted, map } = installFakeCachesDefault();
  try {
    const app = new Hono();
    app.use("/multi", withCache({ ttl: 60, cacheTag: "tag-a, tag-b" }));
    app.get("/multi", (c) => c.text("multi"));
    await app.request("https://example.com/multi");
    assertEquals(map.size, 1);

    await invalidateCache({ tags: ["tag-b"] });
    assertEquals(deleted, ["https://example.com/multi"]);
  } finally {
    _resetCacheTagIndexForTests();
    uninstallFakeCachesDefault();
  }
});
