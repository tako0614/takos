import { assertEquals } from "jsr:@std/assert";
import { repositoryIsInRemoteInventory } from "@/application/services/store-network/remote-install.ts";

Deno.test("remote install - verifies repository reference URL across inventory pages", async () => {
  const originalFetch = globalThis.fetch;
  const repositoryRefUrl = "https://repo.example.com/@alice/demo";
  const requestedOffsets: string[] = [];

  (globalThis as { fetch: typeof fetch }).fetch = (async (input) => {
    const url = new URL(String(input));
    requestedOffsets.push(url.searchParams.get("offset") ?? "");
    const offset = url.searchParams.get("offset");
    const items = offset === "100"
      ? [{
        id: "ref-2",
        name: "demo",
        repository_url: repositoryRefUrl,
        clone_url: "https://repo.example.com/git/alice/demo.git",
      }]
      : [{
        id: "ref-1",
        name: "other",
        repository_url: "https://repo.example.com/@alice/other",
        clone_url: "https://repo.example.com/git/alice/other.git",
      }];

    return new Response(
      JSON.stringify({
        id: url.toString(),
        total: 2,
        items,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const found = await repositoryIsInRemoteInventory(
      "https://store.example.com/api/public/stores/curated/inventory",
      repositoryRefUrl,
    );

    assertEquals(found, true);
    assertEquals(requestedOffsets, ["0", "100"]);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});
