import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals } from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/store'
import {
  canAccessResource,
  checkResourceAccess,
  resourceAccessDeps,
} from "@/services/resources/access";

const originalResourceAccessDeps = { ...resourceAccessDeps };

function restoreResourceAccessDeps() {
  Object.assign(resourceAccessDeps, originalResourceAccessDeps);
}

function createDrizzleMock() {
  const api = {
    get: ((..._args: any[]) => undefined) as any,
    all: ((..._args: any[]) => undefined) as any,
    run: ((..._args: any[]) => undefined) as any,
  };
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
    leftJoin: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    get: ((...args: any[]) => api.get(...args)) as any,
    all: ((...args: any[]) => api.all(...args)) as any,
    run: ((...args: any[]) => api.run(...args)) as any,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: api,
  };
}

Deno.test("checkResourceAccess - returns true when user has direct access", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  // First call: memberships
  drizzle._.all = (async () => []) as any;
  // Second call: access check
  drizzle._.get = (async () => ({ permission: "read" })) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-1"]) as any;

  try {
    const result = await checkResourceAccess(
      {} as D1Database,
      "res-1",
      "user-1",
    );
    assertEquals(result, true);
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("checkResourceAccess - returns false when no access found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  drizzle._.get = (async () => null) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-1"]) as any;

  try {
    const result = await checkResourceAccess(
      {} as D1Database,
      "res-1",
      "user-1",
    );
    assertEquals(result, false);
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("checkResourceAccess - checks required permissions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  drizzle._.get = (async () => ({ permission: "read" })) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-1"]) as any;

  try {
    const result = await checkResourceAccess(
      {} as D1Database,
      "res-1",
      "user-1",
      ["write"],
    );
    assertEquals(result, false);
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("checkResourceAccess - passes when user has required permission", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  drizzle._.get = (async () => ({ permission: "admin" })) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-1"]) as any;

  try {
    const result = await checkResourceAccess(
      {} as D1Database,
      "res-1",
      "user-1",
      ["admin"],
    );
    assertEquals(result, true);
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("checkResourceAccess - includes workspace memberships in access check", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [{ accountId: "team-1" }]) as any;
  drizzle._.get = (async () => ({ permission: "write" })) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-1", "team-1"]) as any;

  try {
    const result = await checkResourceAccess(
      {} as D1Database,
      "res-1",
      "user-1",
      ["write"],
    );
    assertEquals(result, true);
  } finally {
    restoreResourceAccessDeps();
  }
});

Deno.test("canAccessResource - returns canAccess: false when resource not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () => null) as any;

  try {
    const result = await canAccessResource({} as D1Database, "res-1", "user-1");
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - returns isOwner: true for resource owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () => ({
    id: "res-1",
    owner_id: "user-1",
    type: "d1",
    status: "active",
  })) as any;

  try {
    const result = await canAccessResource({} as D1Database, "res-1", "user-1");
    assertEquals(result.canAccess, true);
    assertEquals(result.isOwner, true);
    assertEquals(result.permission, "admin");
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - checks access grants for non-owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () => ({
    id: "res-1",
    owner_id: "other-user",
    type: "d1",
    status: "active",
  })) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any; // memberships
  drizzle._.get = (async () => ({ permission: "write" })) as any; // access
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-2"]) as any;

  try {
    const result = await canAccessResource({} as D1Database, "res-1", "user-2");
    assertEquals(result.canAccess, true);
    assertEquals(result.isOwner, false);
    assertEquals(result.permission, "write");
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - checks required permissions for non-owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () => ({
    id: "res-1",
    owner_id: "other-user",
    type: "d1",
    status: "active",
  })) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  drizzle._.get = (async () => ({ permission: "read" })) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-2"]) as any;

  try {
    const result = await canAccessResource(
      {} as D1Database,
      "res-1",
      "user-2",
      ["admin"],
    );
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
    assertEquals(result.permission, "read");
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - returns canAccess: false when no access grants exist", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () => ({
    id: "res-1",
    owner_id: "other-user",
    type: "d1",
    status: "active",
  })) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  drizzle._.get = (async () => null) as any;
  resourceAccessDeps.getDb = (() => drizzle) as any;
  resourceAccessDeps.resolveAccessibleAccountIds =
    (async () => ["user-2"]) as any;

  try {
    const result = await canAccessResource({} as D1Database, "res-1", "user-2");
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
  } finally {
    restoreResourceAccessDeps();
  }
});
