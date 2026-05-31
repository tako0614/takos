import { assertEquals } from "@std/assert";
import { noopDep } from "@test/dep-stubs";

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/store'
import {
  canAccessResource,
  checkResourceAccess,
  resourceAccessDeps,
} from "@/services/resources/access";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";

const originalResourceAccessDeps = { ...resourceAccessDeps };

function restoreResourceAccessDeps() {
  Object.assign(resourceAccessDeps, originalResourceAccessDeps);
}

type AnyMockFn = (...args: unknown[]) => unknown;

interface DrizzleMockApi {
  get: AnyMockFn;
  all: AnyMockFn;
  run: AnyMockFn;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  leftJoin(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  get: AnyMockFn;
  all: AnyMockFn;
  run: AnyMockFn;
}

function createDrizzleMock() {
  const api: DrizzleMockApi = {
    get: noopDep("drizzleMock.get"),
    all: noopDep("drizzleMock.all"),
    run: noopDep("drizzleMock.run"),
  };
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    leftJoin() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    get: (...args: unknown[]) => api.get(...args),
    all: (...args: unknown[]) => api.all(...args),
    run: (...args: unknown[]) => api.run(...args),
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: api,
  };
}

type DrizzleMockHandle = ReturnType<typeof createDrizzleMock>;

function setResourceAccessGetDb(drizzle: DrizzleMockHandle): void {
  const erased: (...args: never[]) => object = () => drizzle;
  resourceAccessDeps.getDb = erased as typeof resourceAccessDeps.getDb;
}

import type { Resource } from "@/shared/types/services-resources.ts";

function makeResourceFixture(overrides: Partial<Resource>): Resource {
  return {
    id: "res-1",
    owner_id: "user-1",
    space_id: null,
    name: "fixture",
    type: "sql",
    implementation: "d1",
    status: "active",
    config: "{}",
    metadata: "{}",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("checkResourceAccess - returns true when user has direct access", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  // First call: memberships
  drizzle._.all = async () => [];
  // Second call: access check
  drizzle._.get = async () => ({ permission: "read" });
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-1",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await checkResourceAccess(
      noopSqlDatabaseBinding(),
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
  drizzle._.all = async () => [];
  drizzle._.get = async () => null;
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-1",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await checkResourceAccess(
      noopSqlDatabaseBinding(),
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
  drizzle._.all = async () => [];
  drizzle._.get = async () => ({ permission: "read" });
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-1",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await checkResourceAccess(
      noopSqlDatabaseBinding(),
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
  drizzle._.all = async () => [];
  drizzle._.get = async () => ({ permission: "admin" });
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-1",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await checkResourceAccess(
      noopSqlDatabaseBinding(),
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
  drizzle._.all = async () => [{ accountId: "team-1" }];
  drizzle._.get = async () => ({ permission: "write" });
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-1",
    "team-1",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await checkResourceAccess(
      noopSqlDatabaseBinding(),
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
  resourceAccessDeps.getResourceById =
    (async () => null) as typeof resourceAccessDeps.getResourceById;

  try {
    const result = await canAccessResource(
      noopSqlDatabaseBinding(),
      "res-1",
      "user-1",
    );
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - returns isOwner: true for resource owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () =>
    makeResourceFixture({
      id: "res-1",
      owner_id: "user-1",
      type: "sql",
      implementation: "d1",
      status: "active",
    })) as typeof resourceAccessDeps.getResourceById;

  try {
    const result = await canAccessResource(
      noopSqlDatabaseBinding(),
      "res-1",
      "user-1",
    );
    assertEquals(result.canAccess, true);
    assertEquals(result.isOwner, true);
    assertEquals(result.permission, "admin");
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - checks access grants for non-owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () =>
    makeResourceFixture({
      id: "res-1",
      owner_id: "other-user",
      type: "sql",
      implementation: "d1",
      status: "active",
    })) as typeof resourceAccessDeps.getResourceById;

  const drizzle = createDrizzleMock();
  drizzle._.all = async () => []; // memberships
  drizzle._.get = async () => ({ permission: "write" }); // access
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-2",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await canAccessResource(
      noopSqlDatabaseBinding(),
      "res-1",
      "user-2",
    );
    assertEquals(result.canAccess, true);
    assertEquals(result.isOwner, false);
    assertEquals(result.permission, "write");
  } finally {
    restoreResourceAccessDeps();
  }
});
Deno.test("canAccessResource - checks required permissions for non-owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resourceAccessDeps.getResourceById = (async () =>
    makeResourceFixture({
      id: "res-1",
      owner_id: "other-user",
      type: "sql",
      implementation: "d1",
      status: "active",
    })) as typeof resourceAccessDeps.getResourceById;

  const drizzle = createDrizzleMock();
  drizzle._.all = async () => [];
  drizzle._.get = async () => ({ permission: "read" });
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-2",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await canAccessResource(
      noopSqlDatabaseBinding(),
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
  resourceAccessDeps.getResourceById = (async () =>
    makeResourceFixture({
      id: "res-1",
      owner_id: "other-user",
      type: "sql",
      implementation: "d1",
      status: "active",
    })) as typeof resourceAccessDeps.getResourceById;

  const drizzle = createDrizzleMock();
  drizzle._.all = async () => [];
  drizzle._.get = async () => null;
  setResourceAccessGetDb(drizzle);
  resourceAccessDeps.resolveAccessibleAccountIds = (async () => [
    "user-2",
  ]) as typeof resourceAccessDeps.resolveAccessibleAccountIds;

  try {
    const result = await canAccessResource(
      noopSqlDatabaseBinding(),
      "res-1",
      "user-2",
    );
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
  } finally {
    restoreResourceAccessDeps();
  }
});
