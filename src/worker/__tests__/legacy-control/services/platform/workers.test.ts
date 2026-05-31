import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: never[]) => unknown;

const mocks: {
  getDb: AnyMockFn;
  generateId: () => string;
  now: () => string;
  resolveActorPrincipalId: AnyMockFn;
} = {
  getDb: noopDep("workerServiceDeps.getDb"),
  generateId: () => "worker-new",
  now: () => "2026-03-24T00:00:00.000Z",
  resolveActorPrincipalId: noopDep("workerServiceDeps.resolveActorPrincipalId"),
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
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { asTestDatabase } from "@test/db-stubs";

const originalWorkerServiceDeps = { ...workerServiceDeps };

function setWorkerDeps(drizzle: ReturnType<typeof createDrizzleMock>) {
  const wrappedDb = asTestDatabase(drizzle);
  workerServiceDeps.getDb =
    ((..._args: Parameters<typeof workerServiceDeps.getDb>) =>
      wrappedDb) as typeof workerServiceDeps.getDb;
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

type MockFn = (...args: unknown[]) => unknown;
type RecordedFn = MockFn & { calls: unknown[][] };

function makeRecorded(impl: MockFn): RecordedFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl(...args);
  }) as RecordedFn;
  fn.calls = [];
  return fn;
}

interface DrizzleApi {
  get: MockFn;
  all: MockFn;
  run: MockFn;
}

interface DrizzleChain {
  from(): DrizzleChain;
  where(): DrizzleChain;
  set(): DrizzleChain;
  values: RecordedFn;
  returning(): DrizzleChain;
  orderBy(): DrizzleChain;
  limit(): DrizzleChain;
  innerJoin(): DrizzleChain;
  get: MockFn;
  all: MockFn;
  run: MockFn;
}

function createDrizzleMock() {
  const api: DrizzleApi = {
    get: () => undefined,
    all: () => undefined,
    run: () => undefined,
  };
  const values = makeRecorded(() => chain);
  const insert = makeRecorded(() => chain);
  const deleteFn = makeRecorded(() => chain);
  const chain: DrizzleChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values,
    returning() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    get: (...args: unknown[]) => api.get(...args),
    all: (...args: unknown[]) => api.all(...args),
    run: (...args: unknown[]) => api.run(...args),
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
  hostname: "my-app.takos.jp",
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
  drizzle._.get = async () => ({ count: 5 });
  setWorkerDeps(drizzle);

  try {
    const count = await countServicesInSpace(
      noopSqlDatabaseBinding(),
      "ws-1",
    );
    assertEquals(count, 5);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("countServicesInSpace - returns 0 when no workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined;
  setWorkerDeps(drizzle);

  try {
    const count = await countServicesInSpace(
      noopSqlDatabaseBinding(),
      "ws-1",
    );
    assertEquals(count, 0);
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("listServicesForSpace - returns empty array when no workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = async () => [];
  setWorkerDeps(drizzle);

  try {
    const workers = await listServicesForSpace(
      noopSqlDatabaseBinding(),
      "ws-1",
    );
    assertEquals(workers, []);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("listServicesForSpace - returns mapped workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = async () => [makeServiceRow()];
  setWorkerDeps(drizzle);

  try {
    const workers = await listServicesForSpace(
      noopSqlDatabaseBinding(),
      "ws-1",
    );
    assertEquals(workers.length, 1);
    assertEquals(workers[0].id, "w1");
    assertEquals(workers[0].space_id, "ws-1");
    assertEquals(workers[0].service_type, "app");
    assertEquals(workers[0].status, "deployed");
    assertEquals(workers[0].name, "worker-w1");
    assertEquals(workers[0].slug, "my-app");
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("getServiceById - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined;
  setWorkerDeps(drizzle);

  try {
    const worker = await getServiceById(
      noopSqlDatabaseBinding(),
      "nonexistent",
    );
    assertEquals(worker, null);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("getServiceById - returns mapped worker when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => makeServiceRow();
  setWorkerDeps(drizzle);

  try {
    const worker = await getServiceById(
      noopSqlDatabaseBinding(),
      "w1",
    );
    assertNotEquals(worker, null);
    assertEquals(worker!.id, "w1");
    assertEquals(worker!.hostname, "my-app.takos.jp");
    assertEquals(worker!.name, "worker-w1");
    assertEquals(worker!.service_name, "worker-w1");
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("createService - creates worker with generated id and hostname", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => makeServiceRow({ id: "worker-new" });
  setWorkerDeps(drizzle);

  try {
    const result = await createService(noopSqlDatabaseBinding(), {
      spaceId: "ws-1",
      workerType: "app",
      slug: "my-app",
      platformDomain: "takos.jp",
    });

    assertEquals(result.id, "worker-new");
    assertEquals(result.slug, "my-app");
    assertEquals(result.hostname, "my-app.takos.jp");
    assertEquals(drizzle.insert.calls.length > 0, true);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("createService - generates slug from id when not provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => makeServiceRow({ id: "worker-new" });
  setWorkerDeps(drizzle);

  try {
    const result = await createService(noopSqlDatabaseBinding(), {
      spaceId: "ws-1",
      workerType: "service",
      platformDomain: "takos.jp",
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
    await deleteService(noopSqlDatabaseBinding(), "w1");
    assertEquals(drizzle.delete.calls.length > 0, true);
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("listServicesForUser - returns empty when principal not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveActorPrincipalId = async () => null;
  workerServiceDeps.resolveActorPrincipalId = mocks
    .resolveActorPrincipalId as typeof workerServiceDeps.resolveActorPrincipalId;

  try {
    const result = await listServicesForUser(
      noopSqlDatabaseBinding(),
      "user-1",
    );
    assertEquals(result, []);
  } finally {
    restoreWorkerDeps();
  }
});
Deno.test("listServicesForUser - returns empty when no memberships", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveActorPrincipalId = async () => "principal-1";
  const drizzle = createDrizzleMock();
  drizzle._.all = async () => []; // memberships
  setWorkerDeps(drizzle);
  workerServiceDeps.resolveActorPrincipalId = mocks
    .resolveActorPrincipalId as typeof workerServiceDeps.resolveActorPrincipalId;
  workerServiceDeps.resolveAccessibleAccountIds = (async () => [
    "principal-1",
  ]) as typeof workerServiceDeps.resolveAccessibleAccountIds;

  try {
    const result = await listServicesForUser(
      noopSqlDatabaseBinding(),
      "user-1",
    );
    assertEquals(result, []);
  } finally {
    restoreWorkerDeps();
  }
});

Deno.test("resolveServiceReferenceRecord - returns null for empty reference", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveServiceReferenceRecord(
    noopSqlDatabaseBinding(),
    "ws-1",
    "",
  );
  assertEquals(result, null);
});
Deno.test("resolveServiceReferenceRecord - returns null for whitespace-only reference", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveServiceReferenceRecord(
    noopSqlDatabaseBinding(),
    "ws-1",
    "   ",
  );
  assertEquals(result, null);
});
Deno.test("resolveServiceReferenceRecord - returns worker when found by id/name/slug", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({
    id: "w1",
    accountId: "ws-1",
    workerType: "app",
    status: "deployed",
    hostname: "my-app.takos.jp",
    routeRef: "worker-w1",
    slug: "my-app",
  });
  setWorkerDeps(drizzle);

  try {
    const result = await resolveServiceReferenceRecord(
      noopSqlDatabaseBinding(),
      "ws-1",
      "my-app",
    );
    assertNotEquals(result, null);
    assertEquals(result!.id, "w1");
  } finally {
    restoreWorkerDeps();
  }
});
