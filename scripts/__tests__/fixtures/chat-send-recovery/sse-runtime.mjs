import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "vite";
import solid from "vite-plugin-solid";
import { parseHTML } from "linkedom";
import client from "undici";

const mode = process.argv[2];
assert.ok(["retryBackoff", "retryWireError", "retryWireMessage", "retryNewRun", "retryTransportError", "cap"].includes(mode));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const output = await mkdtemp(join(tmpdir(), "takos-sse-ui-"));
const previousOrigin = client.getGlobalOrigin();
const run = { id: "unrelated-run", thread_id: "thread-a", space_id: "space-a", root_thread_id: "thread-a", root_run_id: "unrelated-run", parent_run_id: null, child_thread_id: null, session_id: null, agent_type: "default", model: "synthetic-model", status: "queued", input: "{}", output: null, error: null, usage: "{}", started_at: null, completed_at: null, created_at: "2026-11-07T00:00:00Z" };
const otherRun = { ...run, id: "second-run", thread_id: "thread-b", root_thread_id: "thread-b", root_run_id: "second-run" };
const requests = [], sse = [], streams = new Set();
let runParses = 0, fixture;
const start = performance.now();
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const path = url.pathname;
  requests.push({ method: request.method, path, query: url.search, at: performance.now() });
  assert.equal(request.method, "GET");
  const json = (data) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(data)); };
  if (/^\/api\/runs\/(unrelated-run|second-run)\/sse$/.test(path)) {
    sse.push({ path, at: performance.now() });
    if (["retryWireError", "retryWireMessage"].includes(mode)) {
      const type = mode === "retryWireError" ? "error" : "message";
      const data = mode === "retryWireError" ? { error: "Synthetic Run failure" } : { content: "Streaming through the real SSE connection" };
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      streams.add(response); response.on("close", () => streams.delete(response));
      response.write(`id: 1\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    } else { response.writeHead(204); response.end(); }
    return;
  }
  if (/^\/api\/runs\/(unrelated-run|second-run)$/.test(path)) return json({ run: path.endsWith("second-run") ? otherRun : run });
  if (/^\/api\/threads\/thread-[ab]\/history$/.test(path)) {
    const thread = path.split("/")[3];
    return json({ messages: [{ id: `history-${thread}`, thread_id: thread, role: "user", content: thread === "thread-a" ? "Current A Run view" : "Current B Run view", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }], runs: [], focus: null, activeRun: thread === "thread-a" ? run : otherRun, pendingSessionDiff: null, taskContext: null });
  }
  if (/^\/api\/threads\/thread-[ab]\/messages$/.test(path)) return json({ messages: [{ id: "current-reply", thread_id: path.split("/")[3], role: "user", content: "Current Run messages", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }] });
  if (path === "/api/spaces/space-a/model") return json({ model: "synthetic-model", available_models: { openai: ["synthetic-model"], anthropic: [], google: [] } });
  if (path === "/api/me/settings") return json({ setup_completed: true, auto_update_enabled: false, private_account: false, activity_visibility: "private", ai_model: "synthetic-model", available_models: [] });
  if (path === "/api/spaces") return json({ spaces: [] });
  if (path === "/api/runtime/capabilities") return json({ capabilities: { vectorSearch: "disabled", agentContainers: "external-host" } });
  throw new Error(`Unexpected local request: ${request.method} ${path}`);
});
server.on("upgrade", (request, socket) => {
  assert.equal(request.url, "/api/runs/unrelated-run/ws");
  requests.push({ method: request.method, path: request.url, query: "", at: performance.now() });
  socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
});
try {
  await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  client.setGlobalOrigin(origin);
  await build({ configFile: false, root, logLevel: "silent", plugins: [solid()], build: { outDir: output, minify: false, lib: { entry: join(root, "scripts/__tests__/fixtures/chat-send-recovery/client.tsx"), formats: ["iife"], name: "ChatSseRecoveryTest", fileName: () => "client.js" } } });
  const { document, window, Event, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
  const storage = new Map();
  const location = { href: `${origin}/chat/space-a/thread-a`, origin, host: new URL(origin).host, protocol: "http:", pathname: "/chat/space-a/thread-a", search: "", assign(next) { this.href = next; } };
  const scope = {
    document, Event, HTMLElement, URL, URLSearchParams, Headers, Request, Response, Blob, File, FormData, AbortController, TextEncoder, TextDecoder, WebSocket: client.WebSocket, EventSource: client.EventSource, console, navigator: { language: "en" }, location, chatSendTestConfig: { auth: false, cancel: true }, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window), localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (input, init) => {
      const url = new URL(String(input), origin); assert.equal(url.origin, origin);
      const response = await fetch(url, init);
      if (/^\/api\/runs\/[^/]+$/.test(url.pathname)) { const json = response.json.bind(response); response.json = async () => { try { return await json(); } finally { runParses++; } }; }
      return response;
    },
  };
  scope.window = scope; scope.self = scope;
  runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
  fixture = scope.chatSendFixture;
  if (mode === "retryTransportError") {
    await until(() => fixture.state().error !== null || runParses >= 1); await sleep(0);
    assert.equal(fixture.state().error, null); assert.equal(fixture.state().loading, true); assert.equal(sse.length, 1);
  } else if (mode === "retryWireError") {
    await until(() => fixture.state().error === "Synthetic Run failure" && document.body.textContent.includes("Current Run messages"));
    assert.equal(fixture.state().loading, false); await sleep(2_050); assert.equal(sse.length, 1);
    assert.ok(document.body.textContent.includes("Synthetic Run failure"));
  } else if (mode === "retryWireMessage") {
    await until(() => fixture.state().streamingMessage === "Streaming through the real SSE connection");
    assert.equal(fixture.state().loading, true); assert.equal(fixture.state().error, null); assert.equal(sse.length, 1);
  } else if (mode === "cap") {
    await until(() => runParses >= 9, 150_000); await sleep(0);
    console.log(JSON.stringify({ observedSseAttempts: sse.length, runParses, loading: fixture.state().loading, errorVisible: !!fixture.state().error }));
    assert.equal(fixture.state().loading, false, "Ninth failed connection must exhaust eight retries");
    assert.equal(typeof fixture.state().error, "string"); assert.ok(fixture.state().error); assert.notEqual(fixture.state().error, "undefined");
    assert.ok(document.body.textContent.includes(fixture.state().error)); assert.equal(sse.length, 9);
    const history = requests.filter((request) => request.path.endsWith("/history"));
    assert.equal(history.filter((request) => !new URLSearchParams(request.query).has("root_run_id")).length, 1);
    assert.equal(history.filter((request) => new URLSearchParams(request.query).get("root_run_id") === "unrelated-run" && new URLSearchParams(request.query).get("include_messages") === "0").length, 1);
    assert.equal(history.length, 2); await sleep(2_050); assert.equal(sse.length, 9, "No tenth connection after exhaustion");
  } else {
    await until(() => sse.length >= 2); assert.equal(fixture.state().error, null); assert.equal(fixture.state().loading, true);
    await sleep(2_050); await until(() => sse.length >= 3);
    if (mode === "retryNewRun") {
      fixture.setThread("thread-b"); await until(() => document.body.textContent.includes("Current B Run view"));
      await until(() => sse.filter((attempt) => attempt.path.endsWith("/second-run/sse")).length >= 2);
      const current = sse.filter((attempt) => attempt.path.endsWith("/second-run/sse"));
      assert.ok(current[1].at - current[0].at < 3_000); assert.equal(fixture.state().loading, true); assert.equal(fixture.state().error, null);
    } else {
      await sleep(4_050); await until(() => sse.length >= 4);
      assert.ok(sse[3].at - sse[2].at >= 3_900, `Third retry gap was ${sse[3].at - sse[2].at}ms`);
      assert.equal(fixture.state().loading, true); assert.equal(fixture.state().error, null);
    }
  }
  assert.ok(requests.every((request) => request.method === "GET"));
  const result = { mode, pass: true, node: process.versions.node, sseAttempts: sse.length, runParses, actualGapsMs: sse.slice(1).map((attempt, i) => attempt.at - sse[i].at), seconds: (performance.now() - start) / 1000, qualification: "actual compiled UI with real local HTTP and installed standard SSE/WS clients; syntheticDTO, not genuine/auth/native/live" };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  await fixture?.idle(); fixture?.dispose(); for (const response of streams) response.destroy();
  server.closeAllConnections(); await new Promise((yes) => server.close(yes)); client.setGlobalOrigin(previousOrigin?.href);
  await rm(output, { recursive: true, force: true });
}
async function until(test, budget = 3_000) { const deadline = performance.now() + budget; while (!test()) { if (performance.now() > deadline) throw new Error("SSE recovery phase did not close"); await sleep(5); } }
