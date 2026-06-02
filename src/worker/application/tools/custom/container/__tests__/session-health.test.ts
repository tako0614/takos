import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { SqlDatabaseBinding } from "../../../../../shared/types/bindings.ts";
import { HEARTBEAT_TIMEOUT_MS } from "../../../../../shared/constants/index.ts";
import { checkSessionHealth } from "../session.ts";

/**
 * Regression guard for the heartbeat-liveness fix: `sessions.lastHeartbeat` has
 * no writer (interactive git-mode sessions do not post heartbeats), so a null
 * heartbeat must mean "liveness not tracked", NOT "dead". Before the fix, every
 * running session was reported dead ~30s after creation. A session is only dead
 * by heartbeat when a heartbeat was recorded and then went stale.
 */

type SessionRow = {
  id: string;
  status: string;
  lastHeartbeat: string | null;
  createdAt: string;
} | null;

function dbWithSession(row: SessionRow): SqlDatabaseBinding {
  const db = {
    select() {
      return {
        from() {
          return { where() { return { get: async () => row }; } };
        },
      };
    },
    insert() {
      return { values: () => ({ run: async () => ({}) }) };
    },
    update() {
      return { set: () => ({ where: async () => ({}) }) };
    },
    delete() {
      return { where: async () => ({}) };
    },
  };
  return db as unknown as SqlDatabaseBinding;
}

const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

test("running session with null heartbeat is healthy long past the startup grace", async () => {
  const health = await checkSessionHealth(
    dbWithSession({
      id: "s1",
      status: "running",
      lastHeartbeat: null,
      createdAt: HOUR_AGO,
    }),
    "s1",
  );
  assertEquals(health.isHealthy, true);
  assertEquals(health.reason, undefined);
});

test("running session with a recent recorded heartbeat is healthy", async () => {
  const health = await checkSessionHealth(
    dbWithSession({
      id: "s1",
      status: "running",
      lastHeartbeat: new Date().toISOString(),
      createdAt: HOUR_AGO,
    }),
    "s1",
  );
  assertEquals(health.isHealthy, true);
});

test("running session whose recorded heartbeat went stale is dead", async () => {
  const stale = new Date(Date.now() - (HEARTBEAT_TIMEOUT_MS + 60_000))
    .toISOString();
  const health = await checkSessionHealth(
    dbWithSession({
      id: "s1",
      status: "running",
      lastHeartbeat: stale,
      createdAt: HOUR_AGO,
    }),
    "s1",
  );
  assertEquals(health.isHealthy, false);
  assertEquals(health.reason, "session_dead");
});

test("non-running session is reported not running", async () => {
  const health = await checkSessionHealth(
    dbWithSession({
      id: "s1",
      status: "stopped",
      lastHeartbeat: null,
      createdAt: HOUR_AGO,
    }),
    "s1",
  );
  assertEquals(health.isHealthy, false);
  assertEquals(health.reason, "session_not_running");
});

test("missing session is reported not found", async () => {
  const health = await checkSessionHealth(dbWithSession(null), "missing");
  assertEquals(health.isHealthy, false);
  assertEquals(health.reason, "session_not_found");
});
