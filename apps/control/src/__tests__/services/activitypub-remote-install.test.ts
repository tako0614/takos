import { assertEquals } from "jsr:@std/assert";
import { repositoryIsInRemoteInventory } from "@/application/services/activitypub/remote-install.ts";

Deno.test("remote install - verifies canonical repo URL across inventory pages", async () => {
  const originalFetch = globalThis.fetch;
  const canonicalRepoUrl = "https://repo.example.com/ap/repos/alice/demo";
  const requestedPages: string[] = [];

  (globalThis as { fetch: typeof fetch }).fetch = (async (input) => {
    const url = new URL(String(input));
    requestedPages.push(url.searchParams.get("page") ?? "");
    const page = url.searchParams.get("page");
    const orderedItems = page === "2"
      ? [canonicalRepoUrl]
      : ["https://repo.example.com/ap/repos/alice/other"];

    return new Response(
      JSON.stringify({
        id: url.toString(),
        type: "OrderedCollectionPage",
        totalItems: 2,
        orderedItems,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/activity+json" },
      },
    );
  }) as typeof fetch;

  try {
    const found = await repositoryIsInRemoteInventory(
      "https://store.example.com/ap/stores/curated/inventory",
      canonicalRepoUrl,
    );

    assertEquals(found, true);
    assertEquals(requestedPages, ["1", "2"]);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});
