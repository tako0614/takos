import { Hono } from "hono";
import type { Env, Run, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assertEquals, assertObjectMatch } from "@std/assert";
import { runsRouteDeps } from "@/routes/runs/deps.ts";
import runs from "@/routes/runs/routes";

function createUser(id: string, username: string): User {
  return {
    id,
    email: `${username}@example.com`,
    name: username,
    username,
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-02-21T00:00:00.000Z",
    updated_at: "2026-02-21T00:00:00.000Z",
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  installAppErrorHandler(app);
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", runs);
  return app;
}

const env = createMockEnv();

Deno.test("run observation endpoints - derives run status from timeline for /events", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    Object.assign(runsRouteDeps, {
      checkRunAccess: () =>
        Promise.resolve({
          run: {
            id: "run-1",
            thread_id: "thread-1",
            space_id: "ws-1",
            session_id: null,
            parent_run_id: null,
            child_thread_id: null,
            root_thread_id: "thread-1",
            root_run_id: "run-1",
            agent_type: "default",
            status: "running",
            input: "{}",
            output: null,
            error: null,
            usage: "{}",
            worker_id: null,
            worker_heartbeat: null,
            started_at: null,
            completed_at: null,
            created_at: "2026-02-27T00:00:00.000Z",
          } as Run,
          role: "owner",
        }),
      loadRunObservation: () =>
        Promise.resolve({
          events: [
            {
              id: 10,
              event_id: "10",
              run_id: "run-1",
              type: "thinking",
              data: '{"message":"thinking"}',
              created_at: "2026-02-27T00:00:00.000Z",
            },
            {
              id: 11,
              event_id: "11",
              run_id: "run-1",
              type: "completed",
              data: '{"result":"ok"}',
              created_at: "2026-02-27T00:00:01.000Z",
            },
          ],
          runStatus: "completed" as Run["status"],
        }),
    });

    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request("https://takos.jp/api/runs/run-1/events?last_event_id=1"),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as {
      events: Array<
        {
          id: number;
          event_id: string;
          run_id: string;
          type: string;
          data: string;
          created_at: string;
        }
      >;
      run_status: Run["status"];
    };

    assertEquals(payload.run_status, "completed");
    assertEquals(payload.events.length, 2);
    assertObjectMatch(payload.events[0], {
      id: 10,
      event_id: "10",
      run_id: "run-1",
      type: "thinking",
      data: '{"message":"thinking"}',
    });
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});

Deno.test("run observation endpoints - uses after parameter equivalently on /replay", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    Object.assign(runsRouteDeps, {
      checkRunAccess: () =>
        Promise.resolve({
          run: {
            id: "run-1",
            thread_id: "thread-1",
            space_id: "ws-1",
            session_id: null,
            parent_run_id: null,
            child_thread_id: null,
            root_thread_id: "thread-1",
            root_run_id: "run-1",
            agent_type: "default",
            status: "running",
            input: "{}",
            output: null,
            error: null,
            usage: "{}",
            worker_id: null,
            worker_heartbeat: null,
            started_at: null,
            completed_at: null,
            created_at: "2026-02-27T00:00:00.000Z",
          } as Run,
          role: "owner",
        }),
      loadRunObservation: () =>
        Promise.resolve({
          events: [],
          runStatus: "completed" as Run["status"],
        }),
    });

    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request("https://takos.jp/api/runs/run-1/replay?after=1"),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as { run_status: Run["status"] };
    assertEquals(payload.run_status, "completed");
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});
