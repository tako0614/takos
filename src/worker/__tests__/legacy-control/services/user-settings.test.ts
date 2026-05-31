import type { Database } from "@/db";
import { asTestDatabase } from "@test/db-stubs";

/**
 * Minimal mock for the Drizzle DB object returned by getDb().
 * Supports chained calls: select().from().where().get() and
 * insert().values().returning().get(), update().set().where().
 */
import { assertEquals } from "@std/assert";

type DrizzleGetFn = () => Promise<unknown>;

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  returning(): DrizzleMockChain;
  get: DrizzleGetFn;
}

function createMockDrizzleDb(selectResults: unknown[] = []): Database {
  const getMock: DrizzleGetFn = async () => selectResults.shift();
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
    returning() {
      return chain;
    },
    get: getMock,
  };
  return asTestDatabase({
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, chain },
  });
}

import { noopDep } from "@test/dep-stubs";

type GetDbStub = (...args: never[]) => Database;
const mocks: { getDb: GetDbStub } = {
  getDb: noopDep<GetDbStub>("user-settings.getDb"),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  ensureUserSettings,
  getUserSettings,
  updateUserSettings,
} from "@/services/identity/user-settings";

Deno.test("user-settings service (Drizzle) - getUserSettings returns null when row is not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const db = createMockDrizzleDb([null]);
  mocks.getDb = () => db;

  const result = await getUserSettings(
    db,
    "user-1",
  );
  assertEquals(result, null);
});
Deno.test("user-settings service (Drizzle) - getUserSettings returns mapped settings when row exists", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const db = createMockDrizzleDb([
    {
      accountId: "user-1",
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: "public",
      createdAt: "2026-02-13T00:00:00.000Z",
      updatedAt: "2026-02-13T00:00:00.000Z",
    },
  ]);
  mocks.getDb = () => db;

  const result = await getUserSettings(
    db,
    "user-1",
  );
  assertEquals(result, {
    userId: "user-1",
    setupCompleted: true,
    autoUpdateEnabled: true,
    privateAccount: false,
    activityVisibility: "public",
    aiModel: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
  });
});
Deno.test("user-settings service (Drizzle) - ensureUserSettings creates row when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const db = createMockDrizzleDb([
    null,
    {
      accountId: "user-1",
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: "public",
      createdAt: "2026-02-13T00:00:00.000Z",
      updatedAt: "2026-02-13T00:00:00.000Z",
    },
  ]);
  mocks.getDb = () => db;

  const result = await ensureUserSettings(
    db,
    "user-1",
  );
  assertEquals(result, {
    userId: "user-1",
    setupCompleted: false,
    autoUpdateEnabled: true,
    privateAccount: false,
    activityVisibility: "public",
    aiModel: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
  });
});
Deno.test("user-settings service (Drizzle) - updateUserSettings updates and returns refreshed settings", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const db = createMockDrizzleDb([
    {
      accountId: "user-1",
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: "public",
      createdAt: "2026-02-13T00:00:00.000Z",
      updatedAt: "2026-02-13T00:00:00.000Z",
    },
    {
      accountId: "user-1",
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: "public",
      createdAt: "2026-02-13T00:00:00.000Z",
      updatedAt: "2026-02-13T00:00:00.000Z",
    },
  ]);
  mocks.getDb = () => db;

  const result = await updateUserSettings(
    db,
    "user-1",
    {
      setup_completed: true,
    },
  );
  assertEquals(result, {
    userId: "user-1",
    setupCompleted: true,
    autoUpdateEnabled: true,
    privateAccount: false,
    activityVisibility: "public",
    aiModel: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
  });
});
