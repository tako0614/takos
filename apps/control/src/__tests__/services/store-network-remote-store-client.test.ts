import { assertEquals } from "jsr:@std/assert";
import {
  fetchRemoteFeed,
  resolveStoreIdentifier,
} from "@/application/services/store-network/remote-store-client.ts";

Deno.test("remote store client - resolves slug@domain to public Store API URL", () => {
  assertEquals(resolveStoreIdentifier("curated@store.example.com"), {
    storeUrl: "https://store.example.com/api/public/stores/curated",
    domain: "store.example.com",
    storeSlug: "curated",
  });
});

Deno.test("remote store client - parses public Store feed repository references", async () => {
  const originalFetch = globalThis.fetch;
  const repositoryUrl = "https://repo.example.com/@alice/demo";
  let requestedUrl = "";

  (globalThis as { fetch: typeof fetch }).fetch = (async (input) => {
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
  }) as typeof fetch;

  try {
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
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});
