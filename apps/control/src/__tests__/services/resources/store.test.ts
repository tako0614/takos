import type { D1Database } from "@cloudflare/workers-types";
import { resourceStoreDeps } from "@/services/resources/store";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
};

let resourceStoreGetDb = resourceStoreDeps.getDb;
let resourceStoreNow = resourceStoreDeps.now;

Object.defineProperties(mocks, {
  getDb: {
    configurable: true,
    get: () => resourceStoreGetDb,
    set: (value) => {
      resourceStoreGetDb = value;
      resourceStoreDeps.getDb = value as typeof resourceStoreDeps.getDb;
    },
  },
  now: {
    configurable: true,
    get: () => resourceStoreNow,
    set: (value) => {
      resourceStoreNow = value;
      resourceStoreDeps.now = value as typeof resourceStoreDeps.now;
    },
  },
});

mocks.getDb = resourceStoreDeps.getDb as any;
mocks.now = resourceStoreDeps.now as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
function createDrizzleMock() {
  const delegates = {
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
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    leftJoin: function (this: any) {
      return this;
    },
    get: ((...args: any[]) => delegates.get(...args)) as any,
    all: ((...args: any[]) => delegates.all(...args)) as any,
    run: ((...args: any[]) => delegates.run(...args)) as any,
  };
  return {
    select: () => chain,
    selectDistinct: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: delegates,
  };
}

Deno.test("getResourceById - returns null when resource not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  mocks.getDb = (() => drizzle) as any;

  const { getResourceById } = await import("@/services/resources/store");
  const result = await getResourceById({} as D1Database, "nonexistent");

  assertEquals(result, null);
});
Deno.test("getResourceById - returns mapped resource when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "res-1",
    ownerAccountId: "user-1",
    accountId: "space-1",
    name: "my-db",
    type: "d1",
    status: "active",
    backingResourceId: "cf-123",
    backingResourceName: "my-d1-db",
    config: "{}",
    metadata: "{}",
    sizeBytes: null,
    itemCount: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;
  mocks.getDb = (() => drizzle) as any;

  const { getResourceById } = await import("@/services/resources/store");
  const result = await getResourceById({} as D1Database, "res-1");

  assertNotEquals(result, null);
  assertEquals(result!.id, "res-1");
  assertEquals(result!.owner_id, "user-1");
  assertEquals(result!.name, "my-db");
  assertEquals(result!.type, "sql");
  assertEquals(result!.capability, "sql");
  assertEquals(result!.implementation, "d1");
  assertEquals(result!.status, "active");
});

Deno.test("getResourceByName - returns null when resource not found by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  mocks.getDb = (() => drizzle) as any;

  const { getResourceByName } = await import("@/services/resources/store");
  const result = await getResourceByName(
    {} as D1Database,
    "user-1",
    "nonexistent",
  );

  assertEquals(result, null);
});
Deno.test("getResourceByName - returns resource with _internal_id when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "res-1",
    ownerAccountId: "user-1",
    accountId: "space-1",
    name: "my-db",
    type: "d1",
    status: "active",
    backingResourceId: "cf-123",
    backingResourceName: "my-d1-db",
    config: "{}",
    metadata: "{}",
    sizeBytes: null,
    itemCount: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;
  mocks.getDb = (() => drizzle) as any;

  const { getResourceByName } = await import("@/services/resources/store");
  const result = await getResourceByName({} as D1Database, "user-1", "my-db");

  assertNotEquals(result, null);
  assertEquals(result!._internal_id, "res-1");
  assertEquals(result!.name, "my-db");
  assertEquals(result!.type, "sql");
});

Deno.test("updateResourceMetadata - returns null when no updates provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = (() => "2026-01-02T00:00:00.000Z") as any;
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  const { updateResourceMetadata } = await import("@/services/resources/store");
  const result = await updateResourceMetadata({} as D1Database, "res-1", {});

  assertEquals(result, null);
});
Deno.test("updateResourceMetadata - updates name when provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = (() => "2026-01-02T00:00:00.000Z") as any;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "res-1",
    ownerAccountId: "user-1",
    accountId: null,
    name: "new-name",
    type: "d1",
    status: "active",
    backingResourceId: null,
    backingResourceName: null,
    config: "{}",
    metadata: "{}",
    sizeBytes: null,
    itemCount: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  })) as any;
  mocks.getDb = (() => drizzle) as any;

  const { updateResourceMetadata } = await import("@/services/resources/store");
  const result = await updateResourceMetadata({} as D1Database, "res-1", {
    name: "new-name",
  });

  assertNotEquals(result, null);
  assertEquals(result!.name, "new-name");
});
Deno.test("updateResourceMetadata - serializes config and metadata as JSON", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = (() => "2026-01-02T00:00:00.000Z") as any;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "res-1",
    ownerAccountId: "user-1",
    accountId: null,
    name: "test",
    type: "d1",
    status: "active",
    backingResourceId: null,
    backingResourceName: null,
    config: '{"key":"value"}',
    metadata: '{"meta":"data"}',
    sizeBytes: null,
    itemCount: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  })) as any;
  mocks.getDb = (() => drizzle) as any;

  const { updateResourceMetadata } = await import("@/services/resources/store");
  await updateResourceMetadata({} as D1Database, "res-1", {
    config: { key: "value" },
    metadata: { meta: "data" },
  });
});

Deno.test("markResourceDeleting - updates resource status to deleting", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = (() => "2026-01-02T00:00:00.000Z") as any;
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  const { markResourceDeleting } = await import("@/services/resources/store");
  await markResourceDeleting({} as D1Database, "res-1");
});

Deno.test("deleteResource - deletes a resource by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  const { deleteResource } = await import("@/services/resources/store");
  await deleteResource({} as D1Database, "res-1");
});

Deno.test("insertResource - inserts a resource and returns it", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "res-1",
    ownerAccountId: "user-1",
    accountId: "space-1",
    name: "my-new-db",
    type: "d1",
    status: "active",
    backingResourceId: "cf-123",
    backingResourceName: "my-d1-db",
    config: "{}",
    metadata: "{}",
    sizeBytes: null,
    itemCount: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;
  mocks.getDb = (() => drizzle) as any;

  const { insertResource } = await import("@/services/resources/store");
  const result = await insertResource({} as D1Database, {
    id: "res-1",
    owner_id: "user-1",
    name: "my-new-db",
    type: "d1",
    status: "active",
    backing_resource_id: "cf-123",
    backing_resource_name: "my-d1-db",
    config: {},
    space_id: "space-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  assertNotEquals(result, null);
  assertEquals(result!.name, "my-new-db");
});

Deno.test("insertFailedResource - inserts a resource with failed status", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  const { insertFailedResource } = await import("@/services/resources/store");
  await insertFailedResource({} as D1Database, {
    id: "res-1",
    owner_id: "user-1",
    name: "failed-db",
    type: "d1",
    backing_resource_name: "my-d1-db",
    config: { error: "provisioning failed" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
});
