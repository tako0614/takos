import { assert, assertEquals } from "@std/assert";

import { AgentMemoryRuntime } from "../memory-graph-runtime.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { AgentContext } from "../../agent/agent-models.ts";

// Minimal in-memory SqlDatabaseBinding stub that:
//  - records every SQL string passed to prepare()
//  - allows a failure to be injected on the Nth matching statement
//  - returns empty result sets for SELECTs so bootstrap returns EMPTY
function createRecordingDb(opts: {
  failOn?: { sqlIncludes: string; afterCalls: number };
} = {}): {
  db: SqlDatabaseBinding;
  log: string[];
} {
  const log: string[] = [];

  function makeStatement(sql: string): SqlPreparedStatementBinding {
    const stmt: SqlPreparedStatementBinding = {
      // deno-lint-ignore no-explicit-any
      bind(..._values: any[]): SqlPreparedStatementBinding {
        return stmt;
      },
      run() {
        log.push(sql);
        if (
          opts.failOn &&
          sql.includes(opts.failOn.sqlIncludes)
        ) {
          const matching = log.filter((s) =>
            s.includes(opts.failOn!.sqlIncludes)
          ).length;
          if (matching > opts.failOn.afterCalls) {
            return Promise.reject(new Error("simulated DB failure"));
          }
        }
        return Promise.resolve({ success: true, meta: {} } as never);
      },
      all() {
        log.push(sql);
        return Promise.resolve({ results: [], success: true } as never);
      },
      first() {
        log.push(sql);
        return Promise.resolve(null as never);
      },
      raw() {
        log.push(sql);
        return Promise.resolve([] as never);
      },
    } as unknown as SqlPreparedStatementBinding;
    return stmt;
  }

  const db = {
    prepare(sql: string): SqlPreparedStatementBinding {
      return makeStatement(sql);
    },
    batch() {
      return Promise.resolve([]);
    },
    exec() {
      return Promise.resolve({ count: 0, duration: 0 });
    },
    withSession() {
      throw new Error("not implemented in test");
    },
    dump() {
      return Promise.resolve(new ArrayBuffer(0));
    },
  } as unknown as SqlDatabaseBinding;

  return { db, log };
}

function createContext(): AgentContext {
  return {
    runId: "run-test",
    threadId: "thread-test",
    spaceId: "space-test",
    userId: "user-test",
  } as AgentContext;
}

function makeRememberArgs(content: string) {
  return {
    toolName: "remember",
    arguments: { content },
    result: "ok",
  } as never;
}

Deno.test(
  "memory-graph flushOverlay commits writes in a single transaction",
  async () => {
    const recording = createRecordingDb();
    const runtime = new AgentMemoryRuntime(
      recording.db,
      createContext(),
      {} as Env,
    );
    await runtime.bootstrap();
    const obs = runtime.createToolObserver();
    obs.observe(makeRememberArgs("alice likes coffee"));
    obs.observe(makeRememberArgs("bob prefers tea"));

    await runtime.finalize();

    const beginIdx = recording.log.findIndex((s) => s === "BEGIN IMMEDIATE");
    const commitIdx = recording.log.findIndex((s) => s === "COMMIT");
    assert(beginIdx >= 0, "BEGIN IMMEDIATE not issued");
    assert(commitIdx > beginIdx, "COMMIT not issued after BEGIN");

    const writes = recording.log.slice(beginIdx + 1, commitIdx);
    const writeCount =
      writes.filter((s) =>
        s.includes("INSERT INTO memory_claims") ||
        s.includes("INSERT INTO memory_evidence")
      ).length;
    assert(writeCount >= 4, `expected >=4 writes inside tx, got ${writeCount}`);
  },
);

Deno.test(
  "memory-graph flushOverlay rolls back and leaves overlay intact on failure",
  async () => {
    // Fail on the SECOND insertEvidence call so we know we're mid-loop.
    const recording = createRecordingDb({
      failOn: { sqlIncludes: "INSERT INTO memory_evidence", afterCalls: 1 },
    });
    const runtime = new AgentMemoryRuntime(
      recording.db,
      createContext(),
      {} as Env,
    );
    await runtime.bootstrap();
    const obs = runtime.createToolObserver();
    obs.observe(makeRememberArgs("alice likes coffee"));
    obs.observe(makeRememberArgs("bob prefers tea"));

    // finalize() catches its own error and logs a warning, so it resolves.
    await runtime.finalize();

    assert(
      recording.log.includes("ROLLBACK"),
      `expected ROLLBACK in log, got: ${recording.log.join(" | ")}`,
    );
    const begins = recording.log.filter((s) => s === "BEGIN IMMEDIATE").length;
    const commits = recording.log.filter((s) => s === "COMMIT").length;
    assertEquals(begins, 1);
    assertEquals(commits, 0);

    // Overlay must NOT be cleared, so the same claims survive in memory for
    // the caller / retry to handle.
    assert(obs.getOverlayClaims().length >= 2);
    assert(obs.getOverlayEvidence().length >= 2);
  },
);
