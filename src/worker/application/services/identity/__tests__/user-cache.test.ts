import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { getCachedUser, userCacheDeps } from "../user-cache.ts";
import type { User } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";

type AccountRow = {
  id: string;
  email: string | null;
  name: string;
  slug: string;
  status: string;
  bio: string | null;
  picture: string | null;
  trustTier: string;
  setupCompleted: boolean;
  createdAt: string;
  updatedAt: string;
};

function createDb(row: AccountRow | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => row,
        }),
      }),
    }),
  };
}

function createContext(row: AccountRow | null) {
  let user: User | undefined;
  return {
    context: {
      env: { DB: {} as SqlDatabaseBinding },
      get: () => user,
      set: (_key: "user", value: User) => {
        user = value;
      },
    },
    db: createDb(row),
    get cachedUser() {
      return user;
    },
  };
}

const originalDeps = { ...userCacheDeps };

function restoreDeps() {
  Object.assign(userCacheDeps, originalDeps);
}

test("getCachedUser rejects non-active account rows", async () => {
  const fixture = createContext({
    id: "user-1",
    email: "user@example.com",
    name: "User",
    slug: "user",
    status: "pending_deletion",
    bio: null,
    picture: null,
    trustTier: "normal",
    setupCompleted: true,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  userCacheDeps.getDb =
    (() => fixture.db) as unknown as typeof userCacheDeps.getDb;

  try {
    const result = await getCachedUser(fixture.context, "user-1");

    assertEquals(result, null);
    assertEquals(fixture.cachedUser, undefined);
  } finally {
    restoreDeps();
  }
});

test("getCachedUser returns active account rows", async () => {
  const fixture = createContext({
    id: "user-1",
    email: "user@example.com",
    name: "User",
    slug: "user",
    status: "active",
    bio: null,
    picture: null,
    trustTier: "normal",
    setupCompleted: true,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  userCacheDeps.getDb =
    (() => fixture.db) as unknown as typeof userCacheDeps.getDb;

  try {
    const result = await getCachedUser(fixture.context, "user-1");

    assertEquals(result?.id, "user-1");
    assertEquals(fixture.cachedUser?.id, "user-1");
  } finally {
    restoreDeps();
  }
});
