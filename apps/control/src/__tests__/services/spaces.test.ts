import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";
import { spaceCrudDeps } from "@/application/services/identity/space-crud.ts";
import { spaceModelDeps } from "@/application/services/identity/space-models.ts";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  getWorkspaceModelSettings,
  listWorkspacesForUser,
} from "@/services/identity/spaces";

function createDrizzleMock() {
  const getResults: unknown[] = [];
  const state: Record<string, any> = {
    all: (async (..._args: any[]) => undefined) as any,
    run: ((..._args: any[]) => undefined) as any,
  };
  let selectCalls = 0;
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    values: function (this: any) {
      return this;
    },
    returning: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    offset: function (this: any) {
      return this;
    },
    leftJoin: function (this: any) {
      return this;
    },
    innerJoin: function (this: any) {
      return this;
    },
    onConflictDoUpdate: function (this: any) {
      return this;
    },
    onConflictDoNothing: function (this: any) {
      return this;
    },
    get: async () => getResults.shift(),
    all: (...args: any[]) => state.all(...args),
    run: (...args: any[]) => state.run(...args),
  };
  return {
    select: () => {
      selectCalls += 1;
      return chain;
    },
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: Object.assign(state, {
      get: async () => getResults.shift(),
      chain,
      results: getResults,
    }),
    selectCalls: () => selectCalls,
  };
}

Deno.test("spaces service queries - lists spaces for a human principal from the canonical tables", async () => {
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;
  spaceCrudDeps.getDb = (() => drizzle) as any;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as any;
  spaceCrudDeps.isValidOpaqueId = (() => true) as any;

  // Call sequence:
  // 1. resolveUserPrincipalId: select({id}).from(accounts).where().get() -> {id: 'user-1'}
  // 2. listWorkspacesForUser main query: select({...}).from(accountMemberships).innerJoin().where().orderBy().all() -> memberships
  // 3. findLatestRepositoryBySpaceId: select({...}).from(repositories).where().orderBy().limit().get() -> repo
  drizzle._.results.push(
    { id: "repo-1", name: "main", default_branch: "main" },
  );

  drizzle._.all = (async () => [
    {
      memberRole: "owner",
      spaceId: "ws-1",
      spaceType: "user",
      spaceName: "User One",
      spaceSlug: "user1",
      spaceOwnerAccountId: "user-1",
      spaceHeadSnapshotId: null,
      spaceSecurityPosture: "restricted_egress",
      spaceCreatedAt: "2026-02-13T00:00:00.000Z",
      spaceUpdatedAt: "2026-02-13T00:00:00.000Z",
    },
  ]) as any;

  const result = await listWorkspacesForUser(
    { DB: {} as D1Database } as unknown as Env,
    "user-1",
  );

  assertEquals(result, [{
    id: "ws-1",
    kind: "user",
    name: "User One",
    slug: "user1",
    owner_principal_id: "user-1",
    automation_principal_id: null,
    head_snapshot_id: null,
    security_posture: "restricted_egress",
    created_at: "2026-02-13T00:00:00.000Z",
    updated_at: "2026-02-13T00:00:00.000Z",
    member_role: "owner",
    repository: {
      id: "repo-1",
      name: "main",
      default_branch: "main",
    },
  }]);
  assert(drizzle.selectCalls() > 0);
});
Deno.test("spaces service queries - reads model settings from spaces", async () => {
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;
  spaceModelDeps.getDb = (() => drizzle) as any;
  spaceModelDeps.isValidOpaqueId = (() => true) as any;

  drizzle._.results.push({
    ai_model: "gpt-5.4-nano",
    ai_provider: "openai",
    security_posture: "standard",
  });

  const result = await getWorkspaceModelSettings({} as D1Database, "ws-1");

  assertEquals(result, {
    ai_model: "gpt-5.4-nano",
    ai_provider: "openai",
    security_posture: "standard",
  });
  assert(drizzle.selectCalls() > 0);
});
