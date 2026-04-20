import { assertEquals } from "jsr:@std/assert";

import { toApiResource } from "../format.ts";

Deno.test("toApiResource returns canonical public resource types", () => {
  assertEquals(
    toApiResource({
      id: "res-1",
      ownerId: "user-1",
      spaceId: "space-1",
      groupId: null,
      name: "storage",
      type: "d1",
      semanticType: null,
      driver: null,
      backendName: "cloudflare",
      status: "active",
      backingResourceId: "db-id",
      backingResourceName: "db-name",
      config: "{}",
      metadata: "{}",
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }).type,
    "sql",
  );
});
