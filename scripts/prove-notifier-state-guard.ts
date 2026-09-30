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
  return `import { RunNotifierDO } from ${runImport};
import { NotificationNotifierDO } from ${notificationImport};

class Harness {
  constructor(state, env, Notifier) {
    this.state = state;
    this.env = env;
    this.Notifier = Notifier;
    this.notifier = undefined;
    this.instanceId = crypto.randomUUID();
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
    this.notifier ??= new this.Notifier(this.state, this.env);
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
  constructor(state, env) { super(state, env, RunNotifierDO); }
}
export class NotificationHarness extends Harness {
  constructor(state, env) { super(state, env, NotificationNotifierDO); }
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
  }
  const emitted = await request(mf, kind, name, "/do/emit", {
    type: kind === "run" ? "completed" : "notification.created",
    data: { proof: true },
    ...(kind === "run" ? { runId: name, dedup_key: "fresh-key" } : {}),
  });
  assert(emitted.status === 200, `${kind}: healthy emit status ${emitted.status}`);
  assert((await emitted.json() as { eventId?: number }).eventId === 101, `${kind}: expected event 101`);
  const persisted = await inspect(mf, kind, name) as Record<string, unknown>;
  assert(persisted.schemaVersion === 1 && persisted.eventIdCounter === 101, `${kind}: v1 counter not persisted`);
  if (kind === "run") {
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
      type: "run.progress", data: { proof: true }, runId: name, dedup_key: "fresh-key",
    });
    assert(duplicate.status === 200 && (await duplicate.json() as { duplicate?: boolean }).duplicate === true,
      "run: cold replacement lost dedup");
    assert(hash(await archivedBytes(mf, name)) === hash(archive), "run: cold replacement changed original archive");
  }
  return `${kind}/historical-unversioned: event 101 persisted as v1 and survived native eviction${kind === "run" ? ", dedup and R2 retained" : ""}`;
}

async function baselineSources(): Promise<Map<string, string>> {
  const files = [
    "src/worker/runtime/durable-objects/notifier-base.ts",
    "src/worker/runtime/durable-objects/run-notifier.ts",
    "src/worker/runtime/durable-objects/notification-notifier.ts",
  ];
  const result = new Map<string, string>();
  for (const file of files) {
    const child = Bun.spawnSync(["git", "show", `3b79815f96b986eea138534f337c9580f49ab2d2:${file}`], {
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

export async function proveNotifierStateGuard(
  mode: "current" | "baseline-red" = "current",
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
    const oldSources = mode === "baseline-red" ? await baselineSources() : undefined;
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
    const observations: string[] = [];
    for (const kind of ["run", "notification"] as const) {
      const base = kind === "run" ? runSnapshot("unused") : notificationSnapshot();
      for (const [label, value] of [
        ["future-v2", { ...base, schemaVersion: 2 }],
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
    assert(Bun.argv.length === 2 || (Bun.argv.length === 3 && Bun.argv[2] === "--baseline-red"),
      "usage: bun scripts/prove-notifier-state-guard.ts [--baseline-red]");
    console.log(JSON.stringify(await proveNotifierStateGuard(Bun.argv[2] === "--baseline-red" ? "baseline-red" : "current"), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
