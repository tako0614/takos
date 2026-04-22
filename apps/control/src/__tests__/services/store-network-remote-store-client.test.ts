import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  fetchRemoteFeed,
  fetchRemoteStoreDocument,
  RemoteStoreError,
  resolveStoreIdentifier,
  storeFetch,
} from "@/application/services/store-network/remote-store-client.ts";

async function withMockFetch<T>(
  handler: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = handler;
  try {
    return await fn();
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
}

Deno.test("remote store client - resolves slug@domain to public Store API URL", () => {
  assertEquals(resolveStoreIdentifier("curated@store.example.com"), {
    storeUrl: "https://store.example.com/api/public/stores/curated",
    domain: "store.example.com",
    storeSlug: "curated",
  });
});

Deno.test("remote store client - normalizes Store API URL identifiers", () => {
  assertEquals(
    resolveStoreIdentifier(
      "https://STORE.example.com/api/public/stores/curated/",
    ),
    {
      storeUrl: "https://store.example.com/api/public/stores/curated",
      domain: "store.example.com",
      storeSlug: "curated",
    },
  );
});

Deno.test("remote store client - rejects unsafe store identifiers", () => {
  const invalidIdentifiers = [
    "curated@",
    "@store.example.com",
    "curated@store.example.com/path",
    "curated@store.example.com?x=1",
    "curated@store.example.com#section",
    "curated@http://store.example.com",
    "curated@store.example.com:80",
    "curated@user:pass@store.example.com",
    "curated@localhost",
    "curated@127.0.0.1",
    "curated@store.local",
    "http://store.example.com/api/public/stores/curated",
    "https://store.example.com/api/public/stores/curated/extra",
    "https://store.example.com/api/public/stores/curated?x=1",
    "https://user:pass@store.example.com/api/public/stores/curated",
    "https://127.0.0.1/api/public/stores/curated",
  ];

  for (const identifier of invalidIdentifiers) {
    assertThrows(
      () => resolveStoreIdentifier(identifier),
      RemoteStoreError,
      undefined,
      identifier,
    );
  }
});

Deno.test("remote store client - fetches validated store document with fallback endpoints", async () => {
  let requestedUrl = "";

  await withMockFetch(
    (async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          id: "https://store.example.com/api/public/stores/curated/",
          slug: "curated",
          name: "Curated Store",
          repository_count: 3,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch,
    async () => {
      const store = await fetchRemoteStoreDocument(
        "https://store.example.com/api/public/stores/curated/",
      );

      assertEquals(
        requestedUrl,
        "https://store.example.com/api/public/stores/curated",
      );
      assertEquals(
        store.id,
        "https://store.example.com/api/public/stores/curated",
      );
      assertEquals(store.slug, "curated");
      assertEquals(store.name, "Curated Store");
      assertEquals(store.repositoryCount, 3);
      assertEquals(
        store.inventoryUrl,
        "https://store.example.com/api/public/stores/curated/inventory",
      );
      assertEquals(
        store.searchUrl,
        "https://store.example.com/api/public/stores/curated/search/repositories",
      );
      assertEquals(
        store.feedUrl,
        "https://store.example.com/api/public/stores/curated/feed",
      );
    },
  );
});

Deno.test("remote store client - rejects remote store documents with mismatched ids", async () => {
  await withMockFetch(
    (async () =>
      new Response(
        JSON.stringify({
          id: "https://evil.example.com/api/public/stores/curated",
          name: "Impostor",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch,
    async () => {
      await assertRejects(
        () =>
          fetchRemoteStoreDocument(
            "https://store.example.com/api/public/stores/curated",
          ),
        RemoteStoreError,
        "does not match",
      );
    },
  );
});

Deno.test("remote store client - rejects cross-origin store document endpoint URLs", async () => {
  await withMockFetch(
    (async () =>
      new Response(
        JSON.stringify({
          id: "https://store.example.com/api/public/stores/curated",
          name: "Curated Store",
          inventory_url:
            "https://evil.example.com/api/public/stores/curated/inventory",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch,
    async () => {
      await assertRejects(
        () =>
          fetchRemoteStoreDocument(
            "https://store.example.com/api/public/stores/curated",
          ),
        RemoteStoreError,
        "same-origin",
      );
    },
  );
});

Deno.test("remote store client - storeFetch rejects non-HTTPS URLs", async () => {
  await assertRejects(
    () => storeFetch("http://store.example.com/api/public/stores/curated/feed"),
    RemoteStoreError,
    "Only HTTPS",
  );
});

Deno.test("remote store client - storeFetch blocks downgrade redirects", async () => {
  await withMockFetch(
    (async () =>
      new Response(null, {
        status: 302,
        headers: {
          Location: "http://store.example.com/api/public/stores/curated/feed",
        },
      })) as typeof fetch,
    async () => {
      await assertRejects(
        () =>
          storeFetch(
            "https://store.example.com/api/public/stores/curated/feed",
          ),
        RemoteStoreError,
        "non-HTTPS",
      );
    },
  );
});

Deno.test("remote store client - storeFetch blocks cross-origin redirects", async () => {
  await withMockFetch(
    (async () =>
      new Response(null, {
        status: 302,
        headers: {
          Location: "https://evil.example.com/api/public/stores/curated/feed",
        },
      })) as typeof fetch,
    async () => {
      await assertRejects(
        () =>
          storeFetch(
            "https://store.example.com/api/public/stores/curated/feed",
          ),
        RemoteStoreError,
        "Cross-origin",
      );
    },
  );
});

Deno.test("remote store client - storeFetch enforces redirect depth limit", async () => {
  let requestCount = 0;

  await withMockFetch(
    (async () => {
      requestCount += 1;
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/api/public/stores/curated/feed",
        },
      });
    }) as typeof fetch,
    async () => {
      await assertRejects(
        () =>
          storeFetch(
            "https://store.example.com/api/public/stores/curated/feed",
          ),
        RemoteStoreError,
        "Too many redirects",
      );
    },
  );
  assertEquals(requestCount, 6);
});

Deno.test("remote store client - parses public Store feed repository references", async () => {
  const repositoryUrl = "https://repo.example.com/@alice/demo";
  let requestedUrl = "";

  await withMockFetch(
    (async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          total: 1,
          items: [{
            id: "feed-1",
            type: "inventory.add",
            published: "2026-03-02T00:00:00.000Z",
            repository: {
              id: "ref-1",
              owner: "alice",
              name: "demo",
              summary: "Demo repo",
              repository_url: repositoryUrl,
              clone_url: "https://repo.example.com/git/alice/demo.git",
              browse_url: repositoryUrl,
              default_branch: "main",
              default_branch_hash: "abc123",
              package_icon: "/icons/demo.svg",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-02T00:00:00.000Z",
            },
          }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch,
    async () => {
      const feed = await fetchRemoteFeed(
        "https://store.example.com/api/public/stores/curated/feed",
        { limit: 20, offset: 40 },
      );

      assertEquals(
        requestedUrl,
        "https://store.example.com/api/public/stores/curated/feed?limit=20&offset=40",
      );
      assertEquals(feed.totalItems, 1);
      assertEquals(feed.activities?.[0].activityType, "inventory.add");
      assertEquals(feed.activities?.[0].object.id, "ref-1");
      assertEquals(feed.activities?.[0].object.repositoryUrl, repositoryUrl);
      assertEquals(
        feed.activities?.[0].object.cloneUrl,
        "https://repo.example.com/git/alice/demo.git",
      );
      assertEquals(feed.activities?.[0].object.defaultBranch, "main");
      assertEquals(feed.activities?.[0].object.defaultBranchHash, "abc123");
      assertEquals(feed.activities?.[0].object.packageIcon, "/icons/demo.svg");
    },
  );
});
