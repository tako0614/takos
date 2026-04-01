import type { Env } from "@/types";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  getThreadTimeline,
  threadTimelineDeps,
} from "@/services/threads/thread-timeline";

function makeRun(overrides: Partial<{
  id: string;
  status: string;
  session_id: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "run-1",
    thread_id: "thread-1",
    space_id: "ws-1",
    session_id: overrides.session_id ?? null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: "thread-1",
    root_run_id: "run-1",
    agent_type: "default",
    status: overrides.status ?? "completed",
    input: "{}",
    output: null,
    error: null,
    usage: "{}",
    worker_id: null,
    worker_heartbeat: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-03-01T00:00:00.000Z",
  };
}

function makeEnv(): Env {
  return { DB: {} } as Env;
}

function makeDrizzleMock(sessionRow?: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.get = async () => sessionRow ?? null;
  return {
    select: () => chain,
  };
}

function withTimelineDeps<T>(
  overrides: Record<string, unknown>,
  fn: () => Promise<T>,
) {
  const previous = { ...threadTimelineDeps };
  Object.assign(threadTimelineDeps, overrides);
  return fn().finally(() => {
    Object.assign(threadTimelineDeps, previous);
  });
}

Deno.test("getThreadTimeline returns messages, total, and no active run or pending session diff", async () => {
  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [
          {
            id: "msg-1",
            thread_id: "thread-1",
            role: "user",
            content: "hi",
            sequence: 0,
            created_at: "2026-03-01",
          },
        ],
        total: 1,
        runs: [makeRun({ status: "completed" })],
      }),
      getDb: () => makeDrizzleMock() as never,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertEquals(result.total, 1);
      assertEquals(result.limit, 100);
      assertEquals(result.offset, 0);
      assertEquals(result.activeRun, null);
      assertEquals(result.pendingSessionDiff, null);
      assertEquals(result.messages[0].content, "hi");
    },
  );
});

Deno.test("getThreadTimeline identifies a queued run as active", async () => {
  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [makeRun({ id: "run-active", status: "queued" })],
      }),
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertNotEquals(result.activeRun, null);
      assertEquals(result.activeRun!.id, "run-active");
      assertEquals(result.pendingSessionDiff, null);
    },
  );
});

Deno.test("getThreadTimeline returns a pending session diff for an active session", async () => {
  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({
            id: "run-1",
            status: "completed",
            session_id: "session-1",
          }),
        ],
      }),
      getDb: () =>
        makeDrizzleMock({
          id: "session-1",
          status: "active",
          repoId: "repo-1",
          branch: "main",
        }) as never,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertEquals(result.activeRun, null);
      assertEquals(result.pendingSessionDiff, {
        sessionId: "session-1",
        sessionStatus: "active",
        git_mode: true,
      });
    },
  );
});

Deno.test("getThreadTimeline sets git_mode to false when a session has no repoId", async () => {
  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({
            id: "run-1",
            status: "completed",
            session_id: "session-1",
          }),
        ],
      }),
      getDb: () =>
        makeDrizzleMock({
          id: "session-1",
          status: "active",
          repoId: null,
          branch: null,
        }) as never,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertNotEquals(result.pendingSessionDiff, null);
      assertEquals(result.pendingSessionDiff!.git_mode, false);
    },
  );
});

Deno.test("getThreadTimeline skips discarded sessions", async () => {
  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({
            id: "run-1",
            status: "completed",
            session_id: "session-1",
          }),
        ],
      }),
      getDb: () =>
        makeDrizzleMock({
          id: "session-1",
          status: "discarded",
          repoId: "repo-1",
          branch: "main",
        }) as never,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertEquals(result.pendingSessionDiff, null);
    },
  );
});

Deno.test("getThreadTimeline does not check sessions when a run is active", async () => {
  const getDbSpy = spy(() => makeDrizzleMock() as never);

  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({
            id: "run-running",
            status: "running",
            session_id: "session-1",
          }),
          makeRun({
            id: "run-completed",
            status: "completed",
            session_id: "session-2",
          }),
        ],
      }),
      getDb: getDbSpy,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertNotEquals(result.activeRun, null);
      assertEquals(result.pendingSessionDiff, null);
      assertSpyCalls(getDbSpy, 0);
    },
  );
});

Deno.test("getThreadTimeline skips session lookup for invalid session ids", async () => {
  const getDbSpy = spy(() => makeDrizzleMock() as never);

  await withTimelineDeps(
    {
      isValidOpaqueId: () => false,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({
            id: "run-1",
            status: "completed",
            session_id: "invalid!!",
          }),
        ],
      }),
      getDb: getDbSpy,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertEquals(result.pendingSessionDiff, null);
      assertSpyCalls(getDbSpy, 0);
    },
  );
});

Deno.test("getThreadTimeline handles session lookup errors gracefully", async () => {
  const logErrorSpy = spy(() => undefined);

  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({
            id: "run-1",
            status: "completed",
            session_id: "session-1",
          }),
        ],
      }),
      getDb: () =>
        ({
          select: () => ({
            from: () => ({
              where: () => ({
                get: async () => {
                  throw new Error("DB error");
                },
              }),
            }),
          }),
        }) as never,
      logError: logErrorSpy,
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertEquals(result.pendingSessionDiff, null);
      assert(logErrorSpy.calls.length > 0);
    },
  );
});

Deno.test("getThreadTimeline returns no pending session diff when no completed run has a session", async () => {
  await withTimelineDeps(
    {
      isValidOpaqueId: () => true,
      listThreadMessages: async () => ({
        messages: [],
        total: 0,
        runs: [
          makeRun({ id: "run-1", status: "completed", session_id: null }),
          makeRun({ id: "run-2", status: "failed", session_id: "session-1" }),
        ],
      }),
    },
    async () => {
      const result = await getThreadTimeline(makeEnv(), "thread-1", 100, 0);

      assertEquals(result.pendingSessionDiff, null);
    },
  );
});
