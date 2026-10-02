import { expect, jest, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../infra/db/schema.ts";
import type { Database } from "../../../infra/db/client.ts";
import type { RunnerEnv } from "../../../shared/types/index.ts";
import type { RunUsageProjectionWitness } from "./run-projection-outbox.ts";
import {
  dispatchRunUsageProjectionOutbox,
  runUsageProjectionOutboxId,
} from "./run-projection-outbox.ts";

const ISSUER = "https://issuer.example";
const SUBJECT = "operator-owner";
const OWNER = `${ISSUER}#${SUBJECT}`;
const NOW = "2026-10-01T12:00:00.000Z";
const MIGRATION = new URL(
  "../../../../../db/migrations-control/migrations/0110_run_usage_projection_outbox.sql",
  import.meta.url,
);

type Row = {
  id: string;
  run_id: string;
  completion_key: string;
  run_status: string;
  workspace_id: string;
  owner_account_id: string;
  delivery_status: string;
  claim_token: string | null;
  claimed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  projected_revision: number | null;
};

type StubReply = (witness: RunUsageProjectionWitness, request: Request) => Promise<Response>;

async function fixture(options: { reply?: StubReply } = {}) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      owner_account_id TEXT
    );
    CREATE TABLE auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_sub TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      requester_account_id TEXT,
      status TEXT NOT NULL,
      completion_key TEXT
    );
  `);
  // Keep this fixture tied to the checked-in migration DDL and its real indexes/FK.
  await client.executeMultiple(await Bun.file(MIGRATION).text());
  const db = drizzle(client, { schema }) as unknown as Database;
  const captures: Array<{
    witness: RunUsageProjectionWitness;
    request: Request;
    claim: { deliveryStatus: string; claimToken: string | null; claimedAt: string | null; attempts: number };
  }> = [];
  let reply = options.reply ?? (async (witness) => Response.json({
    success: true, runId: witness.runId, revision: 1,
  }));
  const env = {
    DB: db,
    OIDC_ISSUER_URL: ISSUER,
    OIDC_OWNER_SUBJECT: SUBJECT,
    RUN_NOTIFIER: {
      idFromName(name: string) { return name; },
      get(_id: unknown) {
        return {
          async fetch(request: Request) {
            const body = await request.clone().json() as { witness: RunUsageProjectionWitness };
            const witness = structuredClone(body.witness);
            const claimResult = await client.execute({
              sql: "SELECT delivery_status, claim_token, claimed_at, attempts FROM run_usage_projection_outbox WHERE id = ?",
              args: [witness.id],
            });
            const claim = claimResult.rows[0] as unknown as {
              delivery_status: string; claim_token: string | null; claimed_at: string | null; attempts: number;
            };
            captures.push({ witness, request: request.clone(), claim: {
              deliveryStatus: claim.delivery_status, claimToken: claim.claim_token,
              claimedAt: claim.claimed_at, attempts: claim.attempts,
            } });
            return reply(witness, request);
          },
        };
      },
    },
  } as unknown as RunnerEnv;
  await client.execute({
    sql: "INSERT INTO accounts (id, status) VALUES (?, 'active')",
    args: ["owner-1"],
  });
  await client.execute({
    sql: "INSERT INTO auth_identities (id, user_id, provider, provider_sub, linked_at, last_login_at) VALUES (?, ?, 'oidc', ?, ?, ?)",
    args: ["identity-1", "owner-1", OWNER, NOW, NOW],
  });

  const addWorkspace = async (workspaceId: string, ownerAccountId = "owner-1") => {
    await client.execute({
      sql: "INSERT INTO accounts (id, status, owner_account_id) VALUES (?, 'active', ?) ON CONFLICT (id) DO NOTHING",
      args: [workspaceId, ownerAccountId],
    });
  };
  const addRun = async (input: {
    runId?: string;
    completionKey?: string;
    workspaceId?: string;
    status?: string;
    requesterId?: string | null;
    deliveryStatus?: string;
    claimedAt?: string | null;
    nextAttemptAt?: string | null;
  } = {}) => {
    const runId = input.runId ?? "run-1";
    const completionKey = input.completionKey ?? `completion-${runId}`;
    const workspaceId = input.workspaceId ?? "workspace-1";
    const status = input.status ?? "completed";
    await addWorkspace(workspaceId);
    await client.execute({
      sql: "INSERT INTO runs (id, account_id, requester_account_id, status, completion_key) VALUES (?, ?, ?, ?, ?)",
      args: [runId, workspaceId, input.requesterId ?? null, status, completionKey],
    });
    await client.execute({
      sql: `INSERT INTO run_usage_projection_outbox
        (id, run_id, completion_key, run_status, workspace_id, owner_account_id,
         delivery_status, attempts, claimed_at, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'owner-1', ?, 0, ?, ?, ?, ?)`,
      args: [runUsageProjectionOutboxId(completionKey), runId, completionKey, status,
        workspaceId, input.deliveryStatus ?? "queued", input.claimedAt ?? null,
        input.nextAttemptAt ?? null, NOW, NOW],
    });
    return { id: runUsageProjectionOutboxId(completionKey), runId, completionKey, workspaceId, status };
  };
  const read = async (id: string): Promise<Row> => {
    const result = await client.execute({
      sql: "SELECT * FROM run_usage_projection_outbox WHERE id = ?",
      args: [id],
    });
    return result.rows[0] as unknown as Row;
  };
  const setReply = (next: StubReply) => { reply = next; };
  const close = () => client.close();
  return { client, db, env, captures, addWorkspace, addRun, read, setReply, close };
}

type SeededRun = { id: string; runId: string; completionKey: string; workspaceId: string; status: string };

function witnessFor(run: SeededRun): RunUsageProjectionWitness {
  return {
    id: run.id, runId: run.runId, completionKey: run.completionKey,
    runStatus: run.status, workspaceId: run.workspaceId, ownerAccountId: "owner-1",
  };
}

test("dispatches a due SQL witness and records only a valid durable acknowledgement", async () => {
  const f = await fixture();
  try {
    const run = await f.addRun();
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(1);
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0]?.witness).toEqual(witnessFor(run));
    expect(f.captures[0]?.request.url).toBe("http://internal/usage-project?runId=run-1");
    expect(f.captures[0]?.claim).toMatchObject({
      deliveryStatus: "dispatching", attempts: 1,
    });
    expect(f.captures[0]?.claim.claimToken).toBeString();
    expect(f.captures[0]?.claim.claimedAt).toBeString();
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "done", attempts: 1, claim_token: null, claimed_at: null,
      projected_revision: 1, next_attempt_at: null, last_error: null,
    });
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
    expect(f.captures).toHaveLength(1);
  } finally { f.close(); }
});

test("skips not-yet-due rows and honors the bounded dispatch limit", async () => {
  const f = await fixture();
  try {
    const first = await f.addRun({ runId: "due-1" });
    const second = await f.addRun({ runId: "due-2" });
    const later = await f.addRun({ runId: "future", nextAttemptAt: "2026-10-02T00:00:00.000Z" });
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW, limit: 1 })).toBe(1);
    expect(f.captures).toHaveLength(1);
    expect([first.runId, second.runId]).toContain(f.captures[0]?.witness.runId);
    expect((await f.read(first.id)).delivery_status === "done" ||
      (await f.read(second.id)).delivery_status === "done").toBe(true);
    expect(await f.read(later.id)).toMatchObject({ delivery_status: "queued", attempts: 0 });
  } finally { f.close(); }
});

for (const failure of ["non-2xx response", "fetch failure"] as const) {
  test(`requeues a ${failure} with bounded backoff and the exact SQL claim`, async () => {
    const f = await fixture({ reply: async (_witness) => {
      if (failure === "fetch failure") throw new Error("injected transport reset");
      return Response.json({ error: "upstream temporarily unavailable" }, { status: 503 });
    } });
    try {
      const run = await f.addRun();
      expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
      expect(await f.read(run.id)).toMatchObject({
        delivery_status: "queued", attempts: 1, claim_token: null, claimed_at: null,
        projected_revision: null,
      });
      const row = await f.read(run.id);
      expect(row.next_attempt_at).not.toBeNull();
      const backoff = Date.parse(row.next_attempt_at!) - Date.now();
      expect(backoff).toBeGreaterThan(0);
      expect(backoff).toBeLessThanOrEqual(60_000);
      expect(row.last_error).toContain(failure === "fetch failure" ? "transport reset" : "temporarily unavailable");
      expect(f.captures[0]?.witness).toEqual(witnessFor(run));
    } finally { f.close(); }
  });
}

test("reclaims only stale dispatch claims", async () => {
  const f = await fixture();
  try {
    const stale = await f.addRun({ runId: "stale", deliveryStatus: "dispatching", claimedAt: "2026-10-01T11:00:00.000Z" });
    const fresh = await f.addRun({ runId: "fresh", deliveryStatus: "dispatching", claimedAt: "2026-10-01T11:59:59.000Z" });
    expect(await dispatchRunUsageProjectionOutbox(f.env, {
      now: NOW, staleBefore: "2026-10-01T11:30:00.000Z",
    })).toBe(1);
    expect(f.captures.map(({ witness }) => witness.runId)).toEqual(["stale"]);
    expect(await f.read(stale.id)).toMatchObject({ delivery_status: "done", attempts: 1 });
    expect(await f.read(fresh.id)).toMatchObject({
      delivery_status: "dispatching", attempts: 0, claimed_at: "2026-10-01T11:59:59.000Z",
    });
  } finally { f.close(); }
});

test("concurrent dispatchers win one persisted claim and make one RPC", async () => {
  let entered!: () => void;
  let release!: () => void;
  const called = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture({ reply: async (witness) => {
    entered();
    await held;
    return Response.json({ success: true, runId: witness.runId, revision: 2 });
  } });
  try {
    const run = await f.addRun();
    const first = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    await called;
    const second = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    await second;
    release();
    expect(await first).toBe(1);
    expect(f.captures).toHaveLength(1);
    expect(await f.read(run.id)).toMatchObject({ delivery_status: "done", attempts: 1 });
  } finally { release(); f.close(); }
});

test("a stale reclaim fences the old held RPC from resetting the newer claim", async () => {
  let firstEntered!: () => void;
  let secondEntered!: () => void;
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstStarted = new Promise<void>((resolve) => { firstEntered = resolve; });
  const secondStarted = new Promise<void>((resolve) => { secondEntered = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  let calls = 0;
  const f = await fixture({ reply: async (witness) => {
    calls++;
    if (calls === 1) {
      firstEntered();
      await firstGate;
      return Response.json({ success: true, runId: witness.runId, revision: 3 });
    }
    secondEntered();
    await secondGate;
    return Response.json({ success: true, runId: witness.runId, revision: 4 });
  } });
  try {
    const run = await f.addRun();
    const oldDispatch = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    await firstStarted;
    const oldClaim = (await f.read(run.id)).claim_token;
    const newDispatch = dispatchRunUsageProjectionOutbox(f.env, {
      now: NOW, staleBefore: new Date(Date.now() + 60_000).toISOString(),
    });
    await secondStarted;
    const reclaimed = await f.read(run.id);
    expect(reclaimed).toMatchObject({ delivery_status: "dispatching", attempts: 2 });
    expect(reclaimed.claim_token).not.toBe(oldClaim);
    const newClaim = reclaimed.claim_token;
    releaseFirst();
    expect(await oldDispatch).toBe(0);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "dispatching", attempts: 2, claim_token: newClaim,
    });
    releaseSecond();
    expect(await newDispatch).toBe(1);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "done", attempts: 2, claim_token: null, projected_revision: 4,
    });
    expect(f.captures).toHaveLength(2);
    expect(f.captures[0]?.witness).toEqual(f.captures[1]?.witness);
    expect(f.captures[0]?.claim.claimToken).toBe(oldClaim);
    expect(f.captures[1]?.claim.claimToken).toBe(newClaim);
  } finally { releaseFirst(); releaseSecond(); f.close(); }
});

test("bounds one projection RPC at five seconds without sleeping", async () => {
  let entered!: () => void;
  const called = new Promise<void>((resolve) => { entered = resolve; });
  const f = await fixture({ reply: async () => {
    entered();
    return new Promise<Response>(() => {});
  } });
  jest.useFakeTimers({ now: new Date(NOW) });
  try {
    const run = await f.addRun();
    const dispatch = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    await called;
    jest.advanceTimersByTime(5_000);
    expect(await dispatch).toBe(0);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "queued", attempts: 1, claim_token: null,
    });
    expect((await f.read(run.id)).last_error).toContain("notifier fetch deadline exceeded");
  } finally { jest.useRealTimers(); f.close(); }
});

test("bounds unreadable acknowledgement bodies at five seconds without sleeping", async () => {
  let bodyEntered!: () => void;
  const reading = new Promise<void>((resolve) => { bodyEntered = resolve; });
  const f = await fixture({ reply: async () => {
    const response = Response.json({ success: true });
    response.json = () => {
      bodyEntered();
      return new Promise<unknown>(() => {});
    };
    return response;
  } });
  jest.useFakeTimers({ now: new Date(NOW) });
  try {
    const run = await f.addRun();
    const dispatch = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    await reading;
    jest.advanceTimersByTime(5_000);
    expect(await dispatch).toBe(0);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "queued", attempts: 1, claim_token: null,
    });
    expect((await f.read(run.id)).last_error).toContain("notifier body deadline exceeded");
  } finally {
    jest.useRealTimers();
    f.close();
  }
});

test("stops dispatching at the 30-second whole-cron deadline without sleeping", async () => {
  const f = await fixture({ reply: async (witness) => {
    jest.setSystemTime(new Date(Date.now() + 5_000));
    return Response.json({ success: true, runId: witness.runId, revision: 1 });
  } });
  jest.useFakeTimers({ now: new Date(NOW) });
  try {
    const runs = [];
    for (let index = 0; index < 8; index++) runs.push(await f.addRun({ runId: `bounded-${index}` }));
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW, limit: 10 })).toBe(5);
    expect(f.captures).toHaveLength(6);
    const rows = await Promise.all(runs.map((run) => f.read(run.id)));
    expect(rows.filter((row) => row.delivery_status === "done")).toHaveLength(5);
    expect(rows.filter((row) => row.delivery_status === "dispatching" && row.attempts === 1)).toHaveLength(1);
    expect(rows.filter((row) => row.delivery_status === "queued")).toHaveLength(2);
  } finally { jest.useRealTimers(); f.close(); }
});

test("bounds a pending initial SQLite SELECT and does no work when it finishes late", async () => {
  let entered!: () => void;
  let release!: () => void;
  let finished!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const lateReadFinished = new Promise<void>((resolve) => { finished = resolve; });
  const f = await fixture();
  jest.useFakeTimers({ now: new Date(NOW) });
  try {
    const run = await f.addRun();
    let held = false;
    const wrap = (builder: object): object => new Proxy(builder, {
      get(inner, key) {
        const value = Reflect.get(inner, key);
        if (key === "all" && typeof value === "function" && !held) {
          held = true;
          return (...args: unknown[]) => {
            entered();
            return gate.then(async () => {
              const rows = await value.apply(inner, args);
              finished();
              return rows;
            });
          };
        }
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = value.apply(inner, args);
          return next && typeof next === "object" ? wrap(next) : next;
        };
      },
    });
    const wrapSelect = (builder: object): object => new Proxy(builder, {
      get(inner, key) {
        if (key === "from") {
          return (table: unknown) => {
            const from = Reflect.get(inner, key) as (table: unknown) => object;
            const next = from.call(inner, table);
            return table === schema.runUsageProjectionOutbox ? wrap(next) : next;
          };
        }
        const value = Reflect.get(inner, key);
        return typeof value === "function" ? value.bind(inner) : value;
      },
    });
    f.env.DB = new Proxy(f.db, {
      get(target, property) {
        if (property === "select") return () => wrapSelect(target.select());
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as RunnerEnv["DB"];
    const dispatch = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    const reachedSelect = await Promise.race([started.then(() => true), dispatch.then(() => false, () => false)]);
    expect(reachedSelect).toBe(true);
    jest.advanceTimersByTime(5_000);
    await expect(dispatch).rejects.toThrow("due-row SQL read deadline exceeded");
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "queued", attempts: 0, claim_token: null,
    });
    release();
    await lateReadFinished;
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "queued", attempts: 0, claim_token: null,
    });
    expect(f.captures).toHaveLength(0);
  } finally { release(); jest.useRealTimers(); f.close(); }
});

test("recovers a committed done row when its SQL readback SELECT times out", async () => {
  let entered!: () => void;
  let release!: () => void;
  let finished!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const lateReadFinished = new Promise<void>((resolve) => { finished = resolve; });
  const f = await fixture();
  jest.useFakeTimers({ now: new Date(NOW) });
  try {
    const run = await f.addRun();
    const execute = f.client.execute.bind(f.client);
    let held = false;
    f.client.execute = (async (statement: unknown) => {
      const query = typeof statement === "string" ? statement :
        (statement as { sql?: unknown }).sql;
      if (!held && typeof query === "string" &&
        query.includes('from "run_usage_projection_outbox"') &&
        query.includes('"run_usage_projection_outbox"."id" = ?')) {
        held = true;
        entered();
        await gate;
        const result = await execute(statement as never);
        finished();
        return result;
      }
      return execute(statement as never);
    }) as typeof f.client.execute;
    const dispatch = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    const reachedReadback = await Promise.race([started.then(() => true), dispatch.then(() => false, () => false)]);
    expect(reachedReadback).toBe(true);
    jest.advanceTimersByTime(5_000);
    expect(await dispatch).toBe(1);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "done", attempts: 1, claim_token: null, projected_revision: 1,
    });
    expect(f.captures).toHaveLength(1);
    release();
    await lateReadFinished;
  } finally { release(); jest.useRealTimers(); f.close(); }
});

test("a claim that commits after the cron deadline remains stale-replayable", async () => {
  let entered!: () => void;
  let release!: () => void;
  let finished!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const lateClaimFinished = new Promise<void>((resolve) => { finished = resolve; });
  const f = await fixture();
  jest.useFakeTimers({ now: new Date(NOW) });
  try {
    const run = await f.addRun();
    let held = false;
    const wrap = (builder: object, holdThisUpdate: boolean): object => new Proxy(builder, {
      get(inner, key) {
        const value = Reflect.get(inner, key);
        if (key === "then" && holdThisUpdate && typeof value === "function") {
          return (resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) => {
            entered();
            return gate.then(async () => {
              const result = await new Promise<unknown>((done, fail) => value.call(inner, done, fail));
              finished();
              return resolve(result);
            }, reject);
          };
        }
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = value.apply(inner, args);
          const isClaim = key === "set" && !held &&
            (args[0] as { deliveryStatus?: string }).deliveryStatus === "dispatching";
          if (isClaim) held = true;
          return next && typeof next === "object"
            ? wrap(next, holdThisUpdate || isClaim)
            : next;
        };
      },
    });
    f.env.DB = new Proxy(f.db, {
      get(target, property) {
        if (property === "update") return (table: unknown) =>
          wrap(target.update(table as never), false);
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as RunnerEnv["DB"];
    const dispatch = dispatchRunUsageProjectionOutbox(f.env, { now: NOW });
    await started;
    jest.advanceTimersByTime(30_000);
    await expect(dispatch).rejects.toThrow("claim SQL write deadline exceeded");
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "queued", attempts: 0, claim_token: null,
    });

    release();
    await lateClaimFinished;
    const lateClaim = await f.read(run.id);
    expect(lateClaim).toMatchObject({ delivery_status: "dispatching", attempts: 1 });
    expect(lateClaim.claim_token).toBeString();
    expect(f.captures).toHaveLength(0);

    const staleBefore = new Date(Date.now()).toISOString();
    expect(await dispatchRunUsageProjectionOutbox(f.env, {
      now: staleBefore, staleBefore,
    })).toBe(1);
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0]?.witness).toEqual(witnessFor(run));
    expect(f.captures[0]?.claim.claimToken).not.toBe(lateClaim.claim_token);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "done", attempts: 2, claim_token: null, projected_revision: 1,
    });
  } finally { release(); jest.useRealTimers(); f.close(); }
});

test("a lost DO acknowledgement retries the same immutable logical witness", async () => {
  let first = true;
  const f = await fixture({ reply: async (witness) => {
    if (first) {
      first = false;
      throw new Error("injected lost acknowledgement after DO accepted witness");
    }
    return Response.json({ success: true, runId: witness.runId, revision: 4 });
  } });
  try {
    const run = await f.addRun();
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
    await f.client.execute({
      sql: "UPDATE run_usage_projection_outbox SET next_attempt_at = NULL WHERE id = ?",
      args: [run.id],
    });
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(1);
    expect(f.captures).toHaveLength(2);
    expect(f.captures[0]?.witness).toEqual(f.captures[1]?.witness);
    expect(await f.read(run.id)).toMatchObject({ delivery_status: "done", attempts: 2, projected_revision: 4 });
  } finally { f.close(); }
});

test("preserves a committed done row after its SQL acknowledgement is lost", async () => {
  const f = await fixture();
  try {
    const run = await f.addRun();
    const realDb = f.db;
    const wrapped = new Proxy(realDb, {
      get(target, property) {
        if (property !== "update") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (table: unknown) => {
          const query = target.update(table as never);
          const wrap = (builder: object, shouldLoseAck: boolean): object => new Proxy(builder, {
            get(inner, key) {
              if (key === "then") {
                const then = Reflect.get(inner, key) as (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => unknown;
                return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                  then.call(inner, (value) => {
                    if (shouldLoseAck) return reject(new Error("injected lost SQL acknowledgement after commit"));
                    return resolve(value);
                  }, reject);
              }
              const value = Reflect.get(inner, key);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                const next = value.apply(inner, args);
                return next && typeof next === "object"
                  ? wrap(next, shouldLoseAck || (key === "set" &&
                    (args[0] as { deliveryStatus?: string }).deliveryStatus === "done"))
                  : next;
              };
            },
          });
          return wrap(query, false);
        };
      },
    }) as unknown as Database;
    f.env.DB = wrapped as unknown as RunnerEnv["DB"];
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(1);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "done", attempts: 1, claim_token: null, claimed_at: null,
      projected_revision: 1,
    });
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
    expect(f.captures).toHaveLength(1);
  } finally { f.close(); }
});

for (const authorityFailure of ["missing configuration", "former owner", "wrong workspace"] as const) {
  test(`blocks a ${authorityFailure} without transferring the recorded owner`, async () => {
    const f = await fixture();
    try {
      const run = await f.addRun();
      if (authorityFailure === "missing configuration") {
        f.env.OIDC_OWNER_SUBJECT = undefined as never;
      } else if (authorityFailure === "former owner") {
        await f.client.execute({ sql: "UPDATE auth_identities SET user_id = 'former-owner' WHERE id = 'identity-1'" });
      } else {
        await f.addWorkspace("other-workspace", "owner-1");
        await f.client.execute({ sql: "UPDATE runs SET account_id = 'other-workspace' WHERE id = ?", args: [run.runId] });
      }
      expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
      expect(f.captures).toHaveLength(0);
      expect(await f.read(run.id)).toMatchObject({
        delivery_status: "blocked", owner_account_id: "owner-1", claim_token: null,
        next_attempt_at: null,
      });
    } finally { f.close(); }
  });
}

test("records the notifier's typed authority rejection as blocked with its reason", async () => {
  const f = await fixture({ reply: async () => Response.json({
    code: "usage_authority_blocked",
    error: "Recorded terminal witness no longer matches the active owner",
  }, { status: 409 }) });
  try {
    const run = await f.addRun();
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
    expect(f.captures).toHaveLength(1);
    expect(await f.read(run.id)).toMatchObject({
      delivery_status: "blocked", attempts: 1, claim_token: null,
      next_attempt_at: null,
    });
    expect((await f.read(run.id)).last_error)
      .toContain("Recorded terminal witness no longer matches the active owner");
  } finally { f.close(); }
});

test("allows requesterless cancelled Runs in multiple Workspaces of the active owner", async () => {
  const f = await fixture();
  try {
    const first = await f.addRun({ runId: "cancelled-a", workspaceId: "workspace-a", status: "cancelled" });
    const second = await f.addRun({ runId: "completed-b", workspaceId: "workspace-b", status: "completed" });
    expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW, limit: 10 })).toBe(2);
    expect(f.captures.map(({ witness }) => witness.ownerAccountId)).toEqual(["owner-1", "owner-1"]);
    expect(f.captures.find(({ witness }) => witness.runId === first.runId)?.witness).toEqual(witnessFor(first));
    expect(f.captures.find(({ witness }) => witness.runId === second.runId)?.witness).toEqual(witnessFor(second));
    expect(await f.read(first.id)).toMatchObject({ delivery_status: "done" });
    expect(await f.read(second.id)).toMatchObject({ delivery_status: "done" });
  } finally { f.close(); }
});

for (const malformedAck of ["malformed body", "unsafe revision", "wrong run"] as const) {
  test(`does not complete an outbox row for a ${malformedAck} acknowledgement`, async () => {
    const f = await fixture({ reply: async (witness) => {
      if (malformedAck === "malformed body") return new Response("not-json", { status: 200 });
      return Response.json(malformedAck === "unsafe revision"
        ? { success: true, runId: witness.runId, revision: Number.MAX_SAFE_INTEGER + 1 }
        : { success: true, runId: "different-run", revision: 1 });
    } });
    try {
      const run = await f.addRun();
      expect(await dispatchRunUsageProjectionOutbox(f.env, { now: NOW })).toBe(0);
      expect(await f.read(run.id)).toMatchObject({
        delivery_status: "queued", attempts: 1, claim_token: null, projected_revision: null,
      });
      expect(await f.read(run.id).then((row) => row.next_attempt_at)).not.toBeNull();
    } finally { f.close(); }
  });
}
