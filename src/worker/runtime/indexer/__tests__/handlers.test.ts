import { test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@takos/test/assert";
import {
  INDEX_QUEUE_MESSAGE_VERSION,
  indexJobDeliveryId,
} from "../../../shared/types/index.ts";

import {
  handleIndexJobDlq,
  handleInfoUnit,
  handleMemoryBuildPaths,
  handleRepoCodeIndex,
  handleThreadContext,
  handleVectorize,
} from "../handlers.ts";

type CapturedStatement = {
  sql: string;
  args: unknown[];
  bind(...args: unknown[]): CapturedStatement;
  first<T>(): Promise<T | null>;
};

function makeDb(
  runBatch: (statements: CapturedStatement[]) => Promise<unknown>,
) {
  return {
    prepare(sql: string): CapturedStatement {
      return {
        sql,
        args: [],
        bind(...args: unknown[]) {
          return { ...this, args };
        },
        async first<T>() {
          return null as T | null;
        },
      };
    },
    batch: runBatch,
  };
}

test("handleIndexJobDlq persists the actual queue name", async () => {
  let captured: CapturedStatement[] = [];
  await handleIndexJobDlq(
    { jobId: "job_1" },
    {
      DB: makeDb(async (statements) => {
        captured = statements;
      }),
    } as never,
    3,
    "takos-selfhost-index-jobs-dlq-staging",
  );

  assertEquals(captured.length, 1);
  assertEquals(captured[0].args[1], "takos-selfhost-index-jobs-dlq-staging");
  assertEquals(captured[0].args[4], 3);
  // A body that merely contains jobId is not a valid queue message and must
  // not be allowed to steer an index_jobs update.
  assertEquals(captured[0].sql.includes('UPDATE "index_jobs"'), false);
});

test("valid index DLQ body atomically records the ledger and fails the job", async () => {
  let captured: CapturedStatement[] = [];
  const body = {
    version: INDEX_QUEUE_MESSAGE_VERSION,
    jobId: "job_valid",
    deliveryId: indexJobDeliveryId("job_valid"),
    spaceId: "account-1",
    type: "info_unit" as const,
    targetId: "run-1",
    timestamp: Date.now(),
  };
  await handleIndexJobDlq(
    body,
    {
      DB: makeDb(async (statements) => {
        captured = statements;
      }),
    } as never,
    5,
  );

  assertEquals(captured.length, 2);
  assertEquals(captured[0].sql.includes('INSERT INTO "dlq_entries"'), true);
  assertEquals(captured[1].sql.includes('UPDATE "index_jobs"'), true);
  assertEquals(captured[1].args[2], body.jobId);
  assertEquals(captured[1].args[3], body.spaceId);
  assertEquals(captured[1].args[4], body.type);
  assertEquals(captured[1].sql.includes("'failed'"), true);
  assertEquals(captured[1].sql.includes("'completed'"), false);
  assertEquals(String(captured[1].args[0]).includes("after 5 attempts"), true);
});

test("Postgres index DLQ uses one dedicated transaction", async () => {
  let transactionCalls = 0;
  let outerBatchCalls = 0;
  let captured: CapturedStatement[] = [];
  const statementFactory = makeDb(async () => {
    outerBatchCalls++;
  });
  const db = {
    ...statementFactory,
    async withTransaction(
      callback: (tx: {
        prepare: typeof statementFactory.prepare;
        batch(statements: CapturedStatement[]): Promise<void>;
      }) => Promise<void>,
    ) {
      transactionCalls++;
      await callback({
        prepare: statementFactory.prepare,
        async batch(statements) {
          captured = statements;
        },
      });
    },
  };

  await handleIndexJobDlq(
    {
      version: INDEX_QUEUE_MESSAGE_VERSION,
      jobId: "job_postgres",
      deliveryId: indexJobDeliveryId("job_postgres"),
      spaceId: "account-1",
      type: "thread_context",
      targetId: "thread-1",
      timestamp: Date.now(),
    },
    { DB: db } as never,
    4,
  );

  assertEquals(transactionCalls, 1);
  assertEquals(outerBatchCalls, 0);
  assertEquals(captured.length, 2);
  assertEquals(captured[1].args[2], "job_postgres");
});

test("handleIndexJobDlq retries through caller when persistence fails", async () => {
  await assertRejects(
    () =>
      handleIndexJobDlq(
        { jobId: "job_1" },
        {
          DB: makeDb(async () => {
            throw new Error("db unavailable");
          }),
        } as never,
        2,
      ),
    Error,
    "db unavailable",
  );
});

test("missing targets and unavailable index backends return explicit failure outcomes", async () => {
  const emptyDb = makeDb(async () => {});
  assertEquals(
    await handleInfoUnit(
      { DB: emptyDb } as never,
      "job-info",
      "account-1",
      undefined,
    ),
    {
      processed: false,
      reason: "missing_info_unit_run_id",
      retryable: false,
    },
  );
  assertEquals(
    await handleThreadContext(
      { DB: emptyDb } as never,
      "job-thread",
      "account-1",
      undefined,
    ),
    {
      processed: false,
      reason: "missing_thread_context_thread_id",
      retryable: false,
    },
  );
  assertEquals(
    await handleRepoCodeIndex(
      { DB: emptyDb } as never,
      "job-repo",
      {
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: "job-repo",
        deliveryId: indexJobDeliveryId("job-repo"),
        spaceId: "account-1",
        type: "repo_code_index",
        timestamp: Date.now(),
      },
      undefined,
    ),
    {
      processed: false,
      reason: "missing_repo_code_index_target",
      retryable: false,
    },
  );
  assertEquals(
    await handleVectorize({ DB: emptyDb } as never, "job-vector", "account-1"),
    {
      processed: false,
      reason: "embeddings_service_unavailable",
      retryable: false,
    },
  );
});

type MemoryClaimRow = {
  id: string;
  account_id: string;
  claim_type: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  superseded_by: string | null;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryEdgeRow = {
  id: string;
  account_id: string;
  source_claim_id: string;
  target_claim_id: string;
  relation: string;
  weight: number;
  created_at: string;
};

function memoryClaimRow(
  id: string,
  overrides: Partial<MemoryClaimRow> = {},
): MemoryClaimRow {
  return {
    id,
    account_id: "acct-1",
    claim_type: "fact",
    subject: `subject-${id}`,
    predicate: "supports",
    object: `object-${id}`,
    confidence: 0.8,
    status: "active",
    superseded_by: null,
    source_run_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMemoryDb(input: {
  claims: MemoryClaimRow[];
  edges: MemoryEdgeRow[];
}) {
  const insertedPaths: Record<string, unknown>[] = [];
  let deleteCount = 0;

  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async all() {
          if (sql.includes("FROM memory_claims")) {
            const accountId = String(bound[0]);
            const sourceRunId = sql.includes("AND source_run_id = ?")
              ? String(bound[1])
              : null;
            const limit = Number(bound[sourceRunId ? 2 : 1]);
            const claims = input.claims
              .filter(
                (claim) =>
                  claim.account_id === accountId &&
                  claim.status === "active" &&
                  (!sourceRunId || claim.source_run_id === sourceRunId),
              )
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, limit);
            return { results: claims };
          }

          if (sql.includes("FROM memory_claim_edges")) {
            const accountId = String(bound[0]);
            const limit = Number(bound[1]);
            return {
              results: input.edges
                .filter((edge) => edge.account_id === accountId)
                .slice(0, limit),
            };
          }

          return { results: [] };
        },
        async run() {
          if (sql.includes("DELETE FROM memory_paths")) {
            deleteCount++;
          } else if (sql.includes("INSERT INTO memory_paths")) {
            insertedPaths.push({
              id: bound[0],
              account_id: bound[1],
              start_claim_id: bound[2],
              end_claim_id: bound[3],
              hop_count: bound[4],
              path_claims: JSON.parse(String(bound[5])),
              path_relations: JSON.parse(String(bound[6])),
              path_summary: bound[7],
              min_confidence: bound[8],
              created_at: bound[9],
            });
          }
          return { results: [] };
        },
        async first() {
          return null;
        },
        async raw() {
          return [];
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };

  return {
    db,
    insertedPaths,
    get deleteCount() {
      return deleteCount;
    },
  };
}

test("handleMemoryBuildPaths materializes direct and multi-hop memory paths", async () => {
  const memoryDb = makeMemoryDb({
    claims: [
      memoryClaimRow("c1", { confidence: 0.9 }),
      memoryClaimRow("c2", {
        confidence: 0.7,
        source_run_id: "run-1",
      }),
      memoryClaimRow("c3", { confidence: 0.6 }),
      memoryClaimRow("c4", { confidence: 0.95, status: "retracted" }),
    ],
    edges: [
      {
        id: "e1",
        account_id: "acct-1",
        source_claim_id: "c1",
        target_claim_id: "c2",
        relation: "supports",
        weight: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "e2",
        account_id: "acct-1",
        source_claim_id: "c2",
        target_claim_id: "c3",
        relation: "depends_on",
        weight: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "e3",
        account_id: "acct-1",
        source_claim_id: "c3",
        target_claim_id: "c4",
        relation: "related_to",
        weight: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  await handleMemoryBuildPaths(
    { DB: memoryDb.db } as never,
    "job-1",
    "acct-1",
    "run-1",
  );

  assertEquals(memoryDb.deleteCount, 1);
  assertEquals(memoryDb.insertedPaths.length, 3);

  const twoHopPath = memoryDb.insertedPaths.find(
    (path) => path.start_claim_id === "c1" && path.end_claim_id === "c3",
  );
  assert(twoHopPath);
  assertEquals(twoHopPath.hop_count, 2);
  assertEquals(twoHopPath.path_claims, ["c1", "c2", "c3"]);
  assertEquals(twoHopPath.path_relations, ["supports", "depends_on"]);
  assertEquals(twoHopPath.path_summary, "supports -> depends_on");
  assertEquals(twoHopPath.min_confidence, 0.6);
  assertEquals(
    memoryDb.insertedPaths.some((path) => path.end_claim_id === "c4"),
    false,
  );
});
