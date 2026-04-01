import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals } from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  resolveActorPrincipalId: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
import { resolveAllowedCapabilities } from "@/services/platform/capabilities";

function createDrizzleMock(results: unknown[]) {
  let index = 0;
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    get: async () => results[index++],
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: async () => results[index++] },
  };
}

Deno.test("capabilities service - derives restricted egress posture from the workspace record", async () => {
  const drizzle = createDrizzleMock([
    { id: "principal-1" },
    { ownerAccountId: "owner-2" },
    { role: "editor" },
    { securityPosture: "restricted_egress" },
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await resolveAllowedCapabilities({
    db: drizzle as D1Database,
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
  mocks.getDb = (() => drizzle) as any;

  const result = await resolveAllowedCapabilities({
    db: drizzle as D1Database,
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
  mocks.getDb = (() => drizzle) as any;

  const result = await resolveAllowedCapabilities({
    db: drizzle as D1Database,
    spaceId: "ws-1",
    userId: "user-owner",
    minimumRole: "admin",
  });

  assertEquals(result.ctx.role, "owner");
});
