import type { Env } from "@/types";

import { assertObjectMatch } from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { getPersonalWorkspace } from "@/services/identity/spaces";

function createDrizzleMock() {
  const getResults: unknown[] = [];
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
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
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: {
      get: async () => getResults.shift(),
      all: allMock,
      run: runMock,
      chain,
      results: getResults,
    },
  };
}

Deno.test("personal space (user account as workspace) - returns the user account itself as the personal workspace with kind=user", async () => {
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  // Call sequence:
  // 1. getPersonalWorkspace: select().from(accounts).where(id=userId, type='user').limit(1).get() -> user account
  // 2. ensureSelfMembership: resolveUserPrincipalId -> select().from(accounts).where(id).get() -> {id: 'user-1'}
  // 3. ensureSelfMembership: select({id}).from(accountMemberships).where(...).limit(1).get() -> existing membership
  // 4. findLatestRepositoryBySpaceId: select().from(repositories).where(...).orderBy(...).limit(1).get() -> null
  drizzle._.results.push(
    {
      id: "user-1",
      type: "user",
      name: "User One",
      slug: "user1",
      headSnapshotId: null,
      createdAt: "2026-03-01",
      updatedAt: "2026-03-01",
    },
    { id: "user-1" },
    { id: "membership-1" },
    undefined,
  );

  const result = await getPersonalWorkspace(
    { DB: drizzle as unknown as Env["DB"] } as Env,
    "user-1",
  );

  assertObjectMatch(result!, {
    id: "user-1",
    kind: "user",
    owner_principal_id: "user-1",
  });
});
