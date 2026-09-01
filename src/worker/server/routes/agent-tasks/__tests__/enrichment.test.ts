import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type {
  AgentTaskBase,
  Env,
} from "../../../../shared/types/index.ts";
import { claimAgentTaskStart, enrichTasks } from "../handlers.ts";

const NOW = "2026-08-09T00:00:00.000Z";

function task(index: number): AgentTaskBase {
  return {
    id: `task_${index}`,
    space_id: "space_a",
    created_by: "user_a",
    thread_id: `thread_${index}`,
    last_run_id: null,
    title: `Task ${index}`,
    description: null,
    status: "planned",
    priority: "medium",
    agent_type: "default",
    model: null,
    plan: null,
    due_at: null,
    started_at: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

test("agent task enrichment stays within D1 limits and follows child runs", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      root_thread_id TEXT,
      status TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL
    );
  `);

  await client.batch(
    Array.from({ length: 125 }, (_, index) => [
      {
        sql: "INSERT INTO threads (id, title) VALUES (?, ?)",
        args: [`thread_${index}`, `Thread ${index}`],
      },
      {
        sql: `INSERT INTO runs
          (id, thread_id, root_thread_id, status, agent_type, created_at)
          VALUES (?, ?, ?, 'completed', 'default', ?)`,
        args: [`run_${index}`, `thread_${index}`, `thread_${index}`, NOW],
      },
    ]).flat(),
  );
  await client.batch([
    {
      sql: "INSERT INTO threads (id, title) VALUES ('child_thread', 'Child')",
      args: [],
    },
    {
      sql: `INSERT INTO runs
        (id, thread_id, root_thread_id, status, agent_type, created_at)
        VALUES ('child_run', 'child_thread', 'thread_0', 'running', 'researcher', ?)`,
      args: ["2026-08-09T00:00:01.000Z"],
    },
    {
      sql: "INSERT INTO artifacts (id, run_id) VALUES ('artifact_1', 'child_run')",
      args: [],
    },
  ]);

  const parameterCounts: number[] = [];
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery(_query, params) {
        parameterCounts.push(params.length);
        if (params.length > 100) {
          throw new Error("D1 maximum bound parameters exceeded");
        }
      },
    },
  });

  try {
    const results = await enrichTasks(
      { DB: db } as unknown as Env,
      Array.from({ length: 125 }, (_, index) => task(index)),
    );

    expect(results).toHaveLength(125);
    expect(Math.max(...parameterCounts)).toBeLessThanOrEqual(100);
    expect(results[0]).toMatchObject({
      thread_title: "Thread 0",
      latest_run: {
        run_id: "child_run",
        status: "running",
        agent_type: "researcher",
        artifact_count: 1,
      },
      resume_target: {
        thread_id: "thread_0",
        run_id: "child_run",
        reason: "active",
      },
    });
  } finally {
    client.close();
  }
});

test("agent task start claim permits only one concurrent row version", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE agent_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO agent_tasks (id, status, updated_at)
      VALUES ('task_claim', 'planned', '${NOW}');
  `);
  const parameterCounts: number[] = [];
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery(_query, params) {
        parameterCounts.push(params.length);
      },
    },
  });
  try {
    const input = {
      taskId: "task_claim",
      expectedUpdatedAt: NOW,
      startedAt: "2026-08-09T00:00:01.000Z",
      updatedAt: "2026-08-09T00:00:01.000Z",
    };
    const [first, second] = await Promise.all([
      claimAgentTaskStart(db as unknown as Env["DB"], input),
      claimAgentTaskStart(db as unknown as Env["DB"], input),
    ]);
    expect([first, second].sort()).toEqual([false, true]);
    expect(Math.max(...parameterCounts)).toBeLessThanOrEqual(100);
  } finally {
    client.close();
  }
});
