import type { D1Database } from "@cloudflare/workers-types";

import { assertRejects } from "jsr:@std/assert";

import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";
import { handleWorkflowJob } from "@/queues/workflow-job-handler";
import type { WorkflowQueueEnv } from "@/queues/workflow-types";

type QueryRow = Record<string, unknown> | null;

function createWorkflowMessage(
  overrides: Partial<WorkflowJobQueueMessage> = {},
): WorkflowJobQueueMessage {
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
    ...overrides,
  };
}

function createRunNotifier() {
  const fetch = async () => new Response(null, { status: 204 });

  return {
    idFromName: (name: string) => name,
    get: () => ({ fetch }),
  } as WorkflowQueueEnv["RUN_NOTIFIER"];
}

function createFakeD1(
  selectRows: QueryRow[] = [],
  runChanges: number[] = [],
) {
  const pendingSelectRows = [...selectRows];
  const pendingRunChanges = [...runChanges];
  const queries: string[] = [];

  return {
    queries,
    db: {
      prepare(sql: string) {
        queries.push(sql);
        const normalized = sql.trim().toLowerCase();
        const row = normalized.startsWith("select")
          ? pendingSelectRows.shift() ?? null
          : null;

        return {
          bind(..._args: unknown[]) {
            return {
              raw: async () => (row ? [Object.values(row)] : []),
              first: async () => row,
              all: async () => ({ results: row ? [row] : [] }),
              run: async () => ({
                success: true,
                meta: { changes: pendingRunChanges.shift() ?? 1 },
              }),
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

function createEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  return {
    DB: {} as D1Database,
    GIT_OBJECTS: {} as WorkflowQueueEnv["GIT_OBJECTS"],
    RUN_NOTIFIER: createRunNotifier(),
    WORKFLOW_QUEUE: {
      send: async () => undefined,
    } as WorkflowQueueEnv["WORKFLOW_QUEUE"],
    ...overrides,
  } as WorkflowQueueEnv;
}

Deno.test("handleWorkflowJob - throws when GIT_OBJECTS is not configured", async () => {
  await assertRejects(
    () =>
      handleWorkflowJob(
        createWorkflowMessage(),
        createEnv({ GIT_OBJECTS: undefined }),
      ),
    Error,
    "Git storage not configured",
  );
});

Deno.test("handleWorkflowJob - exits cleanly when run or job records are missing", async () => {
  const { db } = createFakeD1([null, null]);

  await handleWorkflowJob(
    createWorkflowMessage(),
    createEnv({ DB: db }),
  );
});

Deno.test("handleWorkflowJob - marks a queued job as skipped when the run is already completed", async () => {
  const { db, queries } = createFakeD1([
    { status: "completed" },
    { status: "queued" },
  ]);

  await handleWorkflowJob(
    createWorkflowMessage(),
    createEnv({ DB: db }),
  );

  if (
    !queries.some((query) =>
      query.toLowerCase().includes('update "workflow_jobs"')
    )
  ) {
    throw new Error("expected workflow_jobs update");
  }
  if (
    !queries.some((query) =>
      query.toLowerCase().includes('update "workflow_steps"')
    )
  ) {
    throw new Error("expected workflow_steps update");
  }
});

Deno.test("handleWorkflowJob - exits when the optimistic claim already failed", async () => {
  const { db, queries } = createFakeD1([
    { status: "running" },
    { status: "queued" },
  ], [0]);

  await handleWorkflowJob(
    createWorkflowMessage(),
    createEnv({ DB: db }),
  );

  if (
    !queries.some((query) =>
      query.toLowerCase().includes('update "workflow_jobs"')
    )
  ) {
    throw new Error("expected workflow_jobs claim update");
  }
});
