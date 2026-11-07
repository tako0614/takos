import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("initial ChatPage response retires login navigation with its route or component", async () => {
  if (process.env.TAKOS_CHAT_ROUTE_UI_PROCESS === "1") {
    await verifyRouteLifetime();
    return;
  }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_CHAT_ROUTE_UI_PROCESS: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled ChatPage UI: ${stderr.split("\n").filter((line) => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map((line) => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyRouteLifetime() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-chat-route-ui-"));
  type Gate = { reading: Promise<void>; read: () => void; release: () => void; released: Promise<void>; decoded: Promise<void>; decodedDone: () => void; status: number };
  const gates: Gate[] = [];
  const arm = (status: number): Gate => {
    let read!: () => void, release!: () => void, decodedDone!: () => void;
    const gate = { reading: new Promise<void>((yes) => { read = yes; }), released: new Promise<void>((yes) => { release = yes; }), decoded: new Promise<void>((yes) => { decodedDone = yes; }), status };
    const result = { ...gate, read, release, decodedDone };
    gates.push(result); return result;
  };
  let next: Gate | undefined;
  const attempts: { path: string; method: string }[] = [];
  const errors: string[] = [];
  const responses = new Map<string, Gate>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    attempts.push({ path, method: request.method });
    if (request.method === "GET" && /^\/api\/spaces\/space-[ab]\/model$/.test(path)) {
      return Response.json({ model: "synthetic-model", available_models: { openai: ["synthetic-model"], anthropic: [], google: [] } });
    }
    if (request.method !== "GET" || path !== "/api/threads/thread-a" || !next) {
      throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
    }
    const gate = next; next = undefined; responses.set(path, gate);
    const body = gate.status === 200
      ? { thread: { id: "thread-a", space_id: "workspace-a", title: "Retired thread", status: "active", created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z" } }
      : { error: { code: "UNAUTHORIZED", message: "Synthetic expired response" } };
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    // Send real HTTP headers and a JSON prefix, keeping response.json pending
    // until the route/component has retired. No decoder or transport model.
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        await gate.released;
        controller.enqueue(bytes.slice(1)); controller.close();
      },
    }), { status: gate.status, headers: { "content-type": "application/json" } });
  } });
  type Fixture = { setRoute: (route: { spaceId: string; threadId?: string }) => void; state: () => { route: { spaceId: string; threadId?: string }; events: string[] }; dispose: () => void };
  const disposers: (() => void)[] = [];
  try {
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/chat-page-route/client.tsx"), formats: ["iife"], name: "ChatRouteTest", fileName: () => "client.js" } },
    });
    const bundle = await readFile(join(output, "client.js"), "utf8");
    const mount = () => {
      const { document, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
      const storage = new Map<string, string>();
      const location = { href: `${server.url.origin}/chat/space-a/thread-a`, origin: server.url.origin, pathname: "/chat/space-a/thread-a", search: "?from=route-test" };
      const scope: Record<string, unknown> = {
        document, HTMLElement, URL, Headers, Request, Response, Blob, File, AbortController, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
        console: { log: () => {}, info: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args.map(String).join(" ")) },
        navigator: { language: "en" }, location,
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
        fetch: async (input: string | URL, init?: RequestInit) => {
          const url = new URL(String(input), server.url);
          if (url.origin !== server.url.origin) throw new Error("Non-loopback fixture request refused");
          const response = await fetch(url, init);
          const gate = responses.get(url.pathname);
          if (gate) {
            const readJson = response.json.bind(response);
            response.json = async () => { gate.read(); try { return await readJson(); } finally { gate.decodedDone(); } };
          }
          return response;
        },
      };
      scope.window = scope; scope.self = scope;
      runInContext(bundle, createContext(scope));
      const fixture = scope.chatRouteFixture as Fixture;
      disposers.push(fixture.dispose);
      return { fixture, document, location };
    };

    const stale = arm(401); next = stale;
    const first = mount(); await stale.reading;
    first.fixture.setRoute({ spaceId: "space-b" });
    first.location.pathname = "/chat/space-b";
    first.location.search = "";
    const bURL = `${server.url.origin}/chat/space-b`;
    first.location.href = bURL;
    stale.release(); await stale.decoded; await Bun.sleep(0);
    expect(first.location.href).toBe(bURL);
    expect(first.fixture.state()).toEqual({ route: { spaceId: "space-b" }, events: [] });
    expect(first.document.querySelector("textarea")).not.toBeNull();
    first.fixture.dispose();

    const live = arm(401); next = live;
    const second = mount(); await live.reading;
    live.release(); await live.decoded; await Bun.sleep(0);
    expect(second.location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a%3Ffrom%3Droute-test");
    second.fixture.dispose();

    const disposed = arm(401); next = disposed;
    const third = mount(); await disposed.reading;
    const originalURL = third.location.href;
    third.fixture.dispose();
    disposed.release(); await disposed.decoded; await Bun.sleep(0);
    expect(third.location.href).toBe(originalURL);

    const success = arm(200); next = success;
    const fourth = mount(); await success.reading;
    fourth.fixture.setRoute({ spaceId: "space-b" });
    success.release(); await success.decoded; await Bun.sleep(0);
    expect(fourth.fixture.state()).toEqual({ route: { spaceId: "space-b" }, events: [] });
    expect(fourth.document.body.textContent).not.toContain("Retired thread");
    expect(fourth.document.querySelector("textarea")).not.toBeNull();
    fourth.fixture.dispose();
    expect(attempts.filter(({ path }) => path === "/api/threads/thread-a")).toHaveLength(4);
    expect(attempts.every(({ path, method }) => method === "GET" && (/^\/api\/spaces\/space-[ab]\/model$/.test(path) || path === "/api/threads/thread-a"))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    for (const gate of gates) gate.release();
    for (const dispose of disposers) dispose();
    server.stop(true);
    await rm(output, { recursive: true, force: true });
  }
}
