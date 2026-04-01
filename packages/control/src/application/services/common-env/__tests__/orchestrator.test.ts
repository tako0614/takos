import { CommonEnvOrchestrator } from "../orchestrator.ts";
import type { CommonEnvReconcileJobRow } from "../reconcile-jobs.ts";
import type { Env } from "../../../../shared/types/index.ts";

import { assert, assertEquals } from "jsr:@std/assert";

type QueryKind = "first" | "all" | "run" | "raw";

type PreparedStatementRecord = {
  sql: string;
  args: unknown[];
  methods: QueryKind[];
};

function createTracker<Args extends unknown[], Return>(
  impl: (...args: Args) => Return | Promise<Return>,
) {
  const calls: unknown[][] = [];
  const fn = (async (...args: Args) => {
    calls.push(args);
    return await impl(...args);
  }) as ((...args: Args) => Promise<Return>) & { calls: unknown[][] };
  fn.calls = calls;
  return fn;
}

function createFakeD1Database(
  onQuery: (
    call: { sql: string; args: unknown[]; method: QueryKind },
  ) => { rows?: unknown[][] } = () => ({ rows: [] }),
) {
  const prepared: PreparedStatementRecord[] = [];
  const db = {
    prepare(sql: string) {
      const record: PreparedStatementRecord = { sql, args: [], methods: [] };
      prepared.push(record);

      let statement: {
        bind(...values: unknown[]): typeof statement;
        first<T = Record<string, unknown>>(): Promise<T | null>;
        all<T = Record<string, unknown>>(): Promise<
          { results: T[]; success: true; meta: Record<string, unknown> }
        >;
        run<T = Record<string, unknown>>(): Promise<
          { results: T[]; success: true; meta: Record<string, unknown> }
        >;
        raw<T = unknown[]>(
          options?: { columnNames?: boolean },
        ): Promise<T[] | [string[], ...T[]]>;
      };

      statement = {
        bind(...values: unknown[]) {
          record.args = values;
          return statement;
        },
        async first<T = Record<string, unknown>>() {
          record.methods.push("first");
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "first",
          });
          return (rows?.[0] ?? null) as T | null;
        },
        async all<T = Record<string, unknown>>() {
          record.methods.push("all");
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "all",
          });
          return {
            results: (rows ?? []) as T[],
            success: true as const,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: 0,
              rows_written: 0,
              served_by: "test",
              size_after: 0,
            },
          };
        },
        async run<T = Record<string, unknown>>() {
          record.methods.push("run");
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "run",
          });
          return {
            results: (rows ?? []) as T[],
            success: true as const,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: 0,
              rows_written: 0,
              served_by: "test",
              size_after: 0,
            },
          };
        },
        async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
          record.methods.push("raw");
          if (options?.columnNames) {
            return [[]] as [string[], ...T[]];
          }
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "raw",
          });
          return (rows ?? []) as T[];
        },
      };

      return statement;
    },
    async batch<T = Record<string, unknown>>(
      statements: Array<
        {
          run(): Promise<
            { results: T[]; success: true; meta: Record<string, unknown> }
          >;
        }
      >,
    ) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    withSession() {
      return db;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as Env["DB"] & { prepared: PreparedStatementRecord[] };

  return { db, prepared };
}

function createJob(
  overrides: Partial<CommonEnvReconcileJobRow> = {},
): CommonEnvReconcileJobRow {
  return {
    id: "j-1",
    accountId: "space-1",
    serviceId: "w-1",
    workerId: "w-1",
    targetKeysJson: null,
    trigger: "workspace_env_put",
    status: "pending",
    attempts: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function createMockJobs(overrides: {
  recoveredStale?: number;
  runnableJobs?: CommonEnvReconcileJobRow[];
  markProcessing?: boolean;
  periodicSweep?: number;
} = {}) {
  const enqueue = createTracker(async () => "job-1");
  const enqueueService = createTracker(async () => "job-1");
  const enqueueForWorkers = createTracker(async () => undefined);
  const enqueueForServices = createTracker(async () => undefined);
  const recoverStaleProcessing = createTracker(async () =>
    overrides.recoveredStale ?? 0
  );
  const listRunnable = createTracker(async () => overrides.runnableJobs ?? []);
  const markProcessing = createTracker(async () =>
    overrides.markProcessing ?? true
  );
  const markCompleted = createTracker(async () => undefined);
  const markRetry = createTracker(async () => undefined);
  const enqueuePeriodicDriftSweep = createTracker(async () =>
    overrides.periodicSweep ?? 0
  );

  return {
    enqueue,
    enqueueService,
    enqueueForWorkers,
    enqueueForServices,
    listRunnable,
    markProcessing,
    markCompleted,
    markRetry,
    recoverStaleProcessing,
    enqueuePeriodicDriftSweep,
  } as any;
}

function createMockReconciler() {
  const reconcileServiceCommonEnv = createTracker(async () => undefined);
  const markServiceLinksApplyFailed = createTracker(async () => undefined);

  return {
    reconcileServiceCommonEnv,
    markServiceLinksApplyFailed,
  } as any;
}

Deno.test("CommonEnvOrchestrator - enqueueServiceReconcile - delegates to jobs.enqueueService", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs();
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.enqueueServiceReconcile({
    spaceId: "space-1",
    serviceId: "worker-1",
    targetKeys: ["MY_VAR"],
    trigger: "workspace_env_put",
  });

  assertEquals(jobs.enqueueService.calls.length, 1);
  assertEquals(jobs.enqueueService.calls[0][0], {
    spaceId: "space-1",
    serviceId: "worker-1",
    targetKeys: ["MY_VAR"],
    trigger: "workspace_env_put",
  });
});

Deno.test("CommonEnvOrchestrator - reconcileServicesForEnvKey - finds linked services and enqueues jobs for them", async () => {
  const { db, prepared } = createFakeD1Database(() => ({
    rows: [["w-1"], ["w-2"]],
  }));
  const env = { DB: db } as Pick<Env, "DB">;
  const jobs = createMockJobs();
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.reconcileServicesForEnvKey(
    "space-1",
    "my_var",
    "workspace_env_put",
  );

  assertEquals(prepared.length > 0, true);
  assert(prepared[0].sql.includes("service_common_env_links"));
  assert(prepared[0].args.includes("space-1"));
  assert(prepared[0].args.includes("MY_VAR"));
  assertEquals(jobs.enqueueForServices.calls.length, 1);
  assertEquals(jobs.enqueueForServices.calls[0][0], {
    spaceId: "space-1",
    serviceIds: ["w-1", "w-2"],
    targetKeys: ["MY_VAR"],
    trigger: "workspace_env_put",
  });
});

Deno.test("CommonEnvOrchestrator - reconcileServicesForEnvKey - uses default trigger when not specified", async () => {
  const env = {
    DB: createFakeD1Database(() => ({ rows: [["w-1"]] })).db,
  } as Pick<Env, "DB">;
  const jobs = createMockJobs();
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.reconcileServicesForEnvKey("space-1", "my_var");

  assertEquals(
    (jobs.enqueueForServices.calls[0][0] as { trigger: string }).trigger,
    "workspace_env_put",
  );
});

Deno.test("CommonEnvOrchestrator - reconcileServices - enqueues for specified services with normalized keys", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs();
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.reconcileServices({
    spaceId: "space-1",
    serviceIds: ["w-1", "w-2"],
    keys: ["my_var", "another_var"],
    trigger: "manual_links_set",
  });

  assertEquals(jobs.enqueueForServices.calls[0][0], {
    spaceId: "space-1",
    serviceIds: ["w-1", "w-2"],
    targetKeys: ["MY_VAR", "ANOTHER_VAR"],
    trigger: "manual_links_set",
  });
});

Deno.test("CommonEnvOrchestrator - reconcileServices - defaults trigger to bundle_required_links", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs();
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.reconcileServices({
    spaceId: "space-1",
    serviceIds: ["w-1"],
  });

  assertEquals(
    (jobs.enqueueForServices.calls[0][0] as { trigger: string }).trigger,
    "bundle_required_links",
  );
});

Deno.test("CommonEnvOrchestrator - reconcileServices - passes undefined targetKeys when keys not specified", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs();
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.reconcileServices({
    spaceId: "space-1",
    serviceIds: ["w-1"],
  });

  assertEquals(
    (jobs.enqueueForServices.calls[0][0] as { targetKeys?: string[] })
      .targetKeys,
    undefined,
  );
});

Deno.test("CommonEnvOrchestrator - processReconcileJobs - recovers stale and processes runnable jobs", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs({
    recoveredStale: 2,
    runnableJobs: [
      createJob({
        id: "j-1",
        accountId: "space-1",
        serviceId: "w-1",
        workerId: "w-1",
        targetKeysJson: null,
        trigger: "workspace_env_put",
        attempts: 0,
      }),
    ],
  });
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  const result = await orchestrator.processReconcileJobs(50);

  assertEquals(jobs.recoverStaleProcessing.calls[0][0], 50);
  assertEquals(jobs.markProcessing.calls[0][0], "j-1");
  assertEquals(reconciler.reconcileServiceCommonEnv.calls.length > 0, true);
  assertEquals(jobs.markCompleted.calls[0][0], "j-1");
  assertEquals(result, { processed: 3, completed: 1, retried: 2 });
});

Deno.test("CommonEnvOrchestrator - processReconcileJobs - marks retry on reconciler failure", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs({
    runnableJobs: [
      createJob({
        id: "j-1",
        accountId: "space-1",
        serviceId: "w-1",
        workerId: "w-1",
        targetKeysJson: null,
        trigger: "workspace_env_put",
        attempts: 1,
      }),
    ],
  });
  const reconciler = createMockReconciler();
  const error = new Error("reconcile failed");
  reconciler.reconcileServiceCommonEnv = createTracker(async () => {
    throw error;
  });
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  const result = await orchestrator.processReconcileJobs(50);

  assertEquals(reconciler.markServiceLinksApplyFailed.calls.length > 0, true);
  assertEquals(jobs.markRetry.calls[0], ["j-1", 1, error]);
  assertEquals(result.completed, 0);
  assertEquals(result.retried, 1);
});

Deno.test("CommonEnvOrchestrator - processReconcileJobs - skips jobs that fail to claim", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs({
    runnableJobs: [
      createJob({
        id: "j-1",
        accountId: "space-1",
        serviceId: "w-1",
        workerId: "w-1",
        targetKeysJson: null,
        trigger: "workspace_env_put",
        attempts: 0,
      }),
    ],
    markProcessing: false,
  });
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  const result = await orchestrator.processReconcileJobs(50);

  assertEquals(reconciler.reconcileServiceCommonEnv.calls.length, 0);
  assertEquals(result.completed, 0);
});

Deno.test("CommonEnvOrchestrator - processReconcileJobs - parses targetKeys from JSON", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs({
    runnableJobs: [
      createJob({
        id: "j-1",
        accountId: "space-1",
        serviceId: "w-1",
        workerId: "w-1",
        targetKeysJson: '["MY_VAR","ANOTHER"]',
        trigger: "workspace_env_put",
        attempts: 0,
      }),
    ],
  });
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  await orchestrator.processReconcileJobs(50);

  const payload = reconciler.reconcileServiceCommonEnv.calls[0][2] as {
    targetKeys?: Set<string>;
    trigger: string;
  };
  assertEquals(Array.from(payload.targetKeys ?? []), ["MY_VAR", "ANOTHER"]);
  assertEquals(payload.trigger, "workspace_env_put");
});

Deno.test("CommonEnvOrchestrator - enqueuePeriodicDriftSweep - recovers stale then enqueues drift sweep", async () => {
  const env = { DB: createFakeD1Database().db } as Pick<Env, "DB">;
  const jobs = createMockJobs({
    recoveredStale: 1,
    periodicSweep: 5,
  });
  const reconciler = createMockReconciler();
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  const result = await orchestrator.enqueuePeriodicDriftSweep(100);

  assertEquals(jobs.recoverStaleProcessing.calls[0][0], 100);
  assertEquals(jobs.enqueuePeriodicDriftSweep.calls[0][0], 100);
  assertEquals(result, 5);
});
