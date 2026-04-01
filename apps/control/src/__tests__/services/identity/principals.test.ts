import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals } from "jsr:@std/assert";

import {
  principalsDeps,
  resolveUserPrincipalId,
  resolveActorPrincipalId,
  getPrincipalById,
} from "@/services/identity/principals";

function createFakeDb(rows: unknown[]): D1Database {
  const queue = [...rows];
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => queue.shift() ?? null,
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

Deno.test("resolveUserPrincipalId - returns the account id when the user exists", async () => {
  const db = createFakeDb([{ id: "user-1" }]);
  principalsDeps.getDb = () => db;
  assertEquals(await resolveUserPrincipalId(db, "user-1"), "user-1");
});

Deno.test("resolveUserPrincipalId - returns null when the user is not found", async () => {
  const db = createFakeDb([null]);
  principalsDeps.getDb = () => db;
  assertEquals(await resolveUserPrincipalId(db, "nonexistent"), null);
});

Deno.test("resolveUserPrincipalId - returns null when the row has a falsy id", async () => {
  const db = createFakeDb([{ id: "" }]);
  principalsDeps.getDb = () => db;
  assertEquals(await resolveUserPrincipalId(db, "user-1"), null);
});

Deno.test("resolveActorPrincipalId - returns the account id when the actor exists", async () => {
  const db = createFakeDb([{ id: "actor-1" }]);
  principalsDeps.getDb = () => db;
  assertEquals(await resolveActorPrincipalId(db, "actor-1"), "actor-1");
});

Deno.test("resolveActorPrincipalId - returns null when the actor is not found", async () => {
  const db = createFakeDb([null]);
  principalsDeps.getDb = () => db;
  assertEquals(await resolveActorPrincipalId(db, "nonexistent"), null);
});

Deno.test("getPrincipalById - returns a mapped Principal when the account exists", async () => {
  const db = createFakeDb([{
    id: "user-1",
    type: "user",
    name: "Test User",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }]);
  principalsDeps.getDb = () => db;
  assertEquals(await getPrincipalById(db, "user-1"), {
    id: "user-1",
    type: "user",
    display_name: "Test User",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  });
});

Deno.test("getPrincipalById - returns null when account does not exist", async () => {
  const db = createFakeDb([null]);
  principalsDeps.getDb = () => db;
  assertEquals(await getPrincipalById(db, "nonexistent"), null);
});

Deno.test("getPrincipalById - normalizes unknown type to service", async () => {
  const db = createFakeDb([{
    id: "svc-1",
    type: "unknown_type",
    name: "Service",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }]);
  principalsDeps.getDb = () => db;
  assertEquals((await getPrincipalById(db, "svc-1"))?.type, "service");
});

Deno.test("getPrincipalById - normalizes null type to service", async () => {
  const db = createFakeDb([{
    id: "svc-2",
    type: null,
    name: "Null Type",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }]);
  principalsDeps.getDb = () => db;
  assertEquals((await getPrincipalById(db, "svc-2"))?.type, "service");
});

Deno.test("getPrincipalById - maps known principal kinds correctly", async () => {
  const knownKinds = [
    "user",
    "space_agent",
    "service",
    "system",
    "tenant_worker",
  ];

  for (const kind of knownKinds) {
    const db = createFakeDb([{
      id: `test-${kind}`,
      type: kind,
      name: `Test ${kind}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]);
    principalsDeps.getDb = () => db;
    assertEquals((await getPrincipalById(db, `test-${kind}`))?.type, kind);
  }
});
