import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../infra/db/schema.ts";
import type { Env } from "../../shared/types/index.ts";
import { createInMemoryObjectStore } from "../../local-platform/in-memory-r2.ts";
import { gzipCompressString } from "../../shared/utils/gzip.ts";
import { persistNotifierSnapshot, loadNotifierSnapshot } from "./notifier-journal.ts";
import { RunNotifierDO } from "./run-notifier.ts";
import { createSqliteSqlDatabase } from "../../local-platform/persistent-d1.ts";
import { completeRunAtomically } from "../../application/services/agent/complete-run.ts";
import { transitionRunTerminalAtomically } from "../../application/services/run-notifier/terminal-transition.ts";
import { dispatchRunUsageProjectionOutbox } from "../../application/services/app-usage/run-projection-outbox.ts";
import { projectRunUsageSnapshot } from "../../application/services/app-usage/usage-recorder.ts";
import { getDb, accounts, authIdentities, threads, runs, runUsageProjectionOutbox, appUsageEvents } from "../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import type { RunnerEnv } from "../../shared/types/index.ts";

const RUN_ID = "accepted-usage-integration";
const CREATED_AT = "2026-10-01T00:00:00.000Z";
const usage = (meter_type: string, units: number) => ({
  meter_type, units, reference_type: null, metadata: null, created_at: CREATED_AT,
});

function durableState(values = new Map<string, unknown>()) {
  let serial = Promise.resolve();
  let alarm: number | null = null;
  const storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === "string") values.set(key, structuredClone(value));
      else for (const [name, entry] of Object.entries(key)) values.set(name, structuredClone(entry));
    },
    async delete(key: string | string[]) {
      let removed = 0;
      for (const item of Array.isArray(key) ? key : [key]) if (values.delete(item)) removed++;
      return removed;
    },
    async list<T>(options?: { prefix?: string }) {
      return new Map([...values.entries()].filter(([key]) => key.startsWith(options?.prefix ?? "")) as [string, T][]);
    },
    async getAlarm() { return alarm; },
    async setAlarm(when: number | Date) { alarm = when instanceof Date ? when.getTime() : when; },
    async deleteAlarm() { alarm = null; },
  };
  const binding = {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const work = serial.then(callback);
      serial = work.then(() => undefined, () => undefined);
      return work;
    },
    getWebSockets: () => [], getTags: () => [], acceptWebSocket: () => undefined,
  };
  return { storage, binding: binding as never, values, alarm: () => alarm };
}

async function fixture(options: { loseFirstSqlAck?: boolean; holdFirstSqlBatch?: boolean } = {}) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, account_id TEXT, status TEXT NOT NULL DEFAULT 'running', completion_key TEXT, usage TEXT NOT NULL, last_event_id INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, owner_account_id TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE auth_identities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_sub TEXT NOT NULL);
    CREATE TABLE run_usage_projection_assertions (id TEXT PRIMARY KEY, valid INTEGER NOT NULL);
    CREATE TABLE app_usage_events (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE,
      owner_account_id TEXT NOT NULL, scope_type TEXT NOT NULL, space_id TEXT,
      meter_type TEXT NOT NULL, units REAL NOT NULL, reference_id TEXT, reference_type TEXT,
      metadata TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE app_usage_rollups (id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL,
      scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, space_id TEXT, meter_type TEXT NOT NULL,
      period_start TEXT NOT NULL, units REAL NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_app_usage_rollups_scope ON app_usage_rollups
      (owner_account_id, scope_type, scope_id, meter_type, period_start);
  `);
  await client.execute({ sql: "INSERT INTO accounts (id, owner_account_id) VALUES (?, ?)",
    args: ["usage-workspace", "actual-owner"] });
  await client.execute({ sql: "INSERT INTO accounts (id, owner_account_id) VALUES (?, NULL)",
    args: ["actual-owner"] });
  await client.execute({ sql: "INSERT INTO auth_identities (id, user_id, provider, provider_sub) VALUES (?, ?, 'oidc', ?)",
    args: ["owner-identity", "actual-owner", "https://owner.example#owner-subject"] });
  await client.execute({ sql: "INSERT INTO runs (id, account_id, usage) VALUES (?, ?, ?)",
    args: [RUN_ID, "usage-workspace", JSON.stringify({ inputTokens: 1000 })] });
  const bucket = createInMemoryObjectStore();
  const state = durableState();
  const realDb = drizzle(client, { schema });
  let loseSqlAck = options.loseFirstSqlAck === true;
  let holdSqlBatch = options.holdFirstSqlBatch === true;
  let signalEntered: (() => void) | undefined;
  let releaseHeldBatch: (() => void) | undefined;
  const sqlEntered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const sqlGate = new Promise<void>((resolve) => { releaseHeldBatch = resolve; });
  const db = new Proxy(realDb, {
    get(target, name) {
      if (name === "batch") return async (...args: unknown[]) => {
        if (holdSqlBatch) {
          holdSqlBatch = false;
          signalEntered?.();
          await sqlGate;
        }
        const result = await (target.batch as (...values: unknown[]) => Promise<unknown>).apply(target, args);
        if (loseSqlAck) {
          loseSqlAck = false;
          throw new Error("injected lost SQL acknowledgement after commit");
        }
        return result;
      };
      const value = Reflect.get(target, name);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const env = { DB: db, TAKOS_OFFLOAD: bucket,
    OIDC_ISSUER_URL: "https://owner.example", OIDC_OWNER_SUBJECT: "owner-subject" } as unknown as Env;
  const make = () => new RunNotifierDO(state.binding, env);
  const notifier = make();
  await (notifier as unknown as { initialized: Promise<void> }).initialized;
  return { client, bucket, state, env, make, notifier,
    sqlEntered, releaseSql: () => releaseHeldBatch?.(),
    close: () => client.close() };
}

async function post(notifier: RunNotifierDO, path: string, body?: unknown) {
  return notifier.fetch(new Request(`http://internal${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

async function eventRow(client: ReturnType<typeof createClient>, meter: string) {
  const result = await client.execute({
    sql: "SELECT units, owner_account_id, space_id FROM app_usage_events WHERE idempotency_key = ?",
    args: [`run:${RUN_ID}:${meter}`],
  });
  return result.rows[0] ?? null;
}

test("accepted usage projects cumulative pending and late events through real SQLite", async () => {
  const f = await fixture();
  try {
    const first = await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 2, request_id: "u1",
    });
    expect(first.status).toBe(200);
    const duplicate = await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 2, request_id: "u1",
    });
    expect(await duplicate.json()).toMatchObject({ success: true, duplicate: true });
    const terminal = await post(f.notifier, "/emit", {
      runId: RUN_ID, type: "completed", data: { status: "completed" },
      dedup_key: "terminal-between-usage",
    });
    expect(terminal.status).toBe(200);
    const late = await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 3, request_id: "u2",
    });
    expect(late.status).toBe(200);
    const snapshot = await f.notifier.fetch(new Request(
      `http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(await snapshot.json()).toMatchObject({
      success: true, totals: { exec_seconds: 5 }, revision: 4,
    });
    const projected = await post(f.notifier, `/usage-project?runId=${RUN_ID}`);
    expect(await projected.json()).toMatchObject({ success: true });
    await expect(eventRow(f.client, "exec_seconds")).resolves.toMatchObject({
      units: 5, owner_account_id: "actual-owner", space_id: "usage-workspace",
    });
    await expect(eventRow(f.client, "llm_tokens_input")).resolves.toMatchObject({ units: 1 });
    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    expect((await (await cold.fetch(new Request(
      `http://internal/usage-snapshot?runId=${RUN_ID}`))).json() as { totals: { exec_seconds: number } })
      .totals.exec_seconds).toBe(5);
  } finally { f.close(); }
});

test("SQL failure leaves accepted usage dirty and alarm retries from the journal", async () => {
  const f = await fixture();
  try {
    await f.client.executeMultiple(`
      CREATE TRIGGER reject_run_usage BEFORE INSERT ON app_usage_events
      BEGIN SELECT RAISE(ABORT, 'injected SQL usage failure'); END;
    `);
    const accepted = await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 9, request_id: "retryable",
    });
    expect(accepted.status).toBe(200);
    expect(await eventRow(f.client, "exec_seconds")).toBeNull();
    const dirty = await loadNotifierSnapshot(f.state.storage as never, "run") as Record<string, unknown>;
    expect(dirty.usageLedger).toMatchObject({ revision: 2, projectedRevision: 0 });
    expect(f.state.alarm()).not.toBeNull();
    await f.client.execute("DROP TRIGGER reject_run_usage");
    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    await cold.alarm();
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 9 });
    const clean = await loadNotifierSnapshot(f.state.storage as never, "run") as Record<string, unknown>;
    expect(clean.usageLedger).toMatchObject({ revision: 2, projectedRevision: 2 });
  } finally { f.close(); }
});

test("lost SQL acknowledgement keeps the projection dirty and a retry uses fixed-key maxima", async () => {
  const f = await fixture({ loseFirstSqlAck: true });
  try {
    const accepted = await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 4, request_id: "lost-ack",
    });
    expect(accepted.status).toBe(200);
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 4 });
    const before = await loadNotifierSnapshot(f.state.storage as never, "run") as Record<string, unknown>;
    expect(before.usageLedger).toMatchObject({ revision: 2, projectedRevision: 0 });
    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    await cold.alarm();
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 4 });
    const rows = await f.client.execute({
      sql: "SELECT COUNT(*) AS n FROM app_usage_events WHERE idempotency_key = ?",
      args: [`run:${RUN_ID}:exec_seconds`],
    });
    expect(rows.rows[0]?.n).toBe(1);
    const after = await loadNotifierSnapshot(f.state.storage as never, "run") as Record<string, unknown>;
    expect(after.usageLedger).toMatchObject({ revision: 2, projectedRevision: 2 });
  } finally { f.close(); }
});

test("a captured older SQL projection cannot clear a newer accepted revision", async () => {
  const f = await fixture({ holdFirstSqlBatch: true });
  try {
    const first = post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 2, request_id: "first",
    });
    await f.sqlEntered;
    const second = post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 3, request_id: "second",
    });
    let during: { usageLedger?: { revision: number; projectedRevision: number } } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      during = await loadNotifierSnapshot(f.state.storage as never, "run") as typeof during;
      if (during?.usageLedger?.revision === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(during?.usageLedger).toMatchObject({ revision: 3, projectedRevision: 0 });
    f.releaseSql();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const olderAck = await loadNotifierSnapshot(f.state.storage as never, "run") as typeof during;
    expect(olderAck?.usageLedger).toMatchObject({ revision: 3, projectedRevision: 2 });
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 2 });
    await f.notifier.alarm();
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 5 });
    const latestAck = await loadNotifierSnapshot(f.state.storage as never, "run") as typeof during;
    expect(latestAck?.usageLedger).toMatchObject({ revision: 3, projectedRevision: 3 });
  } finally { f.releaseSql(); f.close(); }
});

test("terminal acceptance dirties projection for SQL token usage without a raw usage event", async () => {
  const f = await fixture();
  try {
    const wrong = await post(f.notifier, "/usage-project?runId=invalid%2Frun");
    expect(wrong.status).toBe(400);
    const terminal = await post(f.notifier, "/emit", {
      runId: RUN_ID, type: "completed", data: { status: "completed" },
      dedup_key: "terminal-1",
    });
    expect(terminal.status).toBe(200);
    expect(await eventRow(f.client, "llm_tokens_input")).toMatchObject({ units: 1 });
    const current = await f.notifier.fetch(new Request(
      `http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(await current.json()).toMatchObject({ success: true, revision: 2, totals: {} });
    const repeat = await post(f.notifier, "/emit", {
      runId: RUN_ID, type: "completed", data: { status: "completed" },
      dedup_key: "terminal-1",
    });
    expect(await repeat.json()).toMatchObject({ success: true, duplicate: true });
    const after = await f.notifier.fetch(new Request(
      `http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(await after.json()).toMatchObject({ revision: 2 });
  } finally { f.close(); }
});

test("legacy archived and pending usage migrate once; malformed orphan enters durable repair", async () => {
  const f = await fixture();
  try {
    const archived = [usage("exec_seconds", 50_002), usage("future_meter", 7)];
    await f.bucket.put(`runs/${RUN_ID}/usage/000001.jsonl.gz`, await gzipCompressString(
      archived.map((entry) => JSON.stringify(entry)).join("\n") + "\n"));
    const old = {
      schemaVersion: 2, eventBuffer: [], eventIdCounter: 0, runId: RUN_ID,
      r2SegmentIndex: 1, r2SegmentBuffer: [], r2LastFlushedSegmentIndex: 0,
      usageSegmentIndex: 2, usageSegmentBuffer: [usage("exec_seconds", 3)],
      usageLastFlushedSegmentIndex: 1, emitDedupKeys: [], flushIntents: [],
      emitReceipts: [], usageReceipts: [], legacyPendingRunCount: 0,
      legacyPendingUsageCount: 1,
    };
    await persistNotifierSnapshot(f.state.storage as never, "run", old);
    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    const result = await cold.fetch(new Request(`http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(await result.json()).toMatchObject({
      success: true, totals: { exec_seconds: 50_005 }, revision: 1,
    });
    const projection = await post(cold, `/usage-project?runId=${RUN_ID}`);
    expect(projection.status).toBe(200);
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 50_005 });
    const raw = await loadNotifierSnapshot(f.state.storage as never, "run") as Record<string, unknown>;
    expect(raw.usageLedger).toMatchObject({ phase: "ready" });
  } finally { f.close(); }

  const bad = await fixture();
  try {
    await bad.bucket.put(`runs/${RUN_ID}/usage/000002.jsonl.gz`,
      await gzipCompressString(`${JSON.stringify(usage("exec_seconds", 1))}\n`));
    const response = await bad.notifier.fetch(new Request(
      `http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(response.status).toBe(503);
    const raw = await loadNotifierSnapshot(bad.state.storage as never, "run") as Record<string, unknown>;
    expect(raw.usageLedger).toMatchObject({ phase: "repair" });
    expect(await eventRow(bad.client, "exec_seconds")).toBeNull();
  } finally { bad.close(); }
});

test("50,001 archived usage events fold across bounded alarms and cold replacement", async () => {
  const f = await fixture();
  try {
    const full = Array.from({ length: 200 }, () => usage("exec_seconds", 1));
    const fullGzip = await gzipCompressString(full.map((item) => JSON.stringify(item)).join("\n") + "\n");
    for (let index = 1; index <= 250; index++) {
      await f.bucket.put(`runs/${RUN_ID}/usage/${String(index).padStart(6, "0")}.jsonl.gz`, fullGzip);
    }
    await f.bucket.put(`runs/${RUN_ID}/usage/000251.jsonl.gz`,
      await gzipCompressString(`${JSON.stringify(usage("exec_seconds", 1))}\n`));
    await persistNotifierSnapshot(f.state.storage as never, "run", {
      schemaVersion: 2, eventBuffer: [], eventIdCounter: 0, runId: RUN_ID,
      r2SegmentIndex: 1, r2SegmentBuffer: [], r2LastFlushedSegmentIndex: 0,
      usageSegmentIndex: 252, usageSegmentBuffer: [usage("exec_seconds", 3)],
      usageLastFlushedSegmentIndex: 251, emitDedupKeys: [], flushIntents: [],
      emitReceipts: [], usageReceipts: [], legacyPendingRunCount: 0,
      legacyPendingUsageCount: 1,
    });
    let cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    const first = await cold.fetch(new Request(`http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(first.status).toBe(503);
    let head = await loadNotifierSnapshot(f.state.storage as never, "run") as {
      usageLedger: { phase: string; build: { nextIndex: number } };
    };
    expect(head.usageLedger.phase).toBe("building");
    expect(head.usageLedger.build.nextIndex).toBeLessThanOrEqual(8);
    cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (head.usageLedger.phase === "ready") break;
      await cold.alarm();
      head = await loadNotifierSnapshot(f.state.storage as never, "run") as typeof head;
    }
    expect(head.usageLedger.phase).toBe("ready");
    const snapshot = await cold.fetch(new Request(`http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(await snapshot.json()).toMatchObject({
      success: true, totals: { exec_seconds: 50_004 }, revision: 1,
    });
    expect(await eventRow(f.client, "exec_seconds")).toMatchObject({ units: 50_004 });
  } finally { f.close(); }
}, 20_000);

test("known interrupted legacy PUT counts pending once; missing, zero, corrupt and oversized objects require repair", async () => {
  const pending = usage("exec_seconds", 7);
  const legacy = (frontier: number) => ({
    schemaVersion: 2, eventBuffer: [], eventIdCounter: 0, runId: RUN_ID,
    r2SegmentIndex: 1, r2SegmentBuffer: [], r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: frontier + 1, usageSegmentBuffer: [pending],
    usageLastFlushedSegmentIndex: frontier, emitDedupKeys: [], flushIntents: [],
    emitReceipts: [], usageReceipts: [], legacyPendingRunCount: 0,
    legacyPendingUsageCount: 1,
  });
  const good = await fixture();
  try {
    await persistNotifierSnapshot(good.state.storage as never, "run", legacy(0));
    await good.bucket.put(`runs/${RUN_ID}/usage/000001.jsonl.gz`,
      await gzipCompressString(`${JSON.stringify(pending)}\n`));
    const cold = good.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    const response = await cold.fetch(new Request(`http://internal/usage-snapshot?runId=${RUN_ID}`));
    expect(await response.json()).toMatchObject({ success: true, totals: { exec_seconds: 7 } });
  } finally { good.close(); }
  for (const problem of ["missing", "zero", "corrupt", "oversized"] as const) {
    const f = await fixture();
    try {
      await persistNotifierSnapshot(f.state.storage as never, "run", legacy(problem === "zero" ? 0 : 1));
      if (problem === "zero") {
        await f.bucket.put(`runs/${RUN_ID}/usage/000000.jsonl.gz`,
          await gzipCompressString(`${JSON.stringify(pending)}\n`));
      } else if (problem === "corrupt") {
        await f.bucket.put(`runs/${RUN_ID}/usage/000001.jsonl.gz`, "invalid gzip");
      } else if (problem === "oversized") {
        await f.bucket.put(`runs/${RUN_ID}/usage/000001.jsonl.gz`, new Uint8Array(8 * 1024 * 1024 + 1));
      }
      const cold = f.make();
      await (cold as unknown as { initialized: Promise<void> }).initialized;
      const response = await cold.fetch(new Request(`http://internal/usage-snapshot?runId=${RUN_ID}`));
      expect(response.status).toBe(503);
      const head = await loadNotifierSnapshot(f.state.storage as never, "run") as Record<string, unknown>;
      expect(head.usageLedger).toMatchObject({ phase: "repair" });
      expect(await eventRow(f.client, "exec_seconds")).toBeNull();
    } finally { f.close(); }
  }
});

test("an unrepresentable positive increment is rejected before durable acknowledgement", async () => {
  const f = await fixture();
  try {
    expect((await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 1e15, request_id: "large",
    })).status).toBe(200);
    const before = await loadNotifierSnapshot(f.state.storage as never, "run") as {
      usageLedger: { revision: number; totals: { exec_seconds: number } };
      usageSegmentBuffer: unknown[]; usageReceipts: unknown[];
    };
    const rejected = await post(f.notifier, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 0.001, request_id: "lost",
    });
    expect(rejected.status).toBe(503);
    const after = await loadNotifierSnapshot(f.state.storage as never, "run") as typeof before;
    expect(after.usageLedger.revision).toBe(before.usageLedger.revision);
    expect(after.usageLedger.totals.exec_seconds).toBe(1e15);
    expect(after.usageSegmentBuffer).toEqual(before.usageSegmentBuffer);
    expect(after.usageReceipts).toEqual(before.usageReceipts);
  } finally { f.close(); }
});

test("terminal SQL without accepted emit replays through a cold real RunNotifier exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "takos-usage-outbox-"));
  const binding = await createSqliteSqlDatabase(
    join(directory, "app.sqlite"),
    join(process.cwd(), "db/migrations-control/migrations"),
  );
  try {
    const db = getDb(binding);
    const now = new Date().toISOString();
    const ownerId = "outbox-owner";
    const participantId = "external-participant";
    const spaceId = "outbox-space";
    const threadId = "outbox-thread";
    const runId = "outbox-run";
    await db.insert(accounts).values({ id: ownerId, type: "user", status: "active",
      name: "Owner", slug: ownerId, ownerAccountId: ownerId,
      createdAt: now, updatedAt: now });
    await db.insert(authIdentities).values({ id: "outbox-oidc", userId: ownerId,
      provider: "oidc", providerSub: "https://owner.example#owner-subject",
      linkedAt: now, lastLoginAt: now });
    await db.insert(accounts).values({ id: participantId, type: "user", status: "active",
      name: "Participant", slug: participantId, createdAt: now, updatedAt: now });
    await db.insert(accounts).values({ id: spaceId, type: "team", status: "active",
      name: "Private Space", slug: spaceId, ownerAccountId: ownerId,
      createdAt: now, updatedAt: now });
    await db.insert(threads).values({ id: threadId, accountId: spaceId,
      title: "Outbox recovery", createdAt: now, updatedAt: now });
    await db.insert(runs).values({ id: runId, accountId: spaceId,
      requesterAccountId: participantId, threadId, status: "running",
      serviceId: "outbox-service", leaseVersion: 1,
      agentType: "default", model: "gpt-local", input: "{}", createdAt: now });
    const completionInput = {
      runId, threadId, serviceId: "outbox-service", leaseVersion: 1,
      status: "completed" as const, usage: { inputTokens: 2000, outputTokens: 0 },
      messages: [], terminalEvent: { status: "completed" },
    };
    await binding.exec(`CREATE TRIGGER reject_usage_witness
      BEFORE INSERT ON run_usage_projection_outbox
      BEGIN SELECT RAISE(ABORT, 'injected usage witness failure'); END;`);
    await expect(completeRunAtomically(binding, completionInput)).rejects.toThrow();
    expect((await db.select().from(runs).where(eq(runs.id, runId)).get())?.status).toBe("running");
    expect((await db.select().from(runUsageProjectionOutbox)
      .where(eq(runUsageProjectionOutbox.runId, runId)).all())).toHaveLength(0);
    await binding.exec("DROP TRIGGER reject_usage_witness");
    const terminal = await completeRunAtomically(binding, completionInput);
    expect(terminal.committed).toBe(true);
    for (const status of ["failed", "cancelled"] as const) {
      const controlRunId = `outbox-${status}`;
      await db.insert(runs).values({ id: controlRunId, accountId: spaceId,
        threadId, status: "queued", agentType: "default", model: "gpt-local",
        input: "{}", createdAt: now });
      const control = await transitionRunTerminalAtomically(binding, {
        runId: controlRunId, status, expectedStatuses: ["queued"],
        completedAt: now, usage: { inputTokens: status === "failed" ? 200 : 0 },
        eventType: status === "failed" ? "error" : "cancelled",
        terminalEvent: { status },
      });
      expect(control.committed).toBe(true);
      expect(await db.select().from(runUsageProjectionOutbox)
        .where(eq(runUsageProjectionOutbox.runId, controlRunId)).get())
        .toMatchObject({ completionKey: control.completionKey, runStatus: status,
          workspaceId: spaceId, ownerAccountId: ownerId, deliveryStatus: "queued" });
      const loser = await transitionRunTerminalAtomically(binding, {
        runId: controlRunId, status: "completed", expectedStatuses: ["queued"],
        completedAt: now, eventType: "completed", terminalEvent: { status: "completed" },
      });
      expect(loser.committed).toBe(false);
    }
    const witness = await db.select().from(runUsageProjectionOutbox)
      .where(eq(runUsageProjectionOutbox.runId, runId)).get();
    expect(witness).toMatchObject({ completionKey: terminal.completionKey,
      workspaceId: spaceId, ownerAccountId: ownerId, deliveryStatus: "queued" });
    const exactRetry = await completeRunAtomically(binding, completionInput);
    expect(exactRetry).toMatchObject({ committed: true, idempotent: true,
      completionKey: terminal.completionKey });
    expect((await db.select().from(runUsageProjectionOutbox)
      .where(eq(runUsageProjectionOutbox.runId, runId)).all())).toHaveLength(1);

    const state = durableState();
    const bucket = createInMemoryObjectStore();
    const notifierEnv = { DB: binding, TAKOS_OFFLOAD: bucket,
      OIDC_ISSUER_URL: "https://owner.example", OIDC_OWNER_SUBJECT: "owner-subject" } as unknown as Env;
    const make = () => new RunNotifierDO(state.binding, notifierEnv);
    let cold = make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    let requests = 0;
    const namespace = {
      idFromName: (id: string) => id,
      get: (id: string) => ({ fetch: async (request: Request) => {
        expect(id).toBe(runId);
        requests++;
        const response = await cold.fetch(request);
        if (requests === 1) {
          expect(await response.clone().json()).toMatchObject({ success: true });
          throw new Error("injected lost HTTP acknowledgement");
        }
        return response;
      } }),
    };
    const dispatchEnv = { DB: binding, RUN_NOTIFIER: namespace,
      OIDC_ISSUER_URL: "https://owner.example", OIDC_OWNER_SUBJECT: "owner-subject" } as unknown as RunnerEnv;
    expect(await dispatchRunUsageProjectionOutbox(dispatchEnv)).toBe(0);
    const failedWitness = await db.select().from(runUsageProjectionOutbox)
      .where(eq(runUsageProjectionOutbox.runId, runId)).get();
    expect(failedWitness).toMatchObject({ deliveryStatus: "queued", lastError: "Error: injected lost HTTP acknowledgement" });
    expect((await db.select().from(appUsageEvents)
      .where(eq(appUsageEvents.idempotencyKey, `run:${runId}:llm_tokens_input`)).all()).length).toBe(1);
    cold = make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    expect(await dispatchRunUsageProjectionOutbox(dispatchEnv, {
      now: new Date(Date.now() + 86_400_000).toISOString(),
    })).toBe(1);
    const events = await db.select().from(appUsageEvents)
      .where(eq(appUsageEvents.idempotencyKey, `run:${runId}:llm_tokens_input`)).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ownerAccountId: ownerId,
      spaceId, units: 2 });
    // The wrapped D1-shaped client must use the same atomic native batch as
    // the raw binding used by the DO, even on an idempotent cold replay.
    await projectRunUsageSnapshot(db, runId, {}, {
      providerSub: "https://owner.example#owner-subject",
    });
    expect((await db.select().from(appUsageEvents)
      .where(eq(appUsageEvents.idempotencyKey, `run:${runId}:llm_tokens_input`)).all())).toHaveLength(1);
    expect((await db.select().from(runUsageProjectionOutbox)
      .where(eq(runUsageProjectionOutbox.runId, runId)).get())?.deliveryStatus).toBe("done");
    expect(requests).toBe(2);
  } finally {
    binding.close();
    await rm(directory, { recursive: true, force: true });
  }
});
