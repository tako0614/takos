import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Env, User } from "../../src/worker/shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../src/worker/shared/types/bindings.ts";
import type { BaseVariables } from "../../src/worker/server/routes/route-auth.ts";

test("actual chat export controls display API failures and download authorized JSON and Markdown", async () => {
  if (process.env.TAKOS_CHAT_EXPORT_UI_PROCESS === "1") {
    await verifyExport();
    return;
  }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_CHAT_EXPORT_UI_PROCESS: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled chat-export UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyExport() {
  const [
    { createClient }, { Hono }, { parseHTML }, { build }, { default: solid },
    { createContext, runInContext }, { ensureServerMigrations },
    { createPreparedStatement, createSequentialBatch }, { createThread, createMessage },
    { registerThreadCrudRoutes }, { isAppError },
  ] = await Promise.all([
    import("@libsql/client"), import("hono"), import("linkedom"), import("vite"),
    import("vite-plugin-solid"), import("node:vm"),
    import("../../src/worker/local-platform/d1-migrations.ts"),
    import("../../src/worker/local-platform/d1-prepared-statement.ts"),
    import("../../src/worker/application/services/threads/thread-service.ts"),
    import("../../src/worker/server/routes/threads/thread.ts"),
    import("../../src/worker/platform-utils/errors.ts"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-chat-export-ui-"));
  const anchor = createClient({ url: "file::memory:?cache=shared" });
  const client = createClient({ url: "file::memory:?cache=shared" });
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fixture: {
    setThread: (id: string) => void; open: () => void; pending: () => Promise<void>;
    messages: () => Array<{ type: string; message: string }>; notify: (message: string) => void;
    clear: () => void; dispose: () => void;
  } | undefined;
  const createdUrls: string[] = [];
  try {
    await ensureServerMigrations(client, resolve(import.meta.dir, "../../db/migrations-control/migrations"));
    const db = {
      prepare: (query: string) => createPreparedStatement(client, query),
      batch: createSequentialBatch(statement => statement.run()),
    } as SqlDatabaseBinding;
    const now = new Date().toISOString();
    const owner = "export-ui-owner"; const foreign = "export-ui-foreign";
    for (const id of [owner, foreign]) {
      await db.prepare("INSERT INTO accounts (id, type, status, name, slug, created_at, updated_at) VALUES (?, 'user', 'active', ?, ?, ?, ?)").bind(id, id, id, now, now).run();
      await db.prepare("INSERT INTO account_memberships (id, account_id, member_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?)").bind(`member_${id}`, id, id, now, now).run();
    }
    const owned = await createThread(db, owner, { title: "Export proof" });
    const denied = await createThread(db, foreign, { title: "Foreign export" });
    expect(owned).not.toBeNull(); expect(denied).not.toBeNull();
    // The optional PDF capability is deliberately absent: test the real 503,
    // without substituting a successful renderer or changing the exporter.
    const env = { DB: db, PLATFORM: { config: {}, bindings: { DB: db }, services: { documents: {} } } } as unknown as Env;
    await createMessage(env, db, owned!, { role: "user", content: "VISIBLE_EXPORT_MESSAGE" });
    await createMessage(env, db, denied!, { role: "user", content: "FOREIGN_EXPORT_CONTENT" });
    const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
    app.use("*", async (c, next) => {
      // Only the already-authenticated identity is synthetic. The real router
      // still performs ownership checks against canonical local SQLite.
      c.set("user", { id: owner, email: "fixture@example.test", name: owner, username: owner,
        bio: null, picture: null, trust_tier: "normal", setup_completed: true,
        created_at: now, updated_at: now } satisfies User);
      await next();
    });
    app.onError((error, c) => {
      if (isAppError(error)) return c.json(error.toResponse(), error.statusCode as 400 | 403 | 404 | 500);
      throw error;
    });
    const routes = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
    registerThreadCrudRoutes(routes); app.route("/api", routes);
    const requests: Array<{ status: number; path: string; format: string | null }> = [];
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const response = await app.fetch(request, env);
      const url = new URL(request.url);
      requests.push({ status: response.status, path: url.pathname, format: url.searchParams.get("format") });
      return response;
    } });
    await build({
      configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false,
        lib: { entry: resolve(import.meta.dir, "fixtures/chat-export/client.tsx"), formats: ["iife"], name: "TakosChatExportTest", fileName: () => "client.js" },
      },
    });
    const { window, document, Event, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const storage = new Map<string, string>();
    const blobs = new Map<string, Blob>();
    const revoked: string[] = [];
    const downloads: Array<{ href: string; filename: string }> = [];
    class ObservedURL extends URL {
      static override createObjectURL(blob: Blob) {
        const url = URL.createObjectURL(blob); createdUrls.push(url); blobs.set(url, blob); return url;
      }
      static override revokeObjectURL(url: string) { revoked.push(url); URL.revokeObjectURL(url); }
    }
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLAnchorElement;
      if (target.tagName === "A") downloads.push({ href: target.href, filename: target.download });
    });
    const scope: Record<string, unknown> = {
      document, HTMLElement, console, URL: ObservedURL, URLSearchParams, Headers, Request, Response, Blob,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      innerWidth: 1024, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
      navigator: { language: "en" }, location: { href: String(server.url), origin: server.url.origin },
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      fetch: (input: string | URL, init?: RequestInit) => fetch(new URL(String(input), server!.url), init),
      takosExportThread: denied!.id,
    };
    scope.window = scope; scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.takosExportFixture as NonNullable<typeof fixture>;
    fixture.open();
    fixture.notify("Export notification probe");
    expect(fixture.messages()).toEqual([{ type: "info", message: "Export notification probe" }]);
    const notification = document.querySelector("[role=status]");
    expect(notification).not.toBeNull();
    expect(notification!.textContent).toContain("Export notification probe");
    document.querySelector<HTMLButtonElement>("[role=status] button")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(fixture.messages()).toEqual([]);
    expect(document.querySelector("[role=status]")).toBeNull();
    const clickFormat = async (format: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find(b => b.textContent?.trim() === format);
      expect(button).toBeDefined(); button!.dispatchEvent(new Event("click", { bubbles: true }));
      await fixture!.pending();
    };
    await clickFormat("JSON");
    if (requests.length === 0) throw new Error(`Export did not reach HTTP: ${fixture.messages().map(m => m.message).join("; ")}`);
    expect(requests.at(-1)!.status).toBe(404);
    expect(document.querySelector("[role=alert]")?.textContent).toContain("Thread not found");
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(document.body.textContent).not.toContain("FOREIGN_EXPORT_CONTENT");
    expect(downloads).toEqual([]); expect(createdUrls).toEqual([]);
    fixture.clear(); fixture.setThread(owned!.id);
    await clickFormat("JSON");
    expect(requests.at(-1)!.status).toBe(200);
    expect(downloads.length).toBe(1);
    expect(downloads[0].filename).toBe(`Export-proof-${owned!.id}.json`);
    const jsonBlob = blobs.get(downloads[0].href)!;
    expect(jsonBlob.type).toStartWith("application/json");
    const payload = JSON.parse(await jsonBlob.text()) as { thread: { id: string; title: string }; messages: Array<{ role: string; content: string }> };
    expect(payload.thread.id).toBe(owned!.id); expect(payload.thread.title).toBe("Export proof");
    expect(payload.messages.map(({ role, content }) => ({ role, content }))).toEqual([{ role: "user", content: "VISIBLE_EXPORT_MESSAGE" }]);
    expect(revoked).toEqual([downloads[0].href]);
    expect(document.querySelector("[role=status]")?.textContent).toContain("Download");
    expect(document.querySelector("[role=alert]")).toBeNull();
    fixture.clear(); await clickFormat("Markdown");
    expect(requests.at(-1)!.status).toBe(200);
    expect(downloads.length).toBe(2);
    expect(downloads[1].filename).toBe(`Export-proof-${owned!.id}.md`);
    const markdown = await blobs.get(downloads[1].href)!.text();
    expect(markdown).toContain("# Export proof"); expect(markdown).toContain("VISIBLE_EXPORT_MESSAGE");
    expect(markdown).not.toContain("FOREIGN_EXPORT_CONTENT");
    fixture.clear(); await clickFormat("PDF");
    expect(requests.at(-1)!.status).toBe(503);
    expect(document.querySelector("[role=alert]")?.textContent).toContain("PDF export renderer is not configured");
    expect(downloads.length).toBe(2);
    expect(revoked).toEqual(downloads.map(d => d.href));
  } finally {
    fixture?.dispose(); server?.stop(true); client.close(); anchor.close();
    for (const url of createdUrls) URL.revokeObjectURL(url);
    await rm(output, { recursive: true, force: true });
  }
}
