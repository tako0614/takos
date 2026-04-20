import { assertEquals } from "jsr:@std/assert";
import { fetchRemoteOutbox } from "@/application/services/activitypub/remote-store-client.ts";

Deno.test("remote store client - parses Add activity object URI as repository reference", async () => {
  const originalFetch = globalThis.fetch;
  const repoActorUrl = "https://repo.takos.social/ap/repos/alice/demo";

  (globalThis as { fetch: typeof fetch }).fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "https://store.takos.social/ap/stores/curated/outbox?page=1",
        type: "OrderedCollectionPage",
        totalItems: 1,
        orderedItems: [{
          id: "https://store.takos.social/ap/stores/curated/activities/add/1",
          type: "Add",
          actor: "https://store.takos.social/ap/stores/curated",
          published: "2026-03-02T00:00:00.000Z",
          object: repoActorUrl,
          target: "https://store.takos.social/ap/stores/curated/inventory",
        }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/activity+json" },
      },
    )) as typeof fetch;

  try {
    const outbox = await fetchRemoteOutbox(
      "https://store.takos.social/ap/stores/curated/outbox",
      { page: 1 },
    );

    assertEquals(outbox.totalItems, 1);
    assertEquals(outbox.activities?.[0].activityType, "Add");
    assertEquals(outbox.activities?.[0].object.id, repoActorUrl);
    assertEquals(outbox.activities?.[0].object.type, "Repository");
    assertEquals(outbox.activities?.[0].object.url, repoActorUrl);
    assertEquals(
      outbox.activities?.[0].object.published,
      "2026-03-02T00:00:00.000Z",
    );
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});
