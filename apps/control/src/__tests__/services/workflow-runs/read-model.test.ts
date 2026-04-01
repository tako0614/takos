import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

import {
  getWorkflowRunDetail,
  getWorkflowRunJobs,
  listWorkflowRuns,
  workflowRunReadModelDeps,
} from "@/services/workflow-runs/read-model";

function buildDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  return {
    select: () => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.leftJoin = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.offset = () => chain;
      chain.get = async () =>
        Array.isArray(result) ? result[0] ?? null : result;
      chain.all = async () => Array.isArray(result) ? result : [];
      return chain;
    },
  };
}

function makeWorkflowRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workflowPath: ".takos/workflows/ci.yml",
    event: "push",
    ref: "refs/heads/main",
    sha: "sha-abc123",
    status: "completed",
    conclusion: "success",
    runNumber: 1,
    runAttempt: 1,
    inputs: null,
    queuedAt: "2026-03-01T00:00:00.000Z",
    startedAt: "2026-03-01T00:01:00.000Z",
    completedAt: "2026-03-01T00:05:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    actorAccountId: "user-1",
    actorName: "Test User",
    actorPicture: "https://example.com/avatar.png",
    actorId: "user-1",
    ...overrides,
  };
}

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    name: "build",
    status: "completed",
    conclusion: "success",
    runnerName: "runner-1",
    startedAt: "2026-03-01T00:01:00.000Z",
    completedAt: "2026-03-01T00:04:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStepRow(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    name: "Checkout",
    status: "completed",
    conclusion: "success",
    startedAt: "2026-03-01T00:01:00.000Z",
    completedAt: "2026-03-01T00:01:30.000Z",
    ...overrides,
  };
}

function withReadModelDb<T>(drizzle: unknown, fn: () => Promise<T>) {
  const previous = workflowRunReadModelDeps.getDb;
  workflowRunReadModelDeps.getDb = () => drizzle as never;
  return fn().finally(() => {
    workflowRunReadModelDeps.getDb = previous;
  });
}

Deno.test("listWorkflowRuns maps rows and reports has_more=false", async () => {
  const drizzle = buildDrizzleMock([[
    makeWorkflowRunRow(),
  ]]);

  await withReadModelDb(drizzle, async () => {
    const result = await listWorkflowRuns({} as D1Database, {
      repoId: "repo-1",
      limit: 10,
      offset: 0,
    });

    assertEquals(result.runs.length, 1);
    assertEquals(result.has_more, false);
    assertEquals(result.runs[0].id, "run-1");
    assertEquals(result.runs[0].actor, {
      id: "user-1",
      name: "Test User",
      avatar_url: "https://example.com/avatar.png",
    });
  });
});

Deno.test("listWorkflowRuns reports has_more=true when an extra row exists", async () => {
  const drizzle = buildDrizzleMock([
    Array.from(
      { length: 4 },
      (_, index) => makeWorkflowRunRow({ id: `run-${index}` }),
    ),
  ]);

  await withReadModelDb(drizzle, async () => {
    const result = await listWorkflowRuns({} as D1Database, {
      repoId: "repo-1",
      limit: 3,
      offset: 0,
    });

    assertEquals(result.has_more, true);
    assertEquals(result.runs.length, 3);
  });
});

Deno.test("getWorkflowRunDetail returns null when run not found", async () => {
  const drizzle = buildDrizzleMock([null]);

  await withReadModelDb(drizzle, async () => {
    const result = await getWorkflowRunDetail(
      {} as D1Database,
      "repo-1",
      "missing",
    );

    assertEquals(result, null);
  });
});

Deno.test("getWorkflowRunDetail maps jobs and steps", async () => {
  const drizzle = buildDrizzleMock([
    makeWorkflowRunRow({ inputs: '{"key":"value"}' }),
    [makeJobRow()],
    [makeStepRow(), makeStepRow({ number: 2, name: "Build" })],
  ]);

  await withReadModelDb(drizzle, async () => {
    const result = await getWorkflowRunDetail(
      {} as D1Database,
      "repo-1",
      "run-1",
    );

    assertNotEquals(result, null);
    assertEquals(result!.run.inputs, { key: "value" });
    assertEquals(result!.run.jobs.length, 1);
    assertEquals(result!.run.jobs[0].steps.length, 2);
    assertEquals(result!.run.jobs[0].steps[1].name, "Build");
  });
});

Deno.test("getWorkflowRunJobs returns empty array when a run has no jobs", async () => {
  const drizzle = buildDrizzleMock([
    { id: "run-1" },
    [],
  ]);

  await withReadModelDb(drizzle, async () => {
    const result = await getWorkflowRunJobs(
      {} as D1Database,
      "repo-1",
      "run-1",
    );

    assertNotEquals(result, null);
    assertEquals(result!.jobs.length, 0);
  });
});
