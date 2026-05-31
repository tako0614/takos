import { assertEquals } from "@std/assert";
import type { SqlDatabaseBinding } from "takos-api-contract/shared/types";
import { readRunAccess } from "./read-model.ts";

Deno.test("readRunAccess returns run detail when actor is a space member", async () => {
  const db = fakeRunDb({
    actorAccountId: "acct_1",
    membershipRole: "editor",
    runId: "run_1",
    spaceId: "space_1",
  });

  const result = await readRunAccess(db, "run_1", "acct_1");

  assertEquals(result?.role, "editor");
  assertEquals(result?.run.id, "run_1");
  assertEquals(result?.run.space_id, "space_1");
  assertEquals(result?.run.root_thread_id, "thread_1");
  assertEquals(result?.run.root_run_id, "run_1");
});

Deno.test("readRunAccess hides runs from non-members", async () => {
  const db = fakeRunDb({
    actorAccountId: "acct_1",
    membershipRole: null,
    runId: "run_1",
    spaceId: "space_1",
  });

  const result = await readRunAccess(db, "run_1", "acct_1");

  assertEquals(result, null);
});

function fakeRunDb(config: {
  actorAccountId: string;
  membershipRole: string | null;
  runId: string;
  spaceId: string;
}): SqlDatabaseBinding {
  return {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            first<T>() {
              if (query.includes("FROM runs")) {
                return Promise.resolve(
                  (values[0] === config.runId ? runRow(config) : null) as T,
                );
              }
              if (query.includes("FROM accounts")) {
                return Promise.resolve(
                  (
                    values[0] === config.actorAccountId
                      ? { id: config.actorAccountId }
                      : null
                  ) as T,
                );
              }
              if (query.includes("FROM account_memberships")) {
                return Promise.resolve(
                  (
                    values[0] === config.spaceId &&
                      values[1] === config.actorAccountId &&
                      config.membershipRole
                      ? { role: config.membershipRole }
                      : null
                  ) as T,
                );
              }
              return Promise.resolve(null as T);
            },
            run: unsupported,
            all: unsupported,
            raw: unsupported,
          };
        },
        first: unsupported,
        run: unsupported,
        all: unsupported,
        raw: unsupported,
      };
    },
    batch: unsupported,
    exec: unsupported,
    withSession() {
      throw new Error("unsupported");
    },
    dump: unsupported,
  } as unknown as SqlDatabaseBinding;
}

function runRow(config: {
  runId: string;
  spaceId: string;
}): Record<string, unknown> {
  return {
    id: config.runId,
    threadId: "thread_1",
    spaceId: config.spaceId,
    sessionId: null,
    parentRunId: null,
    childThreadId: null,
    rootThreadId: null,
    rootRunId: null,
    agentType: "default",
    status: "running",
    input: "{}",
    output: null,
    error: null,
    usage: "{}",
    serviceId: null,
    serviceHeartbeat: null,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-05-13T00:00:00.000Z",
  };
}

function unsupported(): never {
  throw new Error("unsupported");
}
