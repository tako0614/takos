import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createNativeContainerWorkerFixture } from "./lib/native-container-worker-fixture.mjs";

const root = resolve(import.meta.dir, "..");
type Entry = { attempt: number; stage: string; elapsedMs?: number; [key: string]: unknown };
const fixture = createNativeContainerWorkerFixture({ root, run: {
  runId: "run-local", containerId: "old-container", newContainerId: "new-container",
  serviceId: "old-service", ownerId: "owner", workspaceId: "workspace", threadId: "thread",
}, controllerToken: "private-controller-token", observerNonce: "nonce" });

function workerProbe(fetch: (request: Request) => Promise<Response>, options: { bearer?: string; loggerThrows?: boolean } = {}) {
  const declarations = fixture.indexOf("const oldTokenProbeTrace = [];");
  const declarationEnd = fixture.indexOf("function workerProducers()", declarations);
  const route = fixture.indexOf("if (path === '/__probe/old-token-probe' && request.method === 'POST') {");
  const routeEnd = fixture.indexOf("if (path === '/__probe/age-recovery'", route);
  assert(declarations >= 0 && declarationEnd > declarations, "old-token probe boundary diagnostics are missing");
  assert(route >= 0 && routeEnd > route, "old-token probe route is missing");
  const logs: string[] = [];
  let tick = 0;
  return { logs, ...runInNewContext(`
    ${fixture.slice(declarations, declarationEnd)}
    ({ invoke: async () => { ${fixture.slice(route, routeEnd)} },
       snapshot: () => ({ trace: oldTokenProbeTrace, dropped: oldTokenProbeTraceDropped }) })`, {
    path: "/__probe/old-token-probe", request: new Request("http://local/__probe/old-token-probe", { method: "POST" }),
    recoveryState: { nativeDestroyAcknowledged: true }, capturedOldBearer: options.bearer ?? "Bearer private-old-token",
    expectedRunId: "run-local", expectedContainerId: "old-container", trackedWebFetch: fetch,
    env: {}, ctx: {}, Request, Response, URL, Date, performance: { now: () => tick++ },
    requireValue(value: unknown, detail: string) { assert(value, detail); },
    console: { log(value: string) { if (options.loggerThrows) throw new Error("logger unavailable"); logs.push(value); } },
  }) as { invoke: () => Promise<Response>; snapshot: () => { trace: Entry[]; dropped: number } } };
}

const workerStages = (probe: ReturnType<typeof workerProbe>) => Array.from(probe.snapshot().trace, (entry) => entry.stage);
const completedStages = ["entered", "public-fetch-start", "public-fetch-returned", "body-read-start", "body-read-complete", "response-ready"];

test("actual generated old-token probe keeps the challenge and exposes two distinct safe boundary traces", async () => {
  const requests: Request[] = [];
  const probe = workerProbe(async (request) => { requests.push(request); return new Response(requests.length === 1 ? "Lease lost" : "Unauthorized", { status: requests.length === 1 ? 409 : 401 }); });
  assert.deepEqual(await (await probe.invoke()).json(), { status: 409, leaseLost: true });
  assert.deepEqual(await (await probe.invoke()).json(), { status: 401, leaseLost: false });
  assert.deepEqual(workerStages(probe), [...completedStages, ...completedStages]);
  assert.deepEqual(Array.from(probe.snapshot().trace, (entry) => entry.attempt), [...Array(6).fill(1), ...Array(6).fill(2)]);
  for (const request of requests) {
    assert.equal(request.url, "http://local/api/internal/v1/agent-control/run-status");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("Authorization"), "Bearer private-old-token");
    assert.equal(request.headers.get("X-Takos-Run-Id"), "run-local");
    assert.equal(request.headers.get("X-Takos-Executor-Tier"), "1");
    assert.equal(request.headers.get("X-Takos-Executor-Container-Id"), "old-container");
    assert.deepEqual(await request.json(), { runId: "run-local" });
  }
  for (const entry of probe.snapshot().trace) {
    assert.deepEqual(Object.keys(entry).sort(), ["at", "attempt", "elapsedMs", "stage"]);
    assert(Number.isFinite(entry.elapsedMs) && Number(entry.elapsedMs) >= 0);
    assert(!Number.isNaN(Date.parse(String(entry.at))));
  }
  assert(!JSON.stringify(probe.snapshot()).includes("private-old-token"));
  assert(!probe.logs.join("").includes("Lease lost"));
});

test("a pending internal production fetch stops the actual probe trace before any response/body marker", async () => {
  let release!: (response: Response) => void;
  const probe = workerProbe(() => new Promise<Response>((resolve) => { release = resolve; }));
  const pending = probe.invoke();
  assert.deepEqual(workerStages(probe), ["entered", "public-fetch-start"]);
  release(new Response("Unauthorized", { status: 401 }));
  await pending;
  assert.deepEqual(workerStages(probe), completedStages);
});

test("a pending body read is distinguished from a returned production fetch", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  const probe = workerProbe(async () => new Response(body, { status: 401 }));
  const pending = probe.invoke();
  await Promise.resolve();
  assert.deepEqual(workerStages(probe), completedStages.slice(0, 4));
  stream.enqueue(new TextEncoder().encode("Unauthorized")); stream.close();
  await pending;
  assert.deepEqual(workerStages(probe), completedStages);
});

test("fetch/body errors retain the original rejection without leaking their secret-bearing message", async () => {
  const failure = new Error("private-old-token body-and-error-secret");
  const fetchProbe = workerProbe(async () => { throw failure; });
  await assert.rejects(fetchProbe.invoke(), (error) => error === failure);
  assert.deepEqual(workerStages(fetchProbe), ["entered", "public-fetch-start", "failed"]);
  const bodyProbe = workerProbe(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.error(failure); },
  }), { status: 401 }));
  await assert.rejects(bodyProbe.invoke(), (error) => error === failure);
  assert.deepEqual(workerStages(bodyProbe), [...completedStages.slice(0, 4), "failed"]);
  for (const probe of [fetchProbe, bodyProbe]) assert(!JSON.stringify([probe.snapshot(), probe.logs]).includes("secret"));
});

test("missing old bearer still refuses before any public fetch and logger failure cannot mask rejection", async () => {
  let fetches = 0;
  const probe = workerProbe(async () => { fetches++; return new Response(); }, { bearer: "", loggerThrows: true });
  await assert.rejects(probe.invoke(), /old token unavailable before native death/u);
  assert.equal(fetches, 0);
  assert.deepEqual(workerStages(probe), ["entered", "failed"]);
});

test("diagnostic storage is bounded while the original public result remains usable", async () => {
  const probe = workerProbe(async () => new Response("Unauthorized", { status: 401 }), { loggerThrows: true });
  for (let index = 0; index < 8; index++) assert.equal((await (await probe.invoke()).json()).status, 401);
  assert.equal(probe.snapshot().trace.length, 32);
  assert.equal(probe.snapshot().dropped, 16);
});

function controllerProbe(dispatch: (...args: unknown[]) => Promise<Response>) {
  const source = readFileSync(resolve(root, "scripts/lib/native-container-recovery-controller.mjs"), "utf8");
  const start = source.indexOf("const staleStatuses = [];");
  const end = source.indexOf("assert((staleStatuses[0].status", start);
  assert(start >= 0 && end > start, "old-token controller loop is missing");
  const stages: Entry[] = [], budgets: number[] = [];
  return { stages, budgets, invoke: () => runInNewContext(`(async () => { ${source.slice(start, end)} return staleStatuses; })()`, {
    mf: { dispatchFetch: dispatch }, options: { callbackUrl: "http://local" }, controllerToken: "private-controller-token",
    stages, Date, Error,
    AbortSignal: { timeout(ms: number) { budgets.push(ms); return AbortSignal.timeout(ms); } },
    assert(value: unknown, message: string) { assert(value, message); },
  }) as Promise<{ status: number; leaseLost: boolean }[]> };
}

test("controller preserves both ten-second dispatches and records receipt/body boundaries separately", async () => {
  let calls = 0;
  const probe = controllerProbe(async () => Response.json({ status: ++calls === 1 ? 409 : 401, leaseLost: calls === 1 }));
  assert.deepEqual(Array.from(await probe.invoke(), (entry) => ({ ...entry })), [{ status: 409, leaseLost: true }, { status: 401, leaseLost: false }]);
  assert.deepEqual(probe.budgets, [10_000, 10_000]);
  assert.deepEqual(probe.stages.map((entry) => entry.stage), [...Array(2)].flatMap(() => ["old-token-probe-dispatch-start", "old-token-probe-response-received", "old-token-probe-body-read-start", "old-token-probe-body-read-complete"]));
  assert(!JSON.stringify(probe.stages).includes("private-controller-token"));
});

test("controller timeout and body failure record distinct phases and preserve the primary error", async () => {
  const failure = new DOMException("private failure message", "TimeoutError");
  const timedOut = controllerProbe(async () => { throw failure; });
  await assert.rejects(timedOut.invoke(), (error) => error === failure);
  assert.equal(timedOut.stages.at(-1)?.stage, "old-token-probe-failed");
  assert.equal(timedOut.stages.at(-1)?.phase, "dispatch");
  assert.equal(timedOut.stages.at(-1)?.timeout, true);
  const bodyFailed = controllerProbe(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.error(failure); },
  })));
  await assert.rejects(bodyFailed.invoke(), (error) => error === failure);
  assert.equal(bodyFailed.stages.at(-1)?.phase, "body-read");
  assert(!JSON.stringify([timedOut.stages, bodyFailed.stages]).includes("private failure message"));
});
