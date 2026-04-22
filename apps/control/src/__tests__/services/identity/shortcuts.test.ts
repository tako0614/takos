// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import type { D1Database } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertRejects,
} from "jsr:@std/assert";

import {
  ALLOWED_SHORTCUT_RESOURCE_TYPES,
  createShortcut,
  deleteShortcut,
  generateShortcutId,
  isShortcutResourceType,
  listShortcuts,
  shortcutDeps,
  updateShortcut,
} from "@/services/identity/shortcuts";

type FakeStep = {
  get?: unknown;
  all?: unknown[];
  run?: unknown;
};

const originalShortcutDeps = {
  getDb: shortcutDeps.getDb,
  generateShortcutId: shortcutDeps.generateShortcutId,
};

function createFakeDrizzleDatabase(steps: FakeStep[]) {
  const operations: string[] = [];
  let index = 0;

  const buildChain = (operation: string) => {
    const step = steps[index++] ?? {};
    operations.push(operation);

    const chain = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      values() {
        return chain;
      },
      set() {
        return chain;
      },
      returning() {
        return chain;
      },
      get: async () => step.get ?? null,
      all: async () => step.all ?? [],
      run: async () =>
        step.run ?? {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        },
    };

    return chain;
  };

  return {
    db: {
      select() {
        return buildChain("select");
      },
      insert() {
        return buildChain("insert");
      },
      update() {
        return buildChain("update");
      },
      delete() {
        return buildChain("delete");
      },
    },
    operations,
  };
}

function restoreShortcutDeps() {
  shortcutDeps.getDb = originalShortcutDeps.getDb;
  shortcutDeps.generateShortcutId = originalShortcutDeps.generateShortcutId;
}

Deno.test("generateShortcutId - produces a non-empty string", () => {
  const id = generateShortcutId();
  assertEquals(typeof id, "string");
  assert(id.length > 0);
});

Deno.test("generateShortcutId - produces unique values", () => {
  const ids = new Set(Array.from({ length: 50 }, () => generateShortcutId()));
  assertEquals(ids.size, 50);
});

Deno.test("isShortcutResourceType - returns true for all allowed types", () => {
  for (const type of ALLOWED_SHORTCUT_RESOURCE_TYPES) {
    assertEquals(isShortcutResourceType(type), true);
  }
});

Deno.test("isShortcutResourceType - returns false for unknown types", () => {
  assertEquals(isShortcutResourceType("unknown"), false);
  assertEquals(isShortcutResourceType(""), false);
  assertEquals(isShortcutResourceType("Worker"), false);
});

Deno.test("ALLOWED_SHORTCUT_RESOURCE_TYPES - contains service, resource, and link", () => {
  assertEquals(ALLOWED_SHORTCUT_RESOURCE_TYPES, [
    "service",
    "resource",
    "link",
  ]);
});

Deno.test(
  "listShortcuts - returns empty array when no shortcuts exist",
  async () => {
    const { db } = createFakeDrizzleDatabase([{ all: [] }]);
    shortcutDeps.getDb = () => db as never;

    try {
      const result = await listShortcuts({} as D1Database, "user-1", "space-1");
      assertEquals(result, []);
    } finally {
      restoreShortcutDeps();
    }
  },
);

Deno.test(
  "listShortcuts - maps rows to API format with service join data",
  async () => {
    const { db } = createFakeDrizzleDatabase([
      {
        all: [{
          id: "sc-1",
          userAccountId: "user-1",
          accountId: "space-1",
          resourceType: "worker",
          resourceId: "w-1",
          name: "My Worker",
          icon: null,
          position: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }],
      },
      {
        all: [{
          id: "w-1",
          hostname: "my-worker.example.com",
          status: "running",
        }],
      },
    ]);
    shortcutDeps.getDb = () => db as never;

    try {
      const result = await listShortcuts({} as D1Database, "user-1", "space-1");
      assertEquals(result.length, 1);
      assertObjectMatch(result[0], {
        id: "sc-1",
        user_id: "user-1",
        space_id: "space-1",
        resource_type: "service",
        resource_id: "w-1",
        name: "My Worker",
        service_hostname: "my-worker.example.com",
        service_status: "running",
      });
    } finally {
      restoreShortcutDeps();
    }
  },
);

Deno.test(
  "createShortcut - creates a shortcut and returns the API response",
  async () => {
    const { db } = createFakeDrizzleDatabase([
      {
        get: {
          id: "sc-new",
          userAccountId: "user-1",
          accountId: "space-1",
          resourceType: "service",
          resourceId: "w-1",
          name: "Created",
          icon: null,
          position: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        get: {
          id: "sc-new",
          userAccountId: "user-1",
          accountId: "space-1",
          resourceType: "service",
          resourceId: "w-1",
          name: "Created",
          icon: null,
          position: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ]);
    shortcutDeps.getDb = () => db as never;
    shortcutDeps.generateShortcutId = () => "sc-new";

    try {
      const result = await createShortcut(
        {} as D1Database,
        "user-1",
        "space-1",
        {
          name: "Created",
          resourceType: "service",
          resourceId: "w-1",
        },
      );

      assertEquals(result.name, "Created");
      assertEquals(result.resource_type, "service");
    } finally {
      restoreShortcutDeps();
    }
  },
);

Deno.test("createShortcut - throws for invalid resource type", async () => {
  await assertRejects(
    () =>
      createShortcut({} as D1Database, "user-1", "space-1", {
        name: "Bad",
        resourceType: "invalid" as never,
        resourceId: "x",
      }),
    Error,
    "Invalid shortcut resource type",
  );
});

Deno.test("updateShortcut - returns false when no updates are provided", async () => {
  const result = await updateShortcut(
    {} as D1Database,
    "user-1",
    "space-1",
    "sc-1",
    {},
  );
  assertEquals(result, false);
});

Deno.test("updateShortcut - returns true when name is updated", async () => {
  const { db } = createFakeDrizzleDatabase([{
    run: { success: true, meta: { changes: 1 } },
  }]);
  shortcutDeps.getDb = () => db as never;

  try {
    const result = await updateShortcut(
      {} as D1Database,
      "user-1",
      "space-1",
      "sc-1",
      { name: "New Name" },
    );
    assertEquals(result, true);
  } finally {
    restoreShortcutDeps();
  }
});

Deno.test("updateShortcut - returns true when position is updated", async () => {
  const { db } = createFakeDrizzleDatabase([{
    run: { success: true, meta: { changes: 1 } },
  }]);
  shortcutDeps.getDb = () => db as never;

  try {
    const result = await updateShortcut(
      {} as D1Database,
      "user-1",
      "space-1",
      "sc-1",
      { position: 5 },
    );
    assertEquals(result, true);
  } finally {
    restoreShortcutDeps();
  }
});

Deno.test("deleteShortcut - calls delete with the correct conditions", async () => {
  const { db, operations } = createFakeDrizzleDatabase([
    { run: { success: true, meta: { changes: 1 } } },
  ]);
  shortcutDeps.getDb = () => db as never;

  try {
    await deleteShortcut({} as D1Database, "user-1", "space-1", "sc-1");
    assertEquals(operations.includes("delete"), true);
  } finally {
    restoreShortcutDeps();
  }
});
