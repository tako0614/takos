#!/usr/bin/env bun

/** Local native workerd proof of the persisted notifier-state guard. No deploy or remote bindings. */
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";

const root = resolve(import.meta.dir, "..");
const scriptName = "notifier-native-guard-proof";
const archiveDate = "2026-09-30T00:00:00.000Z";
const deadlineMs = 75_000;
const headFaultNativeError = "Error: injected storage head put failure after real R2 success";

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function originalArchive(): Uint8Array {
  const lines = Array.from({ length: 100 }, (_, index) => JSON.stringify({
    event_id: index + 1,
    type: "run.progress",
    data: JSON.stringify({ original: index + 1 }),
    created_at: archiveDate,
  })).join("\n") + "\n";
  return gzipSync(lines);
}

function runSnapshot(runId: string, counter = 0): Record<string, unknown> {
  return {
    eventBuffer: [],
    eventIdCounter: counter,
    runId,
    r2SegmentIndex: counter > 0 ? 2 : 1,
    r2SegmentBuffer: [],
    r2LastFlushedSegmentIndex: counter > 0 ? 1 : 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: counter > 0 ? [["already-seen", Date.now()]] : [],
  };
}

function notificationSnapshot(counter = 0): Record<string, unknown> {
  return { eventBuffer: [], eventIdCounter: counter, userId: "proof-user" };
}

function fixtureSource(): string {
  const runImport = JSON.stringify(join(root, "src/worker/runtime/durable-objects/run-notifier.ts"));
  const notificationImport = JSON.stringify(join(root, "src/worker/runtime/durable-objects/notification-notifier.ts"));
  const journalImport = JSON.stringify(join(root, "src/worker/runtime/durable-objects/notifier-journal.ts"));
  return `import { RunNotifierDO } from ${runImport};
import { NotificationNotifierDO } from ${notificationImport};
import { loadNotifierSnapshot } from ${journalImport};

class Harness {
  constructor(state, env, Notifier, kind) {
    this.state = state;
    this.env = env;
    this.Notifier = Notifier;
    this.kind = kind;
    this.notifier = undefined;
    this.background = new Set();
    this.instanceId = crypto.randomUUID();
  }
  createNotifier() {
    const nativeStorage = this.state.storage;
    const nativeBucket = this.env.TAKOS_OFFLOAD;
    const readHeadFault = async () => {
      const key = await nativeStorage.get("proof/head-fault-key");
      if (typeof key !== "string") return null;
      const object = await nativeBucket.get(key);
      return object ? await object.json() : null;
    };
    const writeHeadFault = async fault => {
      const key = await nativeStorage.get("proof/head-fault-key");
      if (typeof key !== "string") throw new Error("missing native fault control key");
      await nativeBucket.put(key, JSON.stringify(fault));
    };
    const bind = (target, property) => {
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    };
    const storage = new Proxy(nativeStorage, {
      get(target, property) {
        if (property === "setAlarm") return async when => {
          // Keep this probe's automatic recovery outside its bounded cold
          // replacement window. The explicit alarm call below still invokes
          // the real notifier method after native eviction.
          if (await nativeStorage.get("proof/head-fault-key") ||
            await nativeStorage.get("proof/create-race") ||
            await nativeStorage.get("proof/hold-auto-alarm")) {
            return nativeStorage.setAlarm(Date.now() + 120_000);
          }
          return nativeStorage.setAlarm(when);
        };
        if (property === "put") return async (key, value) => {
          if (key === "bufferState") {
            const fault = await readHeadFault();
            if (fault?.armed && fault.successfulR2Puts > 0 && !fault.fired) {
              await writeHeadFault({ ...fault, fired: true, headFailures: 1 });
              throw new Error("injected storage head put failure after real R2 success");
            }
          }
          return nativeStorage.put(key, value);
        };
        return bind(target, property);
      }
    });
    const background = this.background;
    const state = new Proxy(this.state, {
      get(target, property) {
        if (property === "waitUntil") return operation => {
          background.add(operation);
          void operation.finally(() => background.delete(operation)).catch(() => {});
          return target.waitUntil(operation);
        };
        return property === "storage" ? storage : bind(target, property);
      }
    });
    const bucket = nativeBucket && new Proxy(nativeBucket, {
      get(target, property) {
        if (property === "put") return async (key, value, options) => {
          const race = await nativeStorage.get("proof/create-race");
          if (race?.armed && !race.injected && race.key === key && options?.onlyIf) {
            const bytes = Uint8Array.from(atob(race.bytesBase64), char => char.charCodeAt(0));
            await target.put(key, bytes);
            await nativeStorage.put("proof/create-race", { ...race, injected: true,
              competingBytes: bytes.byteLength });
          }
          const result = await target.put(key, value, options);
          const fault = await readHeadFault();
          if (fault?.armed && result !== null) {
            await writeHeadFault({ ...fault, successfulR2Puts: fault.successfulR2Puts + 1 });
          }
          if (race?.armed && race.key === key) {
            const recorded = await nativeStorage.get("proof/create-race");
            await nativeStorage.put("proof/create-race", { ...recorded,
              conditionalReturnedNull: result === null });
          }
          return result;
        };
        return bind(target, property);
      }
    });
    const env = new Proxy(this.env, {
      get(target, property) {
        return property === "TAKOS_OFFLOAD" ? bucket : bind(target, property);
      }
    });
    return new this.Notifier(state, env);
  }
  async alarm() {
    this.notifier ??= this.createNotifier();
    await this.notifier.alarm();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/control/seed") {
      const body = await request.json();
      if (this.notifier) return new Response("already loaded", { status: 409 });
      await this.state.storage.put("bufferState", body.value);
      return Response.json({ seeded: true });
    }
    if (url.pathname === "/control/inspect") {
      const value = await this.state.storage.get("bufferState");
      return Response.json({ exists: value !== undefined, value: value ?? null, instanceId: this.instanceId });
    }
    if (url.pathname === "/control/settled") {
      // An ACK precedes asynchronous offload. Wait for its recorded lifecycle
      // before inspecting a fault; this route exists only in the test harness.
      while (this.background.size) await Promise.allSettled([...this.background]);
      return Response.json({ settled: true });
    }
    if (url.pathname === "/control/snapshot") {
      return Response.json({ value: await loadNotifierSnapshot(this.state.storage, this.kind) });
    }
    if (url.pathname === "/control/chunks") {
      const chunks = await this.state.storage.list({ prefix: "notifier-v2/chunks/", limit: 256 });
      return Response.json({ count: chunks.size, maxSerializedBytes: Math.max(0, ...Array.from(chunks.values(),
        value => new TextEncoder().encode(JSON.stringify(value)).length)) });
    }
    if (url.pathname === "/control/quota") {
      let rejected = false;
      let detail = "";
      try { await this.state.storage.put("quota-proof", "x".repeat(133120)); }
      catch (error) { rejected = true; detail = String(error); }
      const value = await this.state.storage.get("quota-proof");
      return Response.json({ rejected, detail, absent: value === undefined,
        storedBytes: typeof value === "string" ? new TextEncoder().encode(value).length : 0 });
    }
    if (url.pathname === "/control/hold-auto-alarm") {
      if (this.notifier) return new Response("already loaded", { status: 409 });
      await this.state.storage.put("proof/hold-auto-alarm", true);
      return Response.json({ held: true });
    }
    if (url.pathname === "/control/arm-head-fault") {
      if (this.notifier) return new Response("already loaded", { status: 409 });
      const key = "proof-controls/head-fault/" + crypto.randomUUID() + ".json";
      await this.env.TAKOS_OFFLOAD.put(key, JSON.stringify({
        armed: true, fired: false, successfulR2Puts: 0, headFailures: 0,
      }));
      await this.state.storage.put("proof/head-fault-key", key);
      return Response.json({ armed: true });
    }
    if (url.pathname === "/control/head-fault") {
      const key = await this.state.storage.get("proof/head-fault-key");
      const object = typeof key === "string" ? await this.env.TAKOS_OFFLOAD.get(key) : null;
      return Response.json({ value: object ? await object.json() : null });
    }
    if (url.pathname === "/control/arm-create-race") {
      if (this.notifier) return new Response("already loaded", { status: 409 });
      const { key, bytesBase64 } = await request.json();
      await this.state.storage.put("proof/create-race", {
        armed: true, injected: false, key, bytesBase64, competingBytes: 0,
        conditionalReturnedNull: null,
      });
      return Response.json({ armed: true });
    }
    if (url.pathname === "/control/create-race") {
      return Response.json({ value: await this.state.storage.get("proof/create-race") });
    }
    this.notifier ??= this.createNotifier();
    if (url.pathname.startsWith("/invoke/")) {
      const ws = { send() {}, close() {} };
      switch (url.pathname) {
        case "/invoke/alarm": await this.notifier.alarm(); break;
        case "/invoke/websocket-message": await this.notifier.webSocketMessage(ws, "ping"); break;
        case "/invoke/websocket-close": await this.notifier.webSocketClose(ws); break;
        case "/invoke/websocket-error": await this.notifier.webSocketError(ws, "probe"); break;
        default: return new Response("bad fixture route", { status: 404 });
      }
      return Response.json({ invoked: true });
    }
    if (!url.pathname.startsWith("/do/")) return new Response("bad fixture route", { status: 404 });
    url.pathname = url.pathname.slice(3);
    return this.notifier.fetch(new Request(url, request));
  }
}
export class RunHarness extends Harness {
  constructor(state, env) { super(state, env, RunNotifierDO, "run"); }
}
export class NotificationHarness extends Harness {
  constructor(state, env) { super(state, env, NotificationNotifierDO, "notification"); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = /^\\/(run|notification)\\/([^/]+)(\\/.*)$/.exec(url.pathname);
    if (!match) return new Response("bad route", { status: 404 });
    url.pathname = match[3];
    const namespace = match[1] === "run" ? env.RUN : env.NOTIFICATION;
    try {
      return await namespace.getByName(match[2]).fetch(new Request(url, request));
    } catch (error) {
      return Response.json({ nativeError: String(error) }, { status: 599 });
    }
  }
};
`;
}

type Kind = "run" | "notification";
type MiniflareInstance = InstanceType<typeof Miniflare>;
type NativeResponse = Awaited<ReturnType<MiniflareInstance["dispatchFetch"]>>;
type NativeBucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options?: { httpMetadata: { contentEncoding: string; contentType: string } }): Promise<unknown>;
};

async function nativeBucket(mf: MiniflareInstance): Promise<NativeBucket> {
  // This Miniflare release's ReplaceWorkersTypes declaration collapses R2Bucket
  // to Request; verify the live binding shape before using its real methods.
  const binding: unknown = await mf.getR2Bucket("TAKOS_OFFLOAD");
  assert(binding !== null && typeof binding === "object" &&
    typeof Reflect.get(binding, "get") === "function" &&
    typeof Reflect.get(binding, "put") === "function", "native R2 binding lacks get/put");
  return binding as NativeBucket;
}

async function request(
  mf: MiniflareInstance,
  kind: Kind,
  name: string,
  path: string,
  body?: unknown,
): Promise<NativeResponse> {
  const init = body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  return mf.dispatchFetch(`http://localhost/${kind}/${name}${path}`, init);
}

async function seed(mf: MiniflareInstance, kind: Kind, name: string, value: unknown): Promise<void> {
  const response = await request(mf, kind, name, "/control/seed", { value });
  assert(response.status === 200, `${kind}/${name}: seed status ${response.status}`);
}

async function inspectDetails(mf: MiniflareInstance, kind: Kind, name: string): Promise<{ value: unknown; instanceId: string }> {
  const response = await request(mf, kind, name, "/control/inspect");
  assert(response.status === 200, `${kind}/${name}: inspect status ${response.status}`);
  return await response.json() as { value: unknown; instanceId: string };
}

async function inspect(mf: MiniflareInstance, kind: Kind, name: string): Promise<unknown> {
  return (await inspectDetails(mf, kind, name)).value;
}

async function evict(mf: MiniflareInstance, kind: Kind, name: string): Promise<void> {
  await mf.unsafeEvictDurableObject(
    scriptName,
    kind === "run" ? "RunHarness" : "NotificationHarness",
    { name },
  );
}

async function archivedBytes(mf: MiniflareInstance, runId: string): Promise<Uint8Array> {
  const bucket = await nativeBucket(mf);
  const object = await bucket.get(`runs/${runId}/events/000001.jsonl.gz`);
  assert(object !== null, `${runId}: original R2 archive missing`);
  return new Uint8Array(await object.arrayBuffer());
}

async function controlValue<T>(mf: MiniflareInstance, name: string, path: string): Promise<T> {
  const response = await request(mf, "run", name, path);
  assert(response.status === 200, `${name}${path}: control status ${response.status}`);
  return (await response.json() as { value: T }).value;
}

async function decodedRunState(mf: MiniflareInstance, name: string): Promise<Record<string, unknown>> {
  return await controlValue<Record<string, unknown>>(mf, name, "/control/snapshot");
}

async function settlePostCommit(
  mf: MiniflareInstance,
  name: string,
  expectedNativeError?: string,
): Promise<number> {
  const settled = await request(mf, "run", name, "/control/settled");
  const body = await settled.text();
  if (settled.status !== 200) {
    // A throwing native blockConcurrencyWhile resets the object and can abort
    // this concurrent observer. Only the deliberately injected head fault is
    // admissible; its exact durable witnesses and replacement are checked below.
    assert(expectedNativeError !== undefined && settled.status === 599 &&
      (JSON.parse(body) as { nativeError?: unknown }).nativeError === expectedNativeError,
    `run/${name}: post-commit lifecycle status${settled.status}: ${body}`);
  }
  return settled.status;
}

async function proveHeadFailureRetry(mf: MiniflareInstance): Promise<string> {
  const name = `run-head-retry-${randomUUID().slice(0, 8)}`;
  await seed(mf, "run", name, runSnapshot(name));
  const armed = await request(mf, "run", name, "/control/arm-head-fault");
  assert(armed.status === 200, "run/head-retry: fault was not armed");
  const preFaultId = (await inspectDetails(mf, "run", name)).instanceId;
  const first = await request(mf, "run", name, "/do/emit", {
    type: "completed", data: { attempt: "first" }, runId: name, dedup_key: "head-retry-first",
  });
  assert(first.status === 200 && (await first.json() as { eventId?: number }).eventId === 1,
    "run/head-retry: emit was not durably accepted before best-effort drain");
  const lifecycleStatus = await settlePostCommit(mf, name, headFaultNativeError);
  const fault = await controlValue<{
    fired: boolean; successfulR2Puts: number; headFailures: number;
  }>(mf, name, "/control/head-fault");
  const firstArchive = await archivedBytes(mf, name);
  const pending = await decodedRunState(mf, name);
  assert(fault.fired && fault.successfulR2Puts === 1 && fault.headFailures === 1,
    `run/head-retry: exact R2-then-head fault was not observed: ${JSON.stringify(fault)}`);
  const intents = pending.flushIntents as Array<{
    kind: string; key: string; count: number; blob: { digest: string; bytes: number };
  }>;
  const events = pending.r2SegmentBuffer as Array<{ event_id: number; type: string; data: string }>;
  const ring = pending.eventBuffer as Array<{ id: number; type: string; data: unknown }>;
  assert(pending.eventIdCounter === 1 &&
    pending.r2LastFlushedSegmentIndex === 0 &&
    intents.length === 1 && intents[0]?.kind === "run" && intents[0].count === 1 &&
    intents[0].key === `runs/${name}/events/000001.jsonl.gz` &&
    intents[0].blob.digest === hash(firstArchive) && intents[0].blob.bytes === firstArchive.byteLength &&
    events.length === 1 && events[0]?.event_id === 1 && events[0].type === "completed" &&
    events[0].data === JSON.stringify({ attempt: "first" }) &&
    ring.length === 1 && ring[0]?.id === 1 && ring[0].type === "completed" &&
    JSON.stringify(ring[0].data) === events[0].data,
    "run/head-retry: committed pending intent missing after head fault");
  const beforeId = (await inspectDetails(mf, "run", name)).instanceId;
  if (lifecycleStatus === 599) assert(beforeId !== preFaultId,
    "run/head-retry: injected native observer error did not replace the object");
  await evict(mf, "run", name);
  const afterId = (await inspectDetails(mf, "run", name)).instanceId;
  assert(beforeId !== afterId, "run/head-retry: native eviction did not replace object");
  const retry = await request(mf, "run", name, "/invoke/alarm");
  assert(retry.status === 200, `run/head-retry: cold retry status ${retry.status}`);
  const settled = await decodedRunState(mf, name);
  const retryArchive = await archivedBytes(mf, name);
  assert(hash(retryArchive) === hash(firstArchive), "run/head-retry: existing gzip changed on cold retry");
  assert(settled.eventIdCounter === 1 &&
    (settled.flushIntents as unknown[]).length === 0 &&
    (settled.r2SegmentBuffer as unknown[]).length === 0 &&
    settled.r2LastFlushedSegmentIndex === 1,
    "run/head-retry: cold retry did not durably retire exact intent");
  console.error(JSON.stringify({ witness: "current/head-failure-cold-retry", firstHttp: first.status,
    retryHttp: retry.status, lifecycleStatus, fault, preFaultInstance: preFaultId,
    beforeInstance: beforeId, afterInstance: afterId,
    archiveFirstSha256: hash(firstArchive), archiveAfterSha256: hash(retryArchive),
    archiveBytes: firstArchive.byteLength }));
  return `run/head-failure-cold-retry: real R2 put succeeded, injected head put failed once, native observer ${lifecycleStatus}, exact head/R2 witness retained, cold retry preserved exact gzip and retired intent`;
}

async function proveConditionalCreateRace(mf: MiniflareInstance, competing: Uint8Array): Promise<string> {
  const name = `run-create-race-${randomUUID().slice(0, 8)}`;
  const key = `runs/${name}/events/000001.jsonl.gz`;
  await seed(mf, "run", name, runSnapshot(name));
  const armed = await request(mf, "run", name, "/control/arm-create-race", {
    key, bytesBase64: Buffer.from(competing).toString("base64"),
  });
  assert(armed.status === 200, "run/create-race: fault was not armed");
  const emit = await request(mf, "run", name, "/do/emit", {
    type: "completed", data: { intended: true }, runId: name,
  });
  await settlePostCommit(mf, name);
  const race = await controlValue<{
    injected: boolean; competingBytes: number; conditionalReturnedNull: boolean | null;
  }>(mf, name, "/control/create-race");
  const archived = await archivedBytes(mf, name);
  const pending = await decodedRunState(mf, name);
  console.error(JSON.stringify({ witness: "current/conditional-create-race", emitHttp: emit.status,
    injected: race.injected, competingBytes: race.competingBytes,
    conditionalReturnedNull: race.conditionalReturnedNull,
    competingSha256: hash(competing), archivedSha256: hash(archived),
    pendingIntents: (pending.flushIntents as unknown[]).length }));
  assert(emit.status === 200 && race.injected && race.competingBytes === competing.byteLength,
    "run/create-race: did not place competing bytes immediately before native conditional put");
  assert(race.conditionalReturnedNull === true,
    "run/create-race: native conditional put did not report failed precondition");
  assert(hash(archived) === hash(competing), "run/create-race: native conditional create overwrote competing bytes");
  assert(pending.eventIdCounter === 1 && (pending.flushIntents as unknown[]).length === 1,
    "run/create-race: pending intent was not durably retained");
  const beforeId = (await inspectDetails(mf, "run", name)).instanceId;
  await evict(mf, "run", name);
  const afterId = (await inspectDetails(mf, "run", name)).instanceId;
  assert(beforeId !== afterId, "run/create-race: native eviction did not replace object");
  const retry = await request(mf, "run", name, "/invoke/alarm");
  assert(retry.status === 200, "run/create-race: cold retry alarm failed");
  const after = await decodedRunState(mf, name);
  assert(hash(await archivedBytes(mf, name)) === hash(competing) &&
    (after.flushIntents as unknown[]).length === 1,
    "run/create-race: cold retry overwrote competitor or lost pending intent");
  return "run/conditional-create-race: native onlyIf refused overwrite; competing gzip intact and current intent retained across eviction";
}

async function proveRejected(
  mf: MiniflareInstance,
  kind: Kind,
  label: string,
  value: unknown,
  archive: Uint8Array,
): Promise<string> {
  const name = `${kind}-${label}-${randomUUID().slice(0, 8)}`;
  const seededValue = kind === "run" && value && typeof value === "object" && !Array.isArray(value)
    ? { ...value, runId: name }
    : value;
  if (kind === "run") {
    const bucket = await nativeBucket(mf);
    await bucket.put(`runs/${name}/events/000001.jsonl.gz`, archive, {
      httpMetadata: { contentEncoding: "gzip", contentType: "application/x-ndjson" },
    });
  }
  await seed(mf, kind, name, seededValue);
  const before = await inspect(mf, kind, name);
  assert(JSON.stringify(before) === JSON.stringify(seededValue), `${kind}/${label}: native seed changed value`);
  const paths = [
    "/do/state", "/do/events", "/do/emit",
    ...(kind === "run" ? ["/do/usage"] : []),
    "/invoke/alarm", "/invoke/websocket-message", "/invoke/websocket-close", "/invoke/websocket-error",
  ];
  for (const path of paths) {
    // A failed blockConcurrencyWhile may reset the wrapper. Inspect through a
    // separate control request after every attempt; do not infer nonmutation
    // from an HTTP failure alone.
    await evict(mf, kind, name);
    const response = await request(mf, kind, name, path, path.endsWith("/emit")
      ? { type: "completed", data: { probe: label }, runId: name }
      : path.endsWith("/usage")
      ? { runId: name, meter_type: "proof", units: 1 }
      : undefined);
    assert(response.status >= 500, `${kind}/${label}${path}: guard returned ${response.status}`);
    const after = await inspect(mf, kind, name);
    assert(JSON.stringify(after) === JSON.stringify(before), `${kind}/${label}${path}: native KV mutated`);
    if (kind === "run") {
      assert(hash(await archivedBytes(mf, name)) === hash(archive), `${kind}/${label}${path}: R2 archive changed`);
    }
  }
  return `${kind}/${label}: ${paths.length} rejected entrypoints, KV unchanged${kind === "run" ? ", R2 gzip unchanged" : ""}`;
}

async function proveHealthy(mf: MiniflareInstance, kind: Kind, archive: Uint8Array): Promise<string> {
  const name = `${kind}-healthy-${randomUUID().slice(0, 8)}`;
  const value = kind === "run" ? runSnapshot(name, 100) : notificationSnapshot(100);
  if (kind === "run") {
    const bucket = await nativeBucket(mf);
    await bucket.put(`runs/${name}/events/000001.jsonl.gz`, archive);
  }
  await seed(mf, kind, name, value);
  if (kind === "run") {
    const held = await request(mf, kind, name, "/control/hold-auto-alarm");
    assert(held.status === 200, "run: could not hold native timed alarm for explicit migration steps");
  }
  await evict(mf, kind, name);
  const state = await request(mf, kind, name, "/do/state");
  assert(state.status === 200, `${kind}: historical state load status ${state.status}`);
  assert((await state.json() as { lastEventId: number }).lastEventId === 100, `${kind}: counter 100 not restored`);
  if (kind === "run") {
    const duplicate = await request(mf, kind, name, "/do/emit", {
      type: "run.progress", data: { probe: true }, runId: name, dedup_key: "already-seen",
    });
    assert(duplicate.status === 200 && (await duplicate.json() as { duplicate?: boolean }).duplicate === true,
      "run: historical dedup key not restored");
    assert(JSON.stringify(await inspect(mf, kind, name)) === JSON.stringify(value), "run: duplicate mutated state");
    const fenced = await request(mf, kind, name, "/do/emit", {
      type: "completed", data: { proof: true }, runId: name, dedup_key: "fresh-key",
    });
    const fencedBody = await fenced.json() as { success?: boolean; error?: string };
    assert(fenced.status === 503 && fencedBody.success === false &&
      fencedBody.error === "Run receipt index is building; retry later",
      `run: expected exact legacy receipt-building fence, got ${fenced.status}: ${JSON.stringify(fencedBody)}`);
    assert(JSON.stringify(await inspect(mf, kind, name)) === JSON.stringify(value) &&
      hash(await archivedBytes(mf, name)) === hash(archive),
      "run: fenced fresh emit changed legacy state or R2 archive");
    let ready: Record<string, unknown> | undefined;
    for (let step = 0; step < 3; step++) {
      const migrated = await request(mf, kind, name, "/invoke/alarm");
      assert(migrated.status === 200,
        `run: explicit receipt bootstrap alarm ${step + 1} returned ${migrated.status}`);
      const snapshot = await decodedRunState(mf, name);
      const index = snapshot.receiptIndex as { phase: string };
      assert(snapshot.eventIdCounter === 100 && snapshot.runId === name &&
        (index.phase === "building" || index.phase === "ready") &&
        hash(await archivedBytes(mf, name)) === hash(archive),
        `run: receipt bootstrap step ${step + 1} changed historical counter, identity or R2`);
      if (index.phase === "ready") {
        ready = snapshot;
        break;
      }
    }
    assert(ready !== undefined, "run: three planned receipt bootstrap alarms did not publish ready root");
    const root = (ready.receiptIndex as { root: {
      hash: string | null; entries: number; first: { namespace: string; key: string } | null;
      last: { namespace: string; key: string } | null;
    } }).root;
    assert(typeof root.hash === "string" && /^[a-f0-9]{64}$/.test(root.hash) &&
      root.entries === 1 && root.first?.namespace === "emit" &&
      root.first.key === "already-seen" && root.last?.key === "already-seen" &&
      Array.isArray(ready.emitDedupKeys) && ready.emitDedupKeys.length === 0,
      "run: ready receipt root does not authenticate the historical opaque key");
    const migratedDuplicate = await request(mf, kind, name, "/do/emit", {
      type: "run.progress", data: { probe: true }, runId: name, dedup_key: "already-seen",
    });
    assert(migratedDuplicate.status === 200 &&
      (await migratedDuplicate.json() as { duplicate?: boolean }).duplicate === true,
      "run: authenticated historical key no longer returns duplicate after migration");
    assert((await decodedRunState(mf, name)).eventIdCounter === 100,
      "run: historical duplicate advanced event counter after migration");
  }
  const emitted = await request(mf, kind, name, "/do/emit", {
    type: kind === "run" ? "completed" : "notification.created",
    data: { proof: true },
    ...(kind === "run" ? { runId: name, dedup_key: "fresh-key" } : {}),
  });
  if (emitted.status !== 200) {
    throw new Error(`${kind}: healthy emit status ${emitted.status}: ${await emitted.text()}`);
  }
  assert((await emitted.json() as { eventId?: number }).eventId === 101, `${kind}: expected event 101`);
  const head = await inspect(mf, kind, name) as Record<string, unknown>;
  const decoded = await request(mf, kind, name, "/control/snapshot");
  assert(decoded.status === 200, `${kind}: journal snapshot unreadable`);
  const persisted = (await decoded.json() as { value: Record<string, unknown> }).value;
  assert(head.schemaVersion === 2 && persisted.schemaVersion === (kind === "run" ? 5 : 2) &&
    persisted.eventIdCounter === 101,
    `${kind}: journal counter not persisted`);
  if (kind === "run") {
    const drained = await request(mf, kind, name, "/invoke/alarm");
    assert(drained.status === 200, "run: committed archive intent did not drain");
    assert(hash(await archivedBytes(mf, name)) === hash(archive), "run: historical archive changed");
    const bucket = await nativeBucket(mf);
    assert(await bucket.get(`runs/${name}/events/000002.jsonl.gz`) !== null, "run: new segment 2 absent");
  }
  const beforeEviction = (await inspectDetails(mf, kind, name)).instanceId;
  await evict(mf, kind, name);
  const afterEviction = (await inspectDetails(mf, kind, name)).instanceId;
  assert(afterEviction !== beforeEviction, `${kind}: native eviction did not create a new instance`);
  const coldState = await request(mf, kind, name, "/do/state");
  assert(coldState.status === 200 && (await coldState.json() as { lastEventId: number }).lastEventId === 101,
    `${kind}: cold replacement lost counter`);
  if (kind === "run") {
    const duplicate = await request(mf, kind, name, "/do/emit", {
      type: "completed", data: { proof: true }, runId: name, dedup_key: "fresh-key",
    });
    assert(duplicate.status === 200 && (await duplicate.json() as { duplicate?: boolean }).duplicate === true,
      "run: cold replacement lost dedup");
    assert(hash(await archivedBytes(mf, name)) === hash(archive), "run: cold replacement changed original archive");
    const indexed = await request(mf, kind, name,
      `/do/archive?runId=${name}&after=99&limit=2`);
    assert(indexed.status === 200, "run: cold native archive query failed");
    const page = await indexed.json() as { descriptors: Array<{ key: string; sha256: string;
      firstEventId: number; lastEventId: number }>; pending: unknown[]; hasMore: boolean };
    assert(page.descriptors.length === 2 && !page.hasMore && page.pending.length === 0 &&
      page.descriptors[0]?.key === `runs/${name}/events/000001.jsonl.gz` &&
      page.descriptors[0]?.sha256 === hash(archive) &&
      page.descriptors[0]?.lastEventId === 100 && page.descriptors[1]?.firstEventId === 101,
      "run: native indexed root/digest changed through eviction");
  }
  return `${kind}/historical-unversioned: event 101 persisted as v2 and survived native eviction${kind === "run" ? ", outer head with logical schema5, authenticated legacy receipt, dedup and R2 retained; indexed root2 retained" : ""}`;
}

async function proveChunkedState(mf: MiniflareInstance): Promise<string> {
  const name = `notification-chunks-${randomUUID().slice(0, 8)}`;
  const text = "🐙".repeat(50_000);
  await seed(mf, "notification", name, notificationSnapshot());
  const emitted = await request(mf, "notification", name, "/do/emit", {
    type: "notification.created", data: { text },
  });
  assert(emitted.status === 200, `native chunked emit status ${emitted.status}`);
  const chunksResponse = await request(mf, "notification", name, "/control/chunks");
  const chunks = await chunksResponse.json() as { count: number; maxSerializedBytes: number };
  const head = await inspect(mf, "notification", name) as {
    schemaVersion: number; snapshot: { bytes: number; chunks: string[] };
  };
  assert(head.schemaVersion === 2 && head.snapshot.bytes > 200_000 &&
    head.snapshot.chunks.length >= 4 && chunks.count >= 2 &&
    chunks.count <= head.snapshot.chunks.length && chunks.maxSerializedBytes < 90 * 1024,
    `native journal did not split large UTF-8 payload into bounded values: ${JSON.stringify(chunks)}`);
  const before = (await inspectDetails(mf, "notification", name)).instanceId;
  await evict(mf, "notification", name);
  const after = (await inspectDetails(mf, "notification", name)).instanceId;
  assert(before !== after, "native chunk proof did not replace the instance");
  const events = await request(mf, "notification", name, "/do/events");
  const replay = await events.json() as { events: Array<{ data: { text: string } }>; lastEventId: number };
  assert(events.status === 200 && replay.lastEventId === 1 && replay.events[0]?.data.text === text,
    "large native chunked payload changed through eviction");
  return `notification/chunks: 200000 UTF-8 payload bytes retained through eviction; ${chunks.count} chunks; max serialized value ${chunks.maxSerializedBytes} bytes`;
}

async function proveNativeQuota(mf: MiniflareInstance): Promise<string> {
  const name = `notification-quota-${randomUUID().slice(0, 8)}`;
  const response = await request(mf, "notification", name, "/control/quota");
  const result = await response.json() as { rejected: boolean; absent: boolean; detail: string; storedBytes: number };
  assert(response.status === 200 && (result.rejected
    ? result.absent && result.storedBytes === 0 && result.detail.includes("131072")
    : !result.absent && result.storedBytes === 133120),
    `native quota probe returned inconsistent write/read evidence: ${JSON.stringify(result)}`);
  return result.rejected
    ? "notification/quota: local legacy KV rejected oversized serialized value before mutation; production quota remains unqualified"
    : "notification/quota: local workerd accepted 133120 bytes despite useSQLite:false; production quota remains unqualified";
}

async function baselineSources(mode: "baseline-red" | "journal-baseline-red"): Promise<Map<string, string>> {
  const files = [
    "src/worker/runtime/durable-objects/notifier-base.ts",
    "src/worker/runtime/durable-objects/run-notifier.ts",
    "src/worker/runtime/durable-objects/notification-notifier.ts",
    ...(mode === "journal-baseline-red"
      ? ["src/worker/runtime/durable-objects/notifier-state.ts"] : []),
  ];
  const commit = mode === "journal-baseline-red"
    ? "fff1ff92276ffcf516521abd75c336c04712ab4b"
    : "3b79815f96b986eea138534f337c9580f49ab2d2";
  const result = new Map<string, string>();
  for (const file of files) {
    const child = Bun.spawnSync(["git", "show", `${commit}:${file}`], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(child.exitCode === 0, `cannot read baseline ${file}: ${new TextDecoder().decode(child.stderr)}`);
    result.set(join(root, file), new TextDecoder().decode(child.stdout));
  }
  return result;
}

async function proveBaselineRegression(mf: MiniflareInstance, archive: Uint8Array): Promise<string[]> {
  const observations: string[] = [];
  const bucket = await nativeBucket(mf);
  for (const label of ["future-v2", "null", "false"] as const) {
    const name = `run-baseline-${label}-${randomUUID().slice(0, 8)}`;
    const value = label === "future-v2" ? { ...runSnapshot(name), schemaVersion: 2 }
      : label === "null" ? null : false;
    await bucket.put(`runs/${name}/events/000001.jsonl.gz`, archive);
    await seed(mf, "run", name, value);
    await evict(mf, "run", name);
    const response = await request(mf, "run", name, "/do/emit", {
      type: "completed", data: { baseline: label }, runId: name,
    });
    const after = await inspect(mf, "run", name);
    const archiveAfter = await archivedBytes(mf, name);
    console.error(JSON.stringify({
      baseline: "3b79815", witness: `run/${label}`, httpStatus: response.status,
      kvBeforeSha256: hash(new TextEncoder().encode(JSON.stringify(value))),
      kvAfterSha256: hash(new TextEncoder().encode(JSON.stringify(after))),
      archiveBeforeSha256: hash(archive), archiveAfterSha256: hash(archiveAfter),
      archiveBeforeBytes: archive.byteLength, archiveAfterBytes: archiveAfter.byteLength,
    }));
    assert(response.status === 200, `baseline ${label}: old code did not accept emit (${response.status})`);
    assert(JSON.stringify(after) !== JSON.stringify(value), `baseline ${label}: KV unexpectedly unchanged`);
    assert(hash(archiveAfter) !== hash(archive), `baseline ${label}: original R2 archive unexpectedly unchanged`);
    observations.push(`3b79815 ${label}: native emit accepted; legacy KV and gzip100 R2 archive overwritten`);
  }
  const name = `notification-baseline-v2-${randomUUID().slice(0, 8)}`;
  const value = { ...notificationSnapshot(), schemaVersion: 2 };
  await seed(mf, "notification", name, value);
  await evict(mf, "notification", name);
  const response = await request(mf, "notification", name, "/do/emit", {
    type: "notification.created", data: { baseline: true },
  });
  const after = await inspect(mf, "notification", name);
  console.error(JSON.stringify({
    baseline: "3b79815", witness: "notification/future-v2", httpStatus: response.status,
    kvBeforeSha256: hash(new TextEncoder().encode(JSON.stringify(value))),
    kvAfterSha256: hash(new TextEncoder().encode(JSON.stringify(after))),
  }));
  assert(response.status === 200, `baseline notification: old code did not accept v2 (${response.status})`);
  assert(JSON.stringify(after) !== JSON.stringify(value),
    "baseline notification: KV unexpectedly unchanged");
  observations.push("3b79815 notification future-v2: native emit accepted and KV overwritten");
  return observations;
}

async function proveJournalBaselineRegression(mf: MiniflareInstance): Promise<string[]> {
  const name = `run-journal-baseline-${randomUUID().slice(0, 8)}`;
  await seed(mf, "run", name, runSnapshot(name));
  const armed = await request(mf, "run", name, "/control/arm-head-fault");
  assert(armed.status === 200, "journal baseline: head fault was not armed");
  const first = await request(mf, "run", name, "/do/emit", {
    type: "completed", data: { attempt: "first" }, runId: name,
  });
  const fault = await controlValue<{
    fired: boolean; successfulR2Puts: number; headFailures: number;
  }>(mf, name, "/control/head-fault");
  const archiveFirst = await archivedBytes(mf, name);
  const stateAfterFault = await inspect(mf, "run", name);
  const beforeId = (await inspectDetails(mf, "run", name)).instanceId;
  await evict(mf, "run", name);
  const afterId = (await inspectDetails(mf, "run", name)).instanceId;
  const second = await request(mf, "run", name, "/do/emit", {
    type: "completed", data: { attempt: "second" }, runId: name,
  });
  const archiveSecond = await archivedBytes(mf, name);
  const stateAfterSecond = await inspect(mf, "run", name);
  // Emit raw native observations before asserting the expected red witness.
  console.error(JSON.stringify({ baseline: "fff1ff92276ffcf516521abd75c336c04712ab4b",
    witness: "R2-success-head-failure-cold-overwrite", firstHttp: first.status,
    firstBody: await first.text(), secondHttp: second.status, secondBody: await second.text(),
    fault, beforeInstance: beforeId, afterInstance: afterId,
    stateAfterFaultSha256: hash(new TextEncoder().encode(JSON.stringify(stateAfterFault))),
    stateAfterSecondSha256: hash(new TextEncoder().encode(JSON.stringify(stateAfterSecond))),
    archiveFirstSha256: hash(archiveFirst), archiveSecondSha256: hash(archiveSecond),
    archiveFirstBytes: archiveFirst.byteLength, archiveSecondBytes: archiveSecond.byteLength }));
  assert(fault.fired && fault.successfulR2Puts === 1 && fault.headFailures === 1,
    "journal baseline: R2 success then head failure not reached");
  assert(beforeId !== afterId, "journal baseline: native cold replacement not observed");
  assert(JSON.stringify(stateAfterFault) === JSON.stringify(runSnapshot(name)),
    "journal baseline: failed head unexpectedly committed event");
  assert(second.status === 200, `journal baseline: cold second emit status ${second.status}`);
  assert(hash(archiveFirst) !== hash(archiveSecond),
    "journal baseline: cold retry did not overwrite first archived gzip");
  return ["fff1ff9/head-failure-cold-overwrite: R2 put succeeded before injected head failure; cold second emit overwrote first gzip at same key"];
}

export async function proveNotifierStateGuard(
  mode: "current" | "baseline-red" | "journal-baseline-red" = "current",
): Promise<{ runtime: string; observations: string[] }> {
  const tempParent = join(root, "tmp");
  await mkdir(tempParent, { recursive: true });
  const temp = await mkdtemp(join(tempParent, "notifier-state-proof-"));
  let mf: Miniflare | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> => cleaning ??= (async () => {
    try {
      if (mf) await mf.dispose();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  })();
  const onTerminate = () => {
    void cleanup().finally(() => process.exit(143));
    setTimeout(() => process.exit(143), 2_000).unref();
  };
  process.once("SIGTERM", onTerminate);
  const watchdog = setTimeout(() => {
    process.stderr.write("native notifier proof exceeded internal deadline\n");
    void cleanup().finally(() => process.exit(124));
    setTimeout(() => process.exit(124), 2_000).unref();
  }, deadlineMs);
  try {
    const entry = join(temp, "fixture.ts");
    await writeFile(entry, fixtureSource());
    const oldSources = mode === "current" ? undefined : await baselineSources(mode);
    const built = await Bun.build({
      entrypoints: [entry],
      outdir: temp,
      target: "browser",
      external: ["cloudflare:*", "node:*"],
      minify: false,
      ...(oldSources ? { plugins: [{
        name: "baseline-notifier-source",
        setup(build) {
          build.onLoad({ filter: /notifier-(?:base|state)\.ts$|(?:run|notification)-notifier\.ts$/ },
            (args) => {
              const contents = oldSources.get(args.path);
              return contents === undefined ? undefined : { contents, loader: "ts" };
            });
        },
      }] } : {}),
    });
    assert(built.success && built.outputs.length === 1,
      `fixture bundle failed: ${built.logs.map(String).join("; ")}`);
    const script = await readFile(built.outputs[0]!.path, "utf8");
    mf = new Miniflare({
      name: scriptName,
      modules: true,
      script,
      scriptPath: built.outputs[0]!.path,
      compatibilityDate: "2026-07-21",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: {
        RUN: { className: "RunHarness", useSQLite: false },
        NOTIFICATION: { className: "NotificationHarness", useSQLite: false },
      },
      durableObjectsPersist: join(temp, "do"),
      r2Buckets: { TAKOS_OFFLOAD: "native-proof-bucket" },
      r2Persist: join(temp, "r2"),
      host: "127.0.0.1",
    });
    await mf.ready;
    const archive = originalArchive();
    assert((archive.length > 0) && gzipSync("x").length > 0, "gzip fixture unavailable");
    if (mode === "baseline-red") {
      return {
        runtime: "Miniflare 4 / native workerd / legacy KV DO / local R2 / 3b79815 source",
        observations: await proveBaselineRegression(mf, archive),
      };
    }
    if (mode === "journal-baseline-red") {
      return {
        runtime: "Miniflare 4 / native workerd / legacy KV DO / local R2 / fff1ff9 source",
        observations: await proveJournalBaselineRegression(mf),
      };
    }
    const observations: string[] = [];
    for (const kind of ["run", "notification"] as const) {
      const base = kind === "run" ? runSnapshot("unused") : notificationSnapshot();
      for (const [label, value] of [
        ["future-v2", { ...base, schemaVersion: 2 }],
        ["future-v4", { ...base, schemaVersion: 4 }],
        ["null", null],
        ["false", false],
        ["zero", 0],
        ["empty-string", ""],
        ["malformed", { ...base, eventBuffer: "broken" }],
      ] as const) {
        observations.push(await proveRejected(mf, kind, label, value, archive));
      }
      observations.push(await proveHealthy(mf, kind, archive));
    }
    observations.push(await proveChunkedState(mf));
    observations.push(await proveNativeQuota(mf));
    observations.push(await proveHeadFailureRetry(mf));
    observations.push(await proveConditionalCreateRace(mf, archive));
    return { runtime: "Miniflare 4 / native workerd / legacy KV DO / local R2", observations };
  } finally {
    try {
      await cleanup();
    } finally {
      clearTimeout(watchdog);
      process.off("SIGTERM", onTerminate);
    }
  }
}

if (import.meta.main) {
  try {
    assert(Bun.argv.length === 2 || (Bun.argv.length === 3 &&
      (Bun.argv[2] === "--baseline-red" || Bun.argv[2] === "--journal-baseline-red")),
      "usage: bun scripts/prove-notifier-state-guard.ts [--baseline-red|--journal-baseline-red]");
    console.log(JSON.stringify(await proveNotifierStateGuard(Bun.argv[2] === "--baseline-red"
      ? "baseline-red" : Bun.argv[2] === "--journal-baseline-red"
      ? "journal-baseline-red" : "current"), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
