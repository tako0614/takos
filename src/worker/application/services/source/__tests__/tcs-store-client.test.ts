import { expect, test } from "bun:test";

import { listTcsStoreListings } from "../tcs-store-client.ts";

const page = {
  items: [
    {
      id: "listing-storage",
      scope: "tako",
      slug: "takos-storage",
      source: { git: "https://github.com/tako0614/takos-storage.git" },
      suggestedName: "storage",
      name: { ja: "Takos Storage", en: "Takos Storage" },
      description: { ja: "ストレージ", en: "Object storage" },
      badge: { ja: "追加候補", en: "Installable" },
      category: "storage",
      tags: ["storage", "object-storage"],
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    },
    {
      id: "listing-git",
      scope: "tako",
      slug: "takos-git",
      source: { git: "https://github.com/tako0614/takos-git.git" },
      suggestedName: "git",
      name: { ja: "Takos Git", en: "Takos Git" },
      description: { ja: "Git", en: "Git hosting" },
      badge: { ja: "追加候補", en: "Installable" },
      category: "developer",
      tags: ["git", "source"],
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    },
  ],
};

test("TCS v2 discovery uses the official read API and keeps install authority out", async () => {
  const requests: Request[] = [];
  const result = await listTcsStoreListings(
    {},
    { query: "storage", category: "storage", limit: 10 },
    async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(page);
    },
  );

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(
    "https://store.takosumi.com/tcs/v2/listings?limit=100&sort=updated&locale=en",
  );
  expect(requests[0]?.headers.get("authorization")).toBeNull();
  expect(result).toEqual({
    warnings: [],
    items: [
      {
        ...page.items[0],
        source: { git: "https://github.com/tako0614/takos-storage" },
        storeOrigin: "https://store.takosumi.com",
      },
    ],
  });
  expect(result.items[0]).not.toHaveProperty("ref");
  expect(result.items[0]).not.toHaveProperty("path");
  expect(result.items[0]).not.toHaveProperty("installConfigId");
});

test("TCS discovery bounds configured origins and degrades per unavailable store", async () => {
  const result = await listTcsStoreListings(
    {
      TAKOS_CAPSULE_STORE_URLS: JSON.stringify([
        "https://store-a.example.test",
        "https://store-b.example.test/catalog/",
      ]),
    },
    { limit: 1 },
    async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "store-a.example.test") {
        return new Response(null, { status: 503 });
      }
      return Response.json(page);
    },
  );

  expect(result.warnings).toEqual([
    "capsule store unavailable: https://store-a.example.test",
  ]);
  expect(result.items.map((item) => item.slug)).toEqual(["takos-storage"]);
  expect(result.items[0]?.storeOrigin).toBe(
    "https://store-b.example.test/catalog",
  );
});

test("TCS discovery retries one transient read without changing install authority", async () => {
  let attempts = 0;
  const result = await listTcsStoreListings(
    {},
    { query: "takos-git", limit: 1 },
    async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(null, { status: 503 })
        : Response.json(page);
    },
  );

  expect(attempts).toBe(2);
  expect(result.warnings).toEqual([]);
  expect(result.items.map((item) => item.slug)).toEqual(["takos-git"]);
});

test("TCS discovery rejects credential-bearing operator origins", async () => {
  await expect(
    listTcsStoreListings(
      {
        TAKOS_CAPSULE_STORE_URLS: JSON.stringify([
          "https://user:secret@store.example.test",
        ]),
      },
      { limit: 10 },
      async () => Response.json(page),
    ),
  ).rejects.toThrow("credential-free HTTPS URL");
});
