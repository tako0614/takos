import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: () => "worker-new",
  now: () => "2026-03-24T00:00:00.000Z",
  resolveActorPrincipalId: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
import {
  countServicesInSpace,
  createService,
  deleteService,
  getServiceById,
  listServicesForSpace,
  listServicesForUser,
  resolveServiceReferenceRecord,
  slugifyWorkerName,
  workerServiceDeps,
  WORKSPACE_WORKER_LIMITS,
} from "@/services/platform/workers";

const originalWorkerServiceDeps = { ...workerServiceDeps };

function setWorkerDeps(drizzle: ReturnType<typeof createDrizzleMock>) {
  workerServiceDeps.getDb =
    (() => drizzle) as unknown as typeof workerServiceDeps.getDb;
  workerServiceDeps.generateId = mocks
    .generateId as typeof workerServiceDeps.generateId;
  workerServiceDeps.resolveActorPrincipalId = mocks
    .resolveActorPrincipalId as typeof workerServiceDeps.resolveActorPrincipalId;
  workerServiceDeps.resolveAccessibleAccountIds =
    (async () => []) as typeof workerServiceDeps.resolveAccessibleAccountIds;
}

function restoreWorkerDeps() {
  Object.assign(workerServiceDeps, originalWorkerServiceDeps);
}

function createDrizzleMock() {
  const api = {
    get: ((..._args: any[]) => {
      api.get.calls.push(_args);
      return undefined;
    }) as any,
    all: ((..._args: any[]) => {
      api.all.calls.push(_args);
      return undefined;
    }) as any,
    run: ((..._args: any[]) => {
      api.run.calls.push(_args);
      return undefined;
    }) as any,
  };
  api.get.calls = [] as unknown[][];
  api.all.calls = [] as unknown[][];
  api.run.calls = [] as unknown[][];
  const values = ((..._args: any[]) => {
    values.calls.push(_args);
    return chain;
  }) as any;
  values.calls = [] as unknown[][];
  const insert = ((..._args: any[]) => {
    insert.calls.push(_args);
    return chain;
  }) as any;
  insert.calls = [] as unknown[][];
  const deleteFn = ((..._args: any[]) => {
    deleteFn.calls.push(_args);
    return chain;
  }) as any;
  deleteFn.calls = [] as unknown[][];
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
    values,
    returning: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    innerJoin: function (this: any) {
      return this;
    },
    get: ((...args: any[]) => api.get(...args)) as any,
    all: ((...args: any[]) => api.all(...args)) as any,
    run: ((...args: any[]) => api.run(...args)) as any,
  };
  return {
    select: () => chain,
    insert,
    update: () => chain,
    delete: deleteFn,
    _: api,
  };
}

const makeServiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: "w1",
  accountId: "ws-1",
  workerType: "app",
  status: "deployed",
  config: null,
  hostname: "my-app.takos.dev",
  routeRef: "worker-w1",
  slug: "my-app",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

Deno.test("slugifyWorkerName - lowercases and replaces invalid chars", () => {
  assertEquals(slugifyWorkerName("My App Name!"), "my-app-name");
});
Deno.test("slugifyWorkerName - removes leading/trailing hyphens", () => {
  assertEquals(slugifyWorkerName("-test-"), "test");
});
Deno.test("slugifyWorkerName - truncates to 32 characters", () => {
  const long = "a".repeat(50);
  assert(slugifyWorkerName(long).length <= 32);
});
Deno.test("slugifyWorkerName - handles empty string", () => {
  assertEquals(slugifyWorkerName(""), "");
});

Deno.test("WORKSPACE_WORKER_LIMITS - has a maxWorkers limit", () => {
  assertEquals(WORKSPACE_WORKER_LIMITS.maxWorkers, 100);
});

Deno.test("countServicesInSpace - returns count from DB", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({ count: 5 })) as any;
  setWorkerDeps(drizzle);

  try {
    const count = await countServicesInSpace({} as D1Database, "ws-1");
    assertEquals(count, 5);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("countServicesInSpace - returns 0 when no workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  setWorkerDeps(drizzle);

  try {
    const count = await countServicesInSpace({} as D1Database, "ws-1");
    assertEquals(count, 0);
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("listServicesForSpace - returns empty array when no workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  setWorkerDeps(drizzle);

  try {
    const workers = await listServicesForSpace({} as D1Database, "ws-1");
    assertEquals(workers, []);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("listServicesForSpace - returns mapped workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [makeServiceRow()]) as any;
  setWorkerDeps(drizzle);

  try {
    const workers = await listServicesForSpace({} as D1Database, "ws-1");
    assertEquals(workers.length, 1);
    assertEquals(workers[0].id, "w1");
    assertEquals(workers[0].space_id, "ws-1");
    assertEquals(workers[0].service_type, "app");
    assertEquals(workers[0].status, "deployed");
    assertEquals(workers[0].slug, "my-app");
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("getServiceById - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  setWorkerDeps(drizzle);

  try {
    const worker = await getServiceById({} as D1Database, "nonexistent");
    assertEquals(worker, null);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("getServiceById - returns mapped worker when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeServiceRow()) as any;
  setWorkerDeps(drizzle);

  try {
    const worker = await getServiceById({} as D1Database, "w1");
    assertNotEquals(worker, null);
    assertEquals(worker!.id, "w1");
    assertEquals(worker!.hostname, "my-app.takos.dev");
    assertEquals(worker!.service_name, "worker-w1");
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("createService - creates worker with generated id and hostname", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeServiceRow({ id: "worker-new" })) as any;
  setWorkerDeps(drizzle);

  try {
    const result = await createService({} as D1Database, {
      spaceId: "ws-1",
      workerType: "app",
      slug: "my-app",
      platformDomain: "takos.dev",
    });

    assertEquals(result.id, "worker-new");
    assertEquals(result.slug, "my-app");
    assertEquals(result.hostname, "my-app.takos.dev");
    assertEquals(drizzle.insert.calls.length > 0, true);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("createService - generates slug from id when not provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeServiceRow({ id: "worker-new" })) as any;
  setWorkerDeps(drizzle);

  try {
    const result = await createService({} as D1Database, {
      spaceId: "ws-1",
      workerType: "service",
      platformDomain: "takos.dev",
    });

    assertEquals(result.slug, "worker-new");
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("deleteService - deletes worker by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  setWorkerDeps(drizzle);

  try {
    await deleteService({} as D1Database, "w1");
    assertEquals(drizzle.delete.calls.length > 0, true);
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("listServicesForUser - returns empty when principal not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  workerServiceDeps.resolveActorPrincipalId = mocks.resolveActorPrincipalId;

  try {
    const result = await listServicesForUser({} as D1Database, "user-1");
    assertEquals(result, []);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("listServicesForUser - returns empty when no memberships", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveActorPrincipalId = (async () => "principal-1") as any;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any; // memberships
  setWorkerDeps(drizzle);
  workerServiceDeps.resolveActorPrincipalId = mocks.resolveActorPrincipalId;
  workerServiceDeps.resolveAccessibleAccountIds = (async () => [
    "principal-1",
  ]) as typeof workerServiceDeps.resolveAccessibleAccountIds;

  try {
    const result = await listServicesForUser({} as D1Database, "user-1");
    assertEquals(result, []);
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("resolveServiceReferenceRecord - returns null for empty reference", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveServiceReferenceRecord(
    {} as D1Database,
    "ws-1",
    "",
  );
  assertEquals(result, null);
});
Deno.test("resolveServiceReferenceRecord - returns null for whitespace-only reference", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveServiceReferenceRecord(
    {} as D1Database,
    "ws-1",
    "   ",
  );
  assertEquals(result, null);
});
Deno.test("resolveServiceReferenceRecord - returns worker when found by id/name/slug", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "w1",
    accountId: "ws-1",
    workerType: "app",
    status: "deployed",
    hostname: "my-app.takos.dev",
    routeRef: "worker-w1",
    slug: "my-app",
  })) as any;
  setWorkerDeps(drizzle);

  try {
    const result = await resolveServiceReferenceRecord(
      {} as D1Database,
      "ws-1",
      "my-app",
    );
    assertNotEquals(result, null);
    assertEquals(result!.id, "w1");
  } finally {
    restoreWorkerDeps();
  }
});
