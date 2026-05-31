// deno-lint-ignore-file no-import-prefix no-unversioned-import no-explicit-any
//
// Phase 18.2 H11: tests for the server-side session blacklist (sessions_revoked
// table) and the rotation cadence helpers.
//
// The production code lives in:
//   - ../../../../application/services/identity/session-revocation.ts
//   - ../../../../application/services/identity/session.ts (rotation)
//
// We exercise both pure helpers (shouldRotateSession, SESSION_ROTATION_INTERVAL_MS)
// and the SQL-bound revocation API by stubbing prepare/bind/run + drizzle's
// select/from/where chain.

import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  cleanupExpiredSessionRevocations,
  isSessionRevoked,
  recordSessionRevocation,
} from "../../../../application/services/identity/session-revocation.ts";
import {
  SESSION_ROTATION_INTERVAL_MS,
  SESSION_TTL_MS,
  shouldRotateSession,
} from "../../../../application/services/identity/session.ts";
import type { Session } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "@/shared/types/bindings.ts";

// ---------------------------------------------------------------------------
// Mock plumbing
// ---------------------------------------------------------------------------

interface PreparedCall {
  sql: string;
  args: unknown[];
}

function createMockSqlDb(opts: {
  selectRow?: unknown;
  selectThrow?: boolean;
  prepareThrow?: boolean;
} = {}): { db: any; prepared: PreparedCall[] } {
  const prepared: PreparedCall[] = [];
  let lastSql = "";
  const db = {
    prepare(sql: string) {
      if (opts.prepareThrow) throw new Error("prepare failed");
      lastSql = sql;
      return {
        bind: (...args: unknown[]) => {
          prepared.push({ sql: lastSql, args });
          return {
            run: async () => ({ success: true }),
          };
        },
      };
    },
    // drizzle's select/from/where/.get() chain delegates to a SQL run we mock
    // by intercepting via the global `getDb` path. Tests below stub
    // `getDb` directly via the module exports; this is here only so attempts
    // to call db.select()/all() during a test would surface a clear error.
  };
  return { db, prepared };
}

// `getDb` (../../../../infra/db/client.ts) returns its argument
// unchanged when it already looks drizzle-like. We exploit that by passing
// a fake "drizzle-like" object directly as the SqlDatabaseBinding argument: it
// short-circuits `getDb` and routes select() to our chain stub.
function makeDrizzleLikeSqlDb(opts: {
  selectResult: unknown;
  selectThrow?: boolean;
}): any {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    get: async () => {
      if (opts.selectThrow) throw new Error("select failed");
      return opts.selectResult;
    },
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
  };
}

// ---------------------------------------------------------------------------
// Pure rotation helpers
// ---------------------------------------------------------------------------

Deno.test("shouldRotateSession - rotates when last_rotated_at exceeds the 1h interval", () => {
  const now = Date.now();
  const session = {
    id: "x".repeat(20),
    user_id: "user-1",
    expires_at: now + SESSION_TTL_MS,
    created_at: now - 2 * 60 * 60 * 1000,
    last_rotated_at: now - SESSION_ROTATION_INTERVAL_MS - 1,
  } as Session;
  assertEquals(shouldRotateSession(session, now), true);
});

Deno.test("shouldRotateSession - does not rotate when last_rotated_at is recent", () => {
  const now = Date.now();
  const session = {
    id: "x".repeat(20),
    user_id: "user-1",
    expires_at: now + SESSION_TTL_MS,
    created_at: now - 30 * 60 * 1000,
    last_rotated_at: now - 30 * 60 * 1000, // 30 min < 1h
  } as Session;
  assertEquals(shouldRotateSession(session, now), false);
});

Deno.test("shouldRotateSession - rotates sessions missing last_rotated_at after the interval", () => {
  const now = Date.now();
  const session = {
    id: "x".repeat(20),
    user_id: "user-1",
    expires_at: now + SESSION_TTL_MS,
    created_at: now - 2 * 60 * 60 * 1000, // 2h old
  } as Session;
  assertEquals(shouldRotateSession(session, now), true);
});

// ---------------------------------------------------------------------------
// recordSessionRevocation
// ---------------------------------------------------------------------------

Deno.test("recordSessionRevocation - issues an upsert with the provided fields", async () => {
  const { db, prepared } = createMockSqlDb();
  await recordSessionRevocation(db as SqlDatabaseBinding, {
    sessionId: "sess-abc",
    userId: "user-1",
    reason: "logout",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assertEquals(prepared.length, 1);
  const call = prepared[0]!;
  assert(call.sql.includes("INSERT INTO sessions_revoked"));
  assert(call.sql.includes("ON CONFLICT(session_id) DO UPDATE"));
  assertEquals(call.args[0], "sess-abc");
  assertEquals(call.args[1], "user-1");
  assertEquals(call.args[3], "logout");
  assertEquals(call.args[4], "2030-01-01T00:00:00.000Z");
});

Deno.test("recordSessionRevocation - defaults reason to 'logout' and tolerates absent userId/expiresAt", async () => {
  const { db, prepared } = createMockSqlDb();
  await recordSessionRevocation(db as SqlDatabaseBinding, {
    sessionId: "sess-no-meta",
  });
  const call = prepared[0]!;
  assertEquals(call.args[0], "sess-no-meta");
  assertEquals(call.args[1], null);
  assertEquals(call.args[3], "logout");
  assertEquals(call.args[4], null);
});

Deno.test("recordSessionRevocation - propagates SQL errors so callers can fall back", async () => {
  const { db } = createMockSqlDb({ prepareThrow: true });
  await assertRejects(
    () =>
      recordSessionRevocation(db as SqlDatabaseBinding, {
        sessionId: "sess-err",
      }),
    Error,
  );
});

// ---------------------------------------------------------------------------
// isSessionRevoked
// ---------------------------------------------------------------------------

Deno.test("isSessionRevoked - returns false when there is no matching row", async () => {
  const db = makeDrizzleLikeSqlDb({ selectResult: undefined });
  assertEquals(await isSessionRevoked(db, "sess-fresh"), false);
});

Deno.test("isSessionRevoked - returns true when a matching row exists", async () => {
  const db = makeDrizzleLikeSqlDb({ selectResult: { id: "sess-blacklisted" } });
  assertEquals(await isSessionRevoked(db, "sess-blacklisted"), true);
});

Deno.test("isSessionRevoked - fails closed (returns true) when the lookup throws", async () => {
  const db = makeDrizzleLikeSqlDb({
    selectResult: undefined,
    selectThrow: true,
  });
  // Fail-closed: prefer over-revocation to leaking access on lookup failure.
  assertEquals(await isSessionRevoked(db, "sess-error"), true);
});

Deno.test("isSessionRevoked - returns false for empty input without hitting the DB", async () => {
  // Pass a stub that would throw if its select were called: the empty-input
  // short-circuit must skip the lookup entirely.
  const exploding: any = {
    select: () => {
      throw new Error("select must not be called for empty input");
    },
    insert: () => ({}),
    update: () => ({}),
    delete: () => ({}),
  };
  assertEquals(await isSessionRevoked(exploding, ""), false);
});

// ---------------------------------------------------------------------------
// cleanupExpiredSessionRevocations
// ---------------------------------------------------------------------------

Deno.test("cleanupExpiredSessionRevocations - issues a DELETE bound to the supplied cutoff", async () => {
  const { db, prepared } = createMockSqlDb();
  const cutoff = new Date("2026-01-01T00:00:00.000Z");
  await cleanupExpiredSessionRevocations(db as SqlDatabaseBinding, cutoff);
  assertEquals(prepared.length, 1);
  const call = prepared[0]!;
  assert(call.sql.includes("DELETE FROM sessions_revoked"));
  assert(call.sql.includes("expires_at IS NOT NULL"));
  assertEquals(call.args[0], cutoff.toISOString());
});

Deno.test("cleanupExpiredSessionRevocations - swallows SQL errors so background jobs do not crash", async () => {
  const { db } = createMockSqlDb({ prepareThrow: true });
  // Should not throw despite the prepare error.
  await cleanupExpiredSessionRevocations(db as SqlDatabaseBinding);
});
