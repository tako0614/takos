import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals } from "jsr:@std/assert";

import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";
import { handleWorkflowJobDlq } from "../../../../../packages/control/src/runtime/queues/workflow-dlq.ts";
import type { WorkflowQueueEnv } from "../../../../../packages/control/src/runtime/queues/workflow-types.ts";

type QueryRow = unknown[] | null;

function validMessage(): WorkflowJobQueueMessage {
  return {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: "job",
    runId: "run-1",
    jobId: "job-1",
    repoId: "repo-1",
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    jobKey: "build",
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      steps: [{ run: "echo ok" }],
    },
    env: { CI: "true" },
    secretIds: [],
    timestamp: Date.now(),
  };
}

function createEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  const notifierFetch = async () => new Response(null, { status: 204 });

  return {
    DB: {} as D1Database,
    RUN_NOTIFIER: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: notifierFetch }),
    } as WorkflowQueueEnv["RUN_NOTIFIER"],
    GIT_OBJECTS: undefined,
    WORKFLOW_QUEUE: {
      send: async () => undefined,
    } as WorkflowQueueEnv["WORKFLOW_QUEUE"],
    ...overrides,
  } as WorkflowQueueEnv;
}

function createFakeD1(
  jobRow: QueryRow = null,
) {
  const prepareCalls: Array<{ sql: string; args: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      const normalized = sql.trim().toLowerCase();
      const row = normalized.startsWith("select") ? jobRow : null;

      return {
        bind(..._args: unknown[]) {
          prepareCalls.push({ sql, args: _args });

          return {
            get: async () => rowToObject(row),
            first: async () => rowToObject(row),
            all: async () => ({ results: row ? [rowToObject(row)] : [] }),
            raw: async () => (row ? [row] : []),
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls };
}

function createJobRow(
  overrides: Partial<{ status: string; name: string }> = {},
): unknown[] {
  return [overrides.status ?? "in_progress", overrides.name ?? "Build"];
}

function rowToObject(
  row: QueryRow,
): Record<string, unknown> | null {
  if (!row) return null;
  return {
    status: row[0],
    name: row[1],
  };
}

Deno.test("handleWorkflowJobDlq - skips invalid messages", async () => {
  const { db, prepareCalls } = createFakeD1();
  const env = createEnv({ DB: db });

  await handleWorkflowJobDlq({ invalid: true }, env, 3);

  assertEquals(prepareCalls.length, 0);
});

Deno.test("handleWorkflowJobDlq - skips already completed jobs", async () => {
  const { db, prepareCalls } = createFakeD1(
    createJobRow({ status: "completed" }),
  );
  const env = createEnv({ DB: db });

  await handleWorkflowJobDlq(validMessage(), env, 3);

  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "workflow_jobs"')
    ),
    false,
  );
});

Deno.test("handleWorkflowJobDlq - skips when the job record is missing", async () => {
  const { db, prepareCalls } = createFakeD1(null);
  const env = createEnv({ DB: db });

  await handleWorkflowJobDlq(validMessage(), env, 3);

  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "workflow_jobs"')
    ),
    false,
  );
});

Deno.test("handleWorkflowJobDlq - marks job and run as failed without a bucket", async () => {
  const { db, prepareCalls } = createFakeD1(createJobRow());
  const env = createEnv({ DB: db, GIT_OBJECTS: undefined });

  await handleWorkflowJobDlq(validMessage(), env, 5);

  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "workflow_jobs"')
    ),
    true,
  );
  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "workflow_runs"')
    ),
    true,
  );
});

// Round 11 workflow #12: When a job enters the DLQ, sibling jobs that are
// still `queued` / `in_progress` must be cancelled so the run's UI state
// stops showing phantom "running" jobs. The handler emits an
// `UPDATE workflow_jobs SET status = cancelled` statement with a sibling
// filter (`run_id = ? AND id != ? AND status IN ('queued','in_progress')`),
// plus a matching `UPDATE workflow_steps` cascade. We assert on the SQL
// shape because the fake D1 doesn't actually persist rows.
Deno.test("handleWorkflowJobDlq - cancels sibling jobs and pending steps when entering DLQ", async () => {
  const { db, prepareCalls } = createFakeD1(createJobRow());
  const env = createEnv({ DB: db, GIT_OBJECTS: undefined });

  await handleWorkflowJobDlq(validMessage(), env, 5);

  // Expect at least one UPDATE workflow_jobs statement that references
  // the 'cancelled' status. Drizzle serializes set values as bound params,
  // so we look for the keyword appearing either in the SQL or in bind args.
  const siblingJobUpdate = prepareCalls.find((call) => {
    const sql = call.sql.toLowerCase();
    if (!sql.includes('update "workflow_jobs"')) return false;
    const args = call.args.map((a) => String(a));
    return args.includes("cancelled");
  });
  assertEquals(
    siblingJobUpdate !== undefined,
    true,
    "expected UPDATE workflow_jobs ... set status = 'cancelled' for siblings",
  );

  const siblingStepUpdate = prepareCalls.find((call) => {
    const sql = call.sql.toLowerCase();
    if (!sql.includes('update "workflow_steps"')) return false;
    const args = call.args.map((a) => String(a));
    return args.includes("cancelled");
  });
  assertEquals(
    siblingStepUpdate !== undefined,
    true,
    "expected UPDATE workflow_steps ... set status = 'cancelled' for siblings",
  );
});
