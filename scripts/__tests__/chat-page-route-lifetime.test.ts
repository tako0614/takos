import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("ChatPage thread, model and message reads retire with their view", async () => {
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
  type Gate = { reading: Promise<void>; read: () => void; release: () => void; released: Promise<void>; decoded: Promise<void>; decodedDone: () => void; status: number; body?: unknown };
  const gates: Gate[] = [];
  const armed = new Map<string, Gate>();
  const arm = (status: number, path = "/api/threads/thread-a", body?: unknown): Gate => {
    let read!: () => void, release!: () => void, decodedDone!: () => void;
    const gate = { reading: new Promise<void>((yes) => { read = yes; }), released: new Promise<void>((yes) => { release = yes; }), decoded: new Promise<void>((yes) => { decodedDone = yes; }), status };
    const result = { ...gate, read, release, decodedDone, body };
    gates.push(result); armed.set(path, result); return result;
  };
  const attempts: { path: string; method: string }[] = [];
  const errors: string[] = [];
  const responses = new Map<string, Gate>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    attempts.push({ path, method: request.method });
    const gate = armed.get(path);
    if (gate) { armed.delete(path); responses.set(path, gate); }
    else responses.delete(path);
    if (!gate && request.method === "GET" && /^\/api\/spaces\/space-[ab]\/model$/.test(path)) {
      return Response.json({ model: "synthetic-model", available_models: { openai: ["synthetic-model"], anthropic: [], google: [] } });
    }
    if (!gate && request.method === "GET" && path === "/api/threads/thread-a/messages") {
      return Response.json({ messages: [{ id: "message-a", sequence: 7 }], total: 2 });
    }
    if (request.method !== "GET" || !gate || !/^\/api\/(threads\/thread-a(?:\/messages)?|spaces\/space-a\/model)$/.test(path)) {
      throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
    }
    const body = gate.body ?? (gate.status === 200
      ? { thread: { id: "thread-a", space_id: "workspace-a", title: "Retired thread", status: "active", created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z" } }
      : { error: { code: "UNAUTHORIZED", message: "Synthetic expired response" } });
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
  type Route = { spaceId: string; threadId?: string; messageId?: string };
  type Fixture = { setRoute: (route: Route) => void; state: () => { route: Route; events: string[] }; toasts: () => { type: string; message: string }[]; dispose: () => void };
  const disposers: (() => void)[] = [];
  try {
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/chat-page-route/client.tsx"), formats: ["iife"], name: "ChatRouteTest", fileName: () => "client.js" } },
    });
    const bundle = await readFile(join(output, "client.js"), "utf8");
    const until = async (promise: Promise<void>, phase: string) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Unclosed fixture phase: ${phase}`)), 3000); })]);
      } finally { clearTimeout(timer); }
    };
    const mount = (route: Route = { spaceId: "space-a", threadId: "thread-a" }) => {
      const { document, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
      const storage = new Map<string, string>();
      const pathname = `/chat/${route.spaceId}${route.threadId ? `/${route.threadId}` : ""}`;
      const location = { href: `${server.url.origin}${pathname}`, origin: server.url.origin, pathname, search: "?from=route-test" };
      const traffic: string[] = [];
      const pending = new Set<Promise<void>>();
      let messageReads = 0, secondLookupDone!: () => void;
      const secondLookup = new Promise<void>((yes) => { secondLookupDone = yes; });
      const scope: Record<string, unknown> = {
        document, HTMLElement, URL, URLSearchParams, Headers, Request, Response, Blob, File, AbortController, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
        console: { log: () => {}, info: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args.map(String).join(" ")) },
        navigator: { language: "en" }, location, chatRouteConfig: route,
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
        fetch: async (input: string | URL, init?: RequestInit) => {
          const url = new URL(String(input), server.url);
          if (url.origin !== server.url.origin) throw new Error("Non-loopback fixture request refused");
          traffic.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
          let finish!: () => void;
          const done = new Promise<void>((yes) => { finish = yes; }); pending.add(done);
          const close = () => { pending.delete(done); finish(); };
          try {
            const response = await fetch(url, init);
            const gate = responses.get(url.pathname);
            const readJson = response.json.bind(response);
            response.json = async () => {
              gate?.read();
              try { return await readJson(); }
              finally {
                if (url.pathname === "/api/threads/thread-a/messages" && ++messageReads === 2) secondLookupDone();
                gate?.decodedDone(); close();
              }
            };
            return response;
          } catch (error) { close(); throw error; }
        },
      };
      scope.window = scope; scope.self = scope;
      runInContext(bundle, createContext(scope));
      const fixture = scope.chatRouteFixture as Fixture;
      disposers.push(fixture.dispose);
      const drain = async () => {
        // Close all this view's actual reads before arming a same-path body
        // for another view. A request from a prior mount cannot claim it.
        while (pending.size) {
          await until(Promise.all(pending).then(() => {}), "view response bodies closed");
          await Bun.sleep(0);
        }
      };
      return { fixture, document, location, traffic, drain, secondLookup };
    };

    const stale = arm(401);
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
    first.fixture.dispose(); await first.drain();

    const live = arm(401);
    const second = mount(); await live.reading;
    live.release(); await live.decoded; await Bun.sleep(0);
    expect(second.location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a%3Ffrom%3Droute-test");
    second.fixture.dispose(); await second.drain();

    const disposed = arm(401);
    const third = mount(); await disposed.reading;
    const originalURL = third.location.href;
    third.fixture.dispose();
    disposed.release(); await disposed.decoded; await Bun.sleep(0);
    expect(third.location.href).toBe(originalURL);
    await third.drain();

    const success = arm(200);
    const fourth = mount(); await success.reading;
    fourth.fixture.setRoute({ spaceId: "space-b" });
    success.release(); await success.decoded; await Bun.sleep(0);
    expect(fourth.fixture.state()).toEqual({ route: { spaceId: "space-b" }, events: [] });
    expect(fourth.document.body.textContent).not.toContain("Retired thread");
    expect(fourth.document.querySelector("textarea")).not.toBeNull();
    fourth.fixture.dispose(); await fourth.drain();
    expect(attempts.filter(({ path }) => path === "/api/threads/thread-a")).toHaveLength(4);
    expect(attempts.every(({ path, method }) => method === "GET" && (/^\/api\/spaces\/space-[ab]\/model$/.test(path) || path === "/api/threads/thread-a"))).toBe(true);
    expect(errors).toEqual([]);

    const settle = async (gate: Gate) => { gate.release(); await until(gate.decoded, "released body decoded"); await Bun.sleep(0); };
    const selectB = (view: ReturnType<typeof mount>) => {
      view.fixture.setRoute({ spaceId: "space-b" });
      view.location.pathname = "/chat/space-b"; view.location.search = "";
      view.location.href = `${server.url.origin}/chat/space-b`;
      return view.location.href;
    };
    const modelPath = "/api/spaces/space-a/model";
    const modelStale = arm(401, modelPath);
    const modelA = mount({ spaceId: "space-a" }); await until(modelStale.reading, "retired model body started");
    const modelBURL = selectB(modelA); await settle(modelStale);
    expect(modelA.location.href).toBe(modelBURL);
    expect(modelA.fixture.toasts()).toEqual([]);
    modelA.fixture.dispose(); await modelA.drain();

    const modelDisposed = arm(401, modelPath);
    const modelOwner = mount({ spaceId: "space-a" }); await until(modelDisposed.reading, "disposed model body started");
    const modelOriginalURL = modelOwner.location.href; modelOwner.fixture.dispose();
    await settle(modelDisposed); expect(modelOwner.location.href).toBe(modelOriginalURL);
    await modelOwner.drain();

    const modelLive = arm(401, modelPath);
    const modelCurrent = mount({ spaceId: "space-a" }); await until(modelLive.reading, "current model body started");
    await settle(modelLive);
    expect(modelCurrent.location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%3Ffrom%3Droute-test");
    modelCurrent.fixture.dispose(); await modelCurrent.drain();
    expect(errors).toEqual(["Failed to fetch space models: Error: Synthetic expired response"]);
    errors.length = 0;

    const modelSuccess = arm(200, modelPath, { model: "retired-model", available_models: { openai: ["retired-model"], anthropic: [], google: [] } });
    const lateModel = mount({ spaceId: "space-a" }); await until(modelSuccess.reading, "retired model success body started");
    selectB(lateModel); await settle(modelSuccess);
    expect(lateModel.document.body.textContent).not.toContain("retired-model");
    lateModel.fixture.dispose(); await lateModel.drain();

    // Keep the concurrent initial-thread body pending until disposal. This
    // executes the real message lookup without mounting an executor/ChatView.
    const messagesPath = "/api/threads/thread-a/messages";
    for (const mode of ["retired", "current", "disposed"] as const) {
      const pendingThread = arm(200);
      const messageFailure = arm(401, messagesPath);
      const view = mount({ spaceId: "space-a", threadId: "thread-a", messageId: "message-a" });
      try { await until(messageFailure.reading, `${mode} message failure body started`); }
      catch (error) {
        console.info("Message fixture readback", JSON.stringify({ mode, state: view.fixture.state(), traffic: view.traffic, toasts: view.fixture.toasts(), attempts: attempts.slice(-5), errors }));
        throw error;
      }
      const expectedURL = mode === "retired" ? selectB(view) : view.location.href;
      if (mode === "disposed") view.fixture.dispose();
      await settle(messageFailure);
      expect(view.location.href).toBe(mode === "current"
        ? "/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a%3Ffrom%3Droute-test" : expectedURL);
      expect(view.fixture.toasts()).toHaveLength(mode === "current" ? 1 : 0);
      view.fixture.dispose(); await settle(pendingThread); await view.drain();
    }

    for (const mode of ["retired", "current"] as const) {
      const pendingThread = arm(200);
      const page = arm(200, messagesPath, { messages: [{ id: "other-message", sequence: 1 }], total: 2 });
      const view = mount({ spaceId: "space-a", threadId: "thread-a", messageId: "message-a" });
      await until(page.reading, `${mode} message page body started`);
      if (mode === "retired") selectB(view);
      await settle(page);
      if (mode === "current") { await until(view.secondLookup, "current second lookup body decoded"); await Bun.sleep(0); }
      const lookups = view.traffic.filter((path) => path.startsWith(`GET ${messagesPath}?`));
      expect(lookups).toHaveLength(mode === "retired" ? 1 : 2);
      expect(lookups[0]).toContain("offset=0");
      if (mode === "current") expect(lookups[1]).toContain("offset=1");
      expect(view.fixture.toasts()).toEqual([]);
      view.fixture.dispose(); await settle(pendingThread); await view.drain();
    }
    expect(errors).toEqual([]);
    expect(attempts.every(({ path, method }) => method === "GET" && /^\/api\/(threads\/thread-a(?:\/messages)?|spaces\/space-[ab]\/model)$/.test(path))).toBe(true);
  } finally {
    for (const gate of gates) gate.release();
    for (const dispose of disposers) dispose();
    server.stop(true);
    await rm(output, { recursive: true, force: true });
  }
}
