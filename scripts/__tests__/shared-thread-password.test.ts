import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Env } from "../../src/worker/shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../src/worker/shared/types/bindings.ts";

test("the actual shared-thread page keeps password access and latest-link state through delayed HTTP responses", async () => {
  if (process.env.TAKOS_SHARED_THREAD_UI_PROCESS === "1") {
    await verifyPasswordShare();
    return;
  }
  // Match the existing compiled Solid proof: isolate VM/browser state from the
  // server-side portable suite, with the build included in this test budget.
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_SHARED_THREAD_UI_PROCESS: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled shared-thread UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyPasswordShare() {
  const [
    { createClient }, { Hono }, { parseHTML }, { build }, { default: solid },
    { createContext, runInContext }, { ensureServerMigrations },
    { createPreparedStatement, createSequentialBatch }, { createMessage, createThread },
    { createThreadShare, revokeThreadShare }, { default: publicShares }, { isAppError },
  ] = await Promise.all([
    import("@libsql/client"), import("hono"), import("linkedom"), import("vite"),
    import("vite-plugin-solid"), import("node:vm"),
    import("../../src/worker/local-platform/d1-migrations.ts"),
    import("../../src/worker/local-platform/d1-prepared-statement.ts"),
    import("../../src/worker/application/services/threads/thread-service.ts"),
    import("../../src/worker/application/services/threads/thread-shares.ts"),
    import("../../src/worker/server/routes/public-share/routes.ts"),
    import("../../src/worker/platform-utils/errors.ts"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-shared-thread-ui-"));
  const anchor = createClient({ url: "file::memory:?cache=shared" });
  const client = createClient({ url: "file::memory:?cache=shared" });
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fixture: { dispose: () => void; setToken: (token: string) => void } | undefined;
  const releaseHeld: Array<() => void> = [];
  try {
    await ensureServerMigrations(client, resolve(import.meta.dir, "../../db/migrations-control/migrations"));
    const db = {
      prepare: (query: string) => createPreparedStatement(client, query),
      batch: createSequentialBatch(statement => statement.run()),
    } as SqlDatabaseBinding;
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO accounts (id, type, status, name, slug, created_at, updated_at) VALUES ('share-ui-owner', 'user', 'active', 'Share fixture', 'share-ui-owner', ?, ?)").bind(now, now).run();
    const thread = await createThread(db, "share-ui-owner", { title: "Shared password fixture" });
    expect(thread).not.toBeNull();
    const env = { DB: db } as Env;
    await createMessage(env, db, thread!, { role: "user", content: "Protected conversation contents" });
    const { share } = await createThreadShare({ db, threadId: thread!.id, spaceId: "share-ui-owner", createdBy: "share-ui-owner", mode: "password", password: "fixture-password" });
    const app = new Hono<{ Bindings: Env }>();
    app.onError((error, c) => {
      if (isAppError(error)) return c.json(error.toResponse(), error.statusCode as 401 | 403 | 404 | 429);
      throw error;
    });
    app.route("/api/public", publicShares);
    const requests: Array<{ method: string; status: number }> = [];
    let hold: { token: string; method: string; started: () => void; released: Promise<void> } | undefined;
    const holdResponse = (token: string, method: string) => {
      let markStarted!: () => void;
      let release!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      releaseHeld.push(release);
      hold = { token, method, started: markStarted, released };
      return { started, release };
    };
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const response = await app.fetch(request, env);
      requests.push({ method: request.method, status: response.status });
      if (hold && request.method === hold.method && new URL(request.url).pathname.split("/")[4] === hold.token) {
        const gate = hold;
        hold = undefined;
        gate.started();
        await gate.released;
      }
      return response;
    } });
    await build({
      configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent",
      plugins: [solid()], build: { outDir: output, minify: false,
        lib: { entry: resolve(import.meta.dir, "fixtures/shared-thread-password/client.tsx"), formats: ["iife"], name: "TakosShareTest", fileName: () => "client.js" },
      },
    });
    const { document, Event } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const storage = new Map<string, string>();
    const network: Array<{ token: string; method: string; closed: boolean }> = [];
    const scope: Record<string, unknown> = {
      document, console, URL, Headers, Request, Response, Blob, setTimeout, clearTimeout,
      setInterval, clearInterval, queueMicrotask, navigator: { language: "en" },
      location: { href: String(server.url), origin: server.url.origin },
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);
        const request = { token: url.pathname.split("/")[4], method: init?.method ?? "GET", closed: false };
        network.push(request);
        try {
          const response = await fetch(url, init);
          const readJson = response.json.bind(response);
          // Observe completion of the real HTTP body; keep its data and errors.
          response.json = async () => {
            try { return await readJson(); } finally { request.closed = true; }
          };
          return response;
        } catch (error) { request.closed = true; throw error; }
      },
      takosShareToken: share.token,
    };
    scope.window = scope; scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.takosShareFixture as { dispose: () => void; setToken: (token: string) => void };
    await waitFor(() => requests.some(request => request.method === "GET") && document.querySelector("h1") !== null);
    let password = document.querySelector<HTMLInputElement>("input[type=password]");
    expect(password).not.toBeNull();
    expect(document.body.textContent).not.toContain("Protected conversation contents");
    let button = document.querySelector<HTMLButtonElement>("button")!;
    password!.value = "wrong-password";
    password!.dispatchEvent(new Event("input", { bubbles: true }));
    button.dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => document.body.textContent?.includes("Invalid password") === true && !document.querySelector<HTMLButtonElement>("button")!.disabled);
    expect(requests.filter(request => request.method === "POST").map(request => request.status)).toEqual([403]);
    expect(document.body.textContent).toContain("Invalid password");
    // Loading can replace the DOM node; exercise the current visible control,
    // and require the user's input to survive rather than a node identity.
    password = document.querySelector<HTMLInputElement>("input[type=password]");
    expect(password).not.toBeNull();
    expect(password!.value).toBe("wrong-password");
    button = document.querySelector<HTMLButtonElement>("button")!;
    password!.value = "fixture-password";
    password!.dispatchEvent(new Event("input", { bubbles: true }));
    button.dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => requests.filter(request => request.method === "POST").length === 2 && document.body.textContent?.includes("Protected conversation contents") === true);
    expect(requests.filter(request => request.method === "POST").map(request => request.status)).toEqual([403, 200]);
    expect(document.querySelector("input[type=password]")).toBeNull();
    expect([...storage.values()].join(" ")).not.toContain("fixture-password");

    const oldThread = await createThread(db, "share-ui-owner", { title: "Old link" });
    const currentThread = await createThread(db, "share-ui-owner", { title: "Current link" });
    await createMessage(env, db, oldThread!, { role: "user", content: "OLD_LINK_CONTENT" });
    await createMessage(env, db, currentThread!, { role: "user", content: "CURRENT_LINK_CONTENT" });
    const old = await createThreadShare({ db, threadId: oldThread!.id, spaceId: "share-ui-owner", createdBy: "share-ui-owner", mode: "public" });
    const current = await createThreadShare({ db, threadId: currentThread!.id, spaceId: "share-ui-owner", createdBy: "share-ui-owner", mode: "public" });
    const oldGet = holdResponse(old.share.token, "GET");
    fixture.setToken(old.share.token);
    await oldGet.started;
    fixture.setToken(current.share.token);
    await waitFor(() => document.body.textContent?.includes("CURRENT_LINK_CONTENT") === true);
    oldGet.release();
    await waitFor(() => network.some(request => request.token === old.share.token && request.closed));
    expect(document.body.textContent).toContain("CURRENT_LINK_CONTENT");
    expect(document.body.textContent).not.toContain("OLD_LINK_CONTENT");

    // Returning to A does not make the first A request current again.
    const firstA = holdResponse(old.share.token, "GET");
    fixture.setToken(old.share.token);
    await firstA.started;
    const firstARequest = network.at(-1)!;
    fixture.setToken(current.share.token);
    await waitFor(() => document.body.textContent?.includes("CURRENT_LINK_CONTENT") === true);
    await createMessage(env, db, oldThread!, { role: "user", content: "NEWER_A_MESSAGE" });
    fixture.setToken(old.share.token);
    await waitFor(() => document.body.textContent?.includes("NEWER_A_MESSAGE") === true);
    firstA.release();
    await waitFor(() => firstARequest.closed);
    expect(document.body.textContent).toContain("NEWER_A_MESSAGE");

    // A real unavailable-share error must not erase a later valid link.
    const revoked = await createThreadShare({ db, threadId: oldThread!.id, spaceId: "share-ui-owner", createdBy: "share-ui-owner", mode: "public" });
    expect(await revokeThreadShare({ db, threadId: oldThread!.id, shareId: revoked.share.id })).toBe(true);
    const failedGet = holdResponse(revoked.share.token, "GET");
    fixture.setToken(revoked.share.token);
    await failedGet.started;
    const failedRequest = network.at(-1)!;
    fixture.setToken(current.share.token);
    await waitFor(() => document.body.textContent?.includes("CURRENT_LINK_CONTENT") === true);
    failedGet.release();
    await waitFor(() => failedRequest.closed);
    expect(document.body.textContent).toContain("CURRENT_LINK_CONTENT");
    expect(document.body.textContent).not.toContain("Not found");

    // An old unlock cannot stop the next link's loading or reuse its password.
    fixture.setToken(share.token);
    await waitFor(() => document.querySelector("input[type=password]") !== null);
    password = document.querySelector<HTMLInputElement>("input[type=password]")!;
    password.value = "fixture-password";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    const oldUnlock = holdResponse(share.token, "POST");
    document.querySelector<HTMLButtonElement>("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    await oldUnlock.started;
    const oldUnlockRequest = network.at(-1)!;
    const protectedCurrent = await createThreadShare({ db, threadId: currentThread!.id, spaceId: "share-ui-owner", createdBy: "share-ui-owner", mode: "password", password: "current-password" });
    const loadingCurrent = holdResponse(protectedCurrent.share.token, "GET");
    fixture.setToken(protectedCurrent.share.token);
    await loadingCurrent.started;
    oldUnlock.release();
    await waitFor(() => oldUnlockRequest.closed);
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Protected conversation contents");
    loadingCurrent.release();
    await waitFor(() => document.querySelector("input[type=password]") !== null);
    password = document.querySelector<HTMLInputElement>("input[type=password]")!;
    expect(password.value).toBe("");
    password.value = "current-password";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => document.body.textContent?.includes("CURRENT_LINK_CONTENT") === true);
    expect(document.body.textContent).not.toContain("Protected conversation contents");

    const retiredGet = holdResponse(old.share.token, "GET");
    fixture.setToken(old.share.token);
    await retiredGet.started;
    const retiredRequest = network.at(-1)!;
    fixture.dispose();
    retiredGet.release();
    await waitFor(() => retiredRequest.closed);
    expect(document.getElementById("root")!.textContent).toBe("");
  } finally {
    for (const release of releaseHeld) release();
    fixture?.dispose(); server?.stop(true); client.close(); anchor.close();
    await rm(output, { recursive: true, force: true });
  }
}

async function waitFor(ready: () => boolean) {
  const until = performance.now() + 5000;
  while (!ready()) {
    if (performance.now() > until) throw new Error("Timed out waiting for actual shared-thread UI/API state");
    await new Promise(done => setTimeout(done, 10));
  }
}
