import type { Database } from "@/db";

import { assertEquals } from "@std/assert";
import { asTestDatabase } from "@test/db-stubs";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: never[]) => unknown;
const mocks: {
  getDb: AnyMockFn;
  resolveActorPrincipalId: AnyMockFn;
} = {
  getDb: noopDep("getDb"),
  resolveActorPrincipalId: noopDep("resolveActorPrincipalId"),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
import { resolveAllowedCapabilities } from "@/services/platform/capabilities";

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  get: () => Promise<unknown>;
}

function createDrizzleMock(results: unknown[]): Database {
  let index = 0;
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    get: async () => results[index++],
  };
  return asTestDatabase({
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: async () => results[index++] },
  });
}

Deno.test("capabilities service - derives restricted egress posture from the workspace record", async () => {
  const drizzle = createDrizzleMock([
    { id: "principal-1" },
    { ownerAccountId: "owner-2" },
    { role: "editor" },
    { securityPosture: "restricted_egress" },
  ]);
  mocks.getDb = () => drizzle;

  const result = await resolveAllowedCapabilities({
    db: drizzle,
    spaceId: "ws-1",
    userId: "user-1",
  });

  assertEquals(result.ctx.role, "editor");
  assertEquals(result.ctx.securityPosture, "restricted_egress");
  assertEquals(result.allowed.has("egress.http"), false);
});
Deno.test("capabilities service - applies an admin floor when requested for agent execution", async () => {
  const drizzle = createDrizzleMock([
    { id: "principal-1" },
    { ownerAccountId: "owner-2" },
    { role: "viewer" },
    { securityPosture: "standard" },
  ]);
  mocks.getDb = () => drizzle;

  const result = await resolveAllowedCapabilities({
    db: drizzle,
    spaceId: "ws-1",
    userId: "user-1",
    minimumRole: "admin",
  });

  assertEquals(result.ctx.role, "admin");
  assertEquals(result.allowed.has("repo.write"), true);
  assertEquals(result.allowed.has("storage.write"), true);
  assertEquals(result.allowed.has("egress.http"), true);
});
Deno.test("capabilities service - preserves owner when the resolved role exceeds the admin floor", async () => {
  const drizzle = createDrizzleMock([
    { id: "principal-owner" },
    { ownerAccountId: "principal-owner" },
    { securityPosture: "standard" },
  ]);
  mocks.getDb = () => drizzle;

  const result = await resolveAllowedCapabilities({
    db: drizzle,
    spaceId: "ws-1",
    userId: "user-owner",
    minimumRole: "admin",
  });

  assertEquals(result.ctx.role, "owner");
});
