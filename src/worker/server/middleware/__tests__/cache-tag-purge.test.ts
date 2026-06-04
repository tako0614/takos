import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { invalidateCache } from "../cache.ts";

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

test("invalidateCache - URL[] form deletes explicit URLs", async () => {
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
    uninstallFakeCachesDefault();
  }
});

test("invalidateCache - single-string form deletes one URL", async () => {
  const { deleted } = installFakeCachesDefault();
  try {
    await invalidateCache("https://example.com/single");
    assertEquals(deleted, ["https://example.com/single"]);
  } finally {
    uninstallFakeCachesDefault();
  }
});

test("invalidateCache - { urls } form dedupes by URL", async () => {
  const { deleted } = installFakeCachesDefault();
  try {
    await invalidateCache({
      urls: [
        "https://example.com/x",
        "https://example.com/x",
        "https://example.com/y",
      ],
    });
    // Each distinct URL is deleted exactly once (Set-based dedup).
    assertEquals(deleted.sort(), [
      "https://example.com/x",
      "https://example.com/y",
    ]);
  } finally {
    uninstallFakeCachesDefault();
  }
});
