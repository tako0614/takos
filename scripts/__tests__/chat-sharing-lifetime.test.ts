import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Env, User } from "../../src/worker/shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../src/worker/shared/types/bindings.ts";
import type { UseChatSharingReturn } from "../../web/src/hooks/useChatSharing.ts";

test("the actual chat sharing UI keeps current drafts, lists and effects through delayed HTTP responses", async () => {
  if (process.env.TAKOS_CHAT_SHARING_UI_PROCESS === "1") {
    await verifySharingLifetime();
    return;
  }
  // Keep browser globals out of the server suite, as in the other compiled
  // Solid tests. These budgets include the actual Vite build from the start.
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_CHAT_SHARING_UI_PROCESS: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled chat-sharing UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifySharingLifetime() {
  const [
    { createClient }, { Hono }, { parseHTML }, { build }, { default: solid },
    { createContext, runInContext }, { ensureServerMigrations },
    { createPreparedStatement, createSequentialBatch }, { createThread },
    { default: sharesRoutes }, { isAppError, AuthenticationError },
  ] = await Promise.all([
    import("@libsql/client"), import("hono"), import("linkedom"), import("vite"),
    import("vite-plugin-solid"), import("node:vm"),
    import("../../src/worker/local-platform/d1-migrations.ts"),
    import("../../src/worker/local-platform/d1-prepared-statement.ts"),
    import("../../src/worker/application/services/threads/thread-service.ts"),
    import("../../src/worker/server/routes/threads/shares.ts"),
    import("../../src/worker/platform-utils/errors.ts"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-chat-sharing-ui-"));
  const anchor = createClient({ url: "file::memory:?cache=shared" });
  const client = createClient({ url: "file::memory:?cache=shared" });
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fixture: { sharing: UseChatSharingReturn; setThread: (id: string) => void; dispose: () => void; toastCount: () => number; toastMessages: () => Array<{ type: string; message: string }>; clearToasts: () => void } | undefined;
  const releases: Array<() => void> = [];
  try {
    await ensureServerMigrations(client, resolve(import.meta.dir, "../../db/migrations-control/migrations"));
    const db = {
      prepare: (query: string) => createPreparedStatement(client, query),
      batch: createSequentialBatch(statement => statement.run()),
    } as SqlDatabaseBinding;
    const now = new Date().toISOString();
    const owner = "sharing-lifetime-owner";
    await db.prepare("INSERT INTO accounts (id, type, status, name, slug, created_at, updated_at) VALUES (?, 'user', 'active', ?, ?, ?, ?)").bind(owner, owner, owner, now, now).run();
    await db.prepare("INSERT INTO account_memberships (id, account_id, member_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?)").bind(`member_${owner}`, owner, owner, now, now).run();
    const a = await createThread(db, owner, { title: "Thread A" });
    const b = await createThread(db, owner, { title: "Thread B" });
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    const env = { DB: db } as Env;
    const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
    let authenticated = true;
    // Only the already-authenticated identity is synthetic. The actual share
    // routes, ownership checks, migrations, SQL and generated URLs are real.
    app.use("*", async (c, next) => {
      if (!authenticated) throw new AuthenticationError("Fixture session expired");
      c.set("user", { id: owner, email: "fixture@example.test", name: owner, username: owner,
        bio: null, picture: null, trust_tier: "normal", setup_completed: true, created_at: now, updated_at: now });
      await next();
    });
    app.onError((error, c) => {
      if (isAppError(error)) return c.json(error.toResponse(), error.statusCode as 400 | 401 | 403 | 404 | 500);
      throw error;
    });
    app.route("/api", sharesRoutes);
    const requests: Array<{ path: string; method: string; status: number }> = [];
    let hold: { path: string; method: string; started: () => void; released: Promise<void> } | undefined;
    const holdResponse = (path: string, method: string) => {
      let started!: () => void; let release!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      releases.push(release); hold = { path, method, started, released };
      return { entered, release };
    };
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const response = await app.fetch(request, env);
      requests.push({ path: new URL(request.url).pathname, method: request.method, status: response.status });
      if (hold && request.method === hold.method && new URL(request.url).pathname === hold.path) {
        const gate = hold; hold = undefined; gate.started(); await gate.released;
      }
      return response;
    } });
    await build({
      configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false,
        lib: { entry: resolve(import.meta.dir, "fixtures/chat-sharing/client.tsx"), formats: ["iife"], name: "TakosChatSharingTest", fileName: () => "client.js" },
      },
    });
    const { document, Event, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const storage = new Map<string, string>();
    const clipboard: string[] = [];
    let clipboardGate: { started: () => void; released: Promise<void>; error?: Error } | undefined;
    let bodyGate: { path: string; started: () => void; released: Promise<void> } | undefined;
    const scope: Record<string, unknown> = {
      document, HTMLElement, console, URL, Headers, Request, Response, Blob, setTimeout, clearTimeout,
      setInterval, clearInterval, queueMicrotask,
      navigator: { language: "en", clipboard: { writeText: async (value: string) => {
        clipboard.push(value);
        if (clipboardGate) {
          const gate = clipboardGate; clipboardGate = undefined; gate.started(); await gate.released;
          if (gate.error) throw gate.error;
        }
      } } },
      location: { href: String(server.url), origin: server.url.origin, pathname: "/chat", search: "" },
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);
        const response = await fetch(url, init);
        if (bodyGate && bodyGate.path === url.pathname) {
          const gate = bodyGate; bodyGate = undefined;
          const readJson = response.json.bind(response);
          // Hold only the completion of the real body read, preserving its
          // value/error. This observes the shared RPC helper's redirect effect.
          response.json = async () => {
            const data = await readJson(); gate.started(); await gate.released; return data;
          };
        }
        return response;
      },
      takosInitialThread: a!.id,
    };
    scope.window = scope; scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.takosSharingFixture as NonNullable<typeof fixture>;
    const ui = fixture.sharing;
    ui.setShowShareModal(true);
    await waitFor(() => !ui.sharesLoading() && document.querySelector("[role=dialog]") !== null);
    const delayedA = holdResponse(`/api/threads/${a!.id}/share`, "POST");
    const oldCreate = ui.createShare();
    await delayedA.entered;
    fixture.setThread(b!.id);
    await waitFor(() => !ui.sharesLoading());
    ui.setShareMode("password");
    const password = document.querySelector<HTMLInputElement>("input[type=password]")!;
    password.value = "B-draft-password";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    ui.setShareExpiresInDays("17");
    expect(password.value).toBe("B-draft-password");
    delayedA.release();
    await oldCreate;
    expect(document.querySelector<HTMLInputElement>("input[type=password]")!.value).toBe("B-draft-password");
    expect(ui.shareExpiresInDays()).toBe("17");
    expect(clipboard).toEqual([]);
    expect(ui.shareError()).toBeNull();
    const persistedA = await (await fetch(new URL(`/api/threads/${a!.id}/shares`, server.url))).json() as { shares: Array<{ id: string }> };
    expect(persistedA.shares.length).toBe(1);
    await ui.createShare();
    expect(ui.shares().length).toBe(1);
    expect(clipboard).toEqual([ui.shares()[0].share_url]);
    expect(ui.sharePassword()).toBe("");
    console.info("[chat-sharing] initial create/navigation closed");

    const createViaApi = async (id: string) => {
      const response = await fetch(new URL(`/api/threads/${id}/share`, server!.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "public" }),
      });
      expect(response.status).toBe(201);
      return await response.json() as { share: { id: string } };
    };
    const editDraft = (value: string, expiry: string) => {
      ui.setShareMode("password");
      const field = document.querySelector<HTMLInputElement>("input[type=password]")!;
      field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
      ui.setShareExpiresInDays(expiry);
    };

    // A→B→A must not give the first A list authority over the newer A list.
    fixture.setThread(a!.id);
    await waitFor(() => !ui.sharesLoading());
    const firstAList = holdResponse(`/api/threads/${a!.id}/shares`, "GET");
    const pendingAList = ui.fetchShares();
    await firstAList.entered;
    fixture.setThread(b!.id);
    await waitFor(() => !ui.sharesLoading());
    const addedA = await createViaApi(a!.id);
    fixture.setThread(a!.id);
    await waitFor(() => !ui.sharesLoading() && ui.shares().some(s => s.id === addedA.share.id));
    firstAList.release(); await pendingAList;
    expect(ui.shares().some(s => s.id === addedA.share.id)).toBe(true);

    // The same context can also have overlapping refreshes with different data.
    const olderRefresh = holdResponse(`/api/threads/${a!.id}/shares`, "GET");
    const pendingRefresh = ui.fetchShares();
    await olderRefresh.entered;
    const newerA = await createViaApi(a!.id);
    await ui.fetchShares();
    olderRefresh.release(); await pendingRefresh;
    expect(ui.shares().some(s => s.id === newerA.share.id)).toBe(true);
    console.info("[chat-sharing] list generations closed");

    // A real 400 after navigation cannot publish an error or toast into B.
    ui.setShareExpiresInDays("-1");
    const failedA = holdResponse(`/api/threads/${a!.id}/share`, "POST");
    const pendingFailure = ui.createShare();
    await failedA.entered;
    expect(requests.at(-1)!.status).toBe(400);
    fixture.setThread(b!.id);
    await waitFor(() => !ui.sharesLoading());
    editDraft("B-error-draft", "18"); fixture.clearToasts();
    failedA.release(); await pendingFailure;
    expect(ui.shareError()).toBeNull();
    expect(ui.sharePassword()).toBe("B-error-draft");
    expect(fixture.toastCount()).toBe(0);

    // Retiring A's request must not end B's in-progress create operation.
    fixture.setThread(a!.id);
    await waitFor(() => !ui.sharesLoading());
    const heldA = holdResponse(`/api/threads/${a!.id}/share`, "POST");
    const pendingOldCreate = ui.createShare();
    await heldA.entered;
    fixture.setThread(b!.id);
    await waitFor(() => !ui.sharesLoading());
    editDraft("B-pending-draft", "19");
    const heldB = holdResponse(`/api/threads/${b!.id}/share`, "POST");
    const pendingNewCreate = ui.createShare();
    await heldB.entered;
    const copiesBefore = clipboard.length;
    heldA.release(); await pendingOldCreate;
    expect(ui.creatingShare()).toBe(true);
    expect(ui.sharePassword()).toBe("B-pending-draft");
    expect(clipboard.length).toBe(copiesBefore);
    heldB.release(); await pendingNewCreate;
    expect(ui.creatingShare()).toBe(false);
    expect(clipboard.length).toBe(copiesBefore + 1);
    console.info("[chat-sharing] failure and overlapping creates closed");

    // Fields remain editable during a current request; do not clear newer edits.
    editDraft("sent-current-draft", "20");
    const currentCreate = holdResponse(`/api/threads/${b!.id}/share`, "POST");
    const pendingCurrent = ui.createShare();
    await currentCreate.entered;
    editDraft("newer-current-draft", "21");
    currentCreate.release(); await pendingCurrent;
    expect(ui.sharePassword()).toBe("newer-current-draft");
    expect(ui.shareExpiresInDays()).toBe("21");

    // A real current error remains visible, then a valid retry works normally.
    ui.setShareExpiresInDays("-1"); await ui.createShare();
    expect(ui.shareError()).toContain("between 1 and 365");
    expect(document.body.textContent).toContain("between 1 and 365");
    expect(ui.creatingShare()).toBe(false);
    ui.setShareExpiresInDays("22"); await ui.createShare();
    expect(ui.shareError()).toBeNull();
    expect(ui.creatingShare()).toBe(false);

    // A clipboard write already started while current cannot be rolled back.
    // After its ACK, however, it must not clear/refetch the newly selected A.
    // The successful password-share retry cleared its sent password. Prove
    // that this state is rejected, then supply a valid new draft before
    // waiting for the clipboard boundary (the real UI also disables Create).
    expect(ui.shareMode()).toBe("password");
    expect(ui.sharePassword()).toBe("");
    await ui.createShare();
    expect(ui.shareError()).toContain("Password is required");
    editDraft("copy-current-B-draft", "25");
    console.info("[chat-sharing] valid clipboard draft prepared");
    let copied!: () => void; let releaseCopy!: () => void;
    const copyStarted = new Promise<void>(resolve => { copied = resolve; });
    const copyReleased = new Promise<void>(resolve => { releaseCopy = resolve; });
    releases.push(releaseCopy); clipboardGate = { started: copied, released: copyReleased };
    const copyingB = ui.createShare();
    await copyStarted;
    fixture.setThread(a!.id);
    await waitFor(() => !ui.sharesLoading());
    editDraft("A-after-copy-start", "23"); fixture.clearToasts();
    const aReads = requests.filter(r => r.path === `/api/threads/${a!.id}/shares`).length;
    releaseCopy(); await copyingB;
    expect(ui.sharePassword()).toBe("A-after-copy-start");
    expect(ui.shareExpiresInDays()).toBe("23");
    expect(fixture.toastCount()).toBe(0);
    expect(requests.filter(r => r.path === `/api/threads/${a!.id}/shares`).length).toBe(aReads);
    console.info("[chat-sharing] clipboard continuation closed");

    // Revocation still commits for its original thread, without refreshing B.
    const toRevoke = ui.shares()[0];
    const heldRevoke = holdResponse(`/api/threads/${a!.id}/shares/${toRevoke.id}/revoke`, "POST");
    const pendingRevoke = ui.revokeShare(toRevoke.id);
    await heldRevoke.entered;
    fixture.setThread(b!.id);
    await waitFor(() => !ui.sharesLoading()); fixture.clearToasts();
    const bReads = requests.filter(r => r.path === `/api/threads/${b!.id}/shares`).length;
    heldRevoke.release(); await pendingRevoke;
    expect(fixture.toastCount()).toBe(0);
    expect(requests.filter(r => r.path === `/api/threads/${b!.id}/shares`).length).toBe(bReads);
    fixture.setThread(a!.id);
    await waitFor(() => !ui.sharesLoading());
    expect(ui.shares().find(s => s.id === toRevoke.id)!.revoked_at).not.toBeNull();
    const currentRevoke = ui.shares().find(s => !s.revoked_at)!;
    await ui.revokeShare(currentRevoke.id);
    expect(ui.shares().find(s => s.id === currentRevoke.id)!.revoked_at).not.toBeNull();
    console.info("[chat-sharing] revocation closed");

    // Drive the real row button, not the create-share hook: its clipboard
    // continuation has a separate Solid owner. Only the external clipboard
    // ACK/rejection is controlled; every URL still comes from the real API.
    const startRowCopy = async (reject = false) => {
      const share = ui.shares().find(s => !s.revoked_at)!;
      expect(share).toBeDefined();
      const button = document.querySelector<HTMLButtonElement>('button[title="Copy"]:not([disabled])');
      expect(button).not.toBeNull();
      let started!: () => void; let release!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      releases.push(release);
      clipboardGate = { started, released, ...(reject ? { error: new Error("Clipboard permission denied") } : {}) };
      button!.dispatchEvent(new Event("click", { bubbles: true }));
      await entered;
      expect(clipboard.at(-1)).toBe(share.share_url);
      return async () => {
        release();
        // Let the actual async DOM handler continue after the clipboard ACK.
        await new Promise(resolve => setTimeout(resolve, 0));
      };
    };
    fixture.clearToasts();
    await (await startRowCopy())();
    expect(fixture.toastMessages()).toEqual([{ type: "success", message: "Copied" }]);
    fixture.clearToasts();
    await (await startRowCopy(true))();
    expect(fixture.toastMessages()).toEqual([{ type: "error", message: "Failed to copy" }]);
    console.info("[chat-sharing] current row copy and denial closed");

    for (const scenario of ["other-thread", "rejected-other-thread", "A-B-A", "refresh", "close", "close-reopen"]) {
      fixture.setThread(a!.id);
      ui.setShowShareModal(true);
      await waitFor(() => !ui.sharesLoading());
      fixture.clearToasts();
      const finishCopy = await startRowCopy(scenario === "rejected-other-thread");
      if (scenario === "other-thread" || scenario === "rejected-other-thread" || scenario === "A-B-A") {
        fixture.setThread(b!.id); await waitFor(() => !ui.sharesLoading());
        if (scenario === "A-B-A") {
          fixture.setThread(a!.id); await waitFor(() => !ui.sharesLoading());
        }
      } else if (scenario === "refresh") {
        await ui.fetchShares();
      } else {
        ui.setShowShareModal(false);
        expect(document.querySelector("[role=dialog]")).toBeNull();
        if (scenario === "close-reopen") {
          ui.setShowShareModal(true); await waitFor(() => !ui.sharesLoading());
        }
      }
      if (scenario !== "close") editDraft(`row-${scenario}-draft`, "26");
      const requestCount = requests.length;
      await finishCopy();
      expect(fixture.toastMessages()).toEqual([]);
      expect(requests.length).toBe(requestCount);
      if (scenario !== "close") {
        expect(ui.sharePassword()).toBe(`row-${scenario}-draft`);
        expect(ui.shareExpiresInDays()).toBe("26");
      }
      console.info(`[chat-sharing] retired row copy ${scenario} closed`);
    }
    ui.setShowShareModal(true);
    fixture.setThread(a!.id); await waitFor(() => !ui.sharesLoading());

    // A retired 401 body must not redirect the new context through rpcJson.
    let reading!: () => void; let releaseBody!: () => void;
    const bodyStarted = new Promise<void>(resolve => { reading = resolve; });
    const bodyReleased = new Promise<void>(resolve => { releaseBody = resolve; });
    releases.push(releaseBody);
    bodyGate = { path: `/api/threads/${a!.id}/shares`, started: reading, released: bodyReleased };
    authenticated = false;
    const unauthorizedA = ui.fetchShares(); await bodyStarted;
    authenticated = true; fixture.setThread(b!.id);
    await waitFor(() => !ui.sharesLoading());
    releaseBody(); await unauthorizedA;
    expect((scope.location as { href: string }).href).toBe(String(server.url));
    expect(ui.shareError()).toBeNull();
    // A current 401 retains the normal login redirect and error behavior.
    authenticated = false; await ui.fetchShares(); authenticated = true;
    expect((scope.location as { href: string }).href).toStartWith("/auth/oidc/login?");
    expect(ui.shareError()).toBe("Fixture session expired");
    await ui.fetchShares();
    fixture.setThread(a!.id); await waitFor(() => !ui.sharesLoading());
    console.info("[chat-sharing] unauthorized continuation closed");

    // Closing and reopening the same dialog retires the old continuation.
    const closing = holdResponse(`/api/threads/${a!.id}/share`, "POST");
    const pendingClosing = ui.createShare(); await closing.entered;
    ui.setShowShareModal(false); ui.setShowShareModal(true);
    await waitFor(() => !ui.sharesLoading());
    editDraft("reopened-draft", "24"); fixture.clearToasts();
    const beforeCloseCopies = clipboard.length;
    closing.release(); await pendingClosing;
    expect(ui.sharePassword()).toBe("reopened-draft");
    expect(ui.shareExpiresInDays()).toBe("24");
    expect(clipboard.length).toBe(beforeCloseCopies);
    expect(fixture.toastCount()).toBe(0);

    // Disposed owners cannot publish an old operation's effects either.
    console.info("[chat-sharing] dialog reopening closed");
    const disposing = holdResponse(`/api/threads/${a!.id}/share`, "POST");
    const pendingDisposal = ui.createShare(); await disposing.entered;
    const finishDisposedCopy = await startRowCopy();
    const disposed = fixture; disposed.dispose(); fixture = undefined;
    const beforeDisposeCopies = clipboard.length;
    disposing.release(); await pendingDisposal;
    await finishDisposedCopy();
    expect(clipboard.length).toBe(beforeDisposeCopies);
    expect(disposed.toastCount()).toBe(0);
    expect(document.getElementById("root")!.textContent).toBe("");
  } finally {
    for (const release of releases) release();
    fixture?.dispose(); server?.stop(true); client.close(); anchor.close();
    await rm(output, { recursive: true, force: true });
  }
}

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("chat-sharing UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
