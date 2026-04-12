import { assertEquals } from "jsr:@std/assert";
import { resolveHostnameRouting } from "../../application/services/routing/service.ts";
import type { RoutingBindings } from "../../application/services/routing/routing-models.ts";

Deno.test("routing service keeps KV tombstones authoritative in cache phases", async () => {
  const tombstoneUntil = Date.now() + 60_000;
  const env: RoutingBindings = {
    ROUTING_DO_PHASE: "4",
    HOSTNAME_ROUTING: {
      async get() {
        return JSON.stringify({
          tombstone: true,
          tombstoneUntil,
          updatedAt: Date.now(),
        });
      },
      async put() {
        throw new Error("KV put should not be called");
      },
      async delete() {
        throw new Error("KV delete should not be called");
      },
      async list() {
        return { keys: [], list_complete: true };
      },
    },
  };

  const resolved = await resolveHostnameRouting({
    env,
    hostname: "Deleted.Example",
  });

  assertEquals(resolved.source, "kv");
  assertEquals(resolved.tombstone, true);
  assertEquals(resolved.target, null);
});
