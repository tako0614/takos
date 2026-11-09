import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";

if (Bun.env.TAKOS_STORAGE_READ_TEST_CLIENT !== "1") {
  test("storage list ownership uses the actual browser hook and HTTP body", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_READ_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  const file = (id: string, space: string) => ({ id, name: id, type: "file", path: `/${id}`, parent_path: "/", size: 1,
    mime_type: "text/plain", space_id: space, created_at: "2026-11-09T00:00:00Z", updated_at: "2026-11-09T00:00:00Z" });
  const listing = (id: string, path: string, space = "space-a") => ({ files: [file(id, space)], path, truncated: false });
  async function until(check: () => boolean) {
    const end = Date.now() + 1500;
    while (!check() && Date.now() < end) await Bun.sleep(1);
    expect(check()).toBe(true);
  }
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>;
    selectSpace: (space: string) => void;
    hold: (status: number, body: unknown) => { entered: () => Promise<void>; finish: () => void };
    location: { pathname: string; search: string; href: string };
    failCurrent: (value: boolean) => void;
    dispose: () => void;
    requestCount: () => number;
  }) => Promise<void>) {
    const originalFetch = globalThis.fetch, locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { pathname: "/app/current/storage", search: "?folder=kept", href: "/app/current/storage?folder=kept" };
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: location });
    let currentSpace = "space-a", unavailable = false, dispose!: () => void, requests = 0;
    let held: { status: number; body: unknown; stream?: ReadableStreamDefaultController<Uint8Array>; response?: Response } | undefined;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      expect(request.method).toBe("GET");expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
      requests++;
      if (url.searchParams.get("path") === "/old" && held) {
        const item = held;
        return new Response(new ReadableStream<Uint8Array>({ start(stream) {
          item.stream = stream;stream.enqueue(new TextEncoder().encode(" "));
        } }), { status: item.status, headers: { "Content-Type": "application/json" } });
      }
      return unavailable ? Response.json({ error: "temporarily_unavailable" }, { status: 503 })
        : Response.json(listing(`${url.pathname.split("/")[3]}-current`, url.searchParams.get("path") ?? "/", url.pathname.split("/")[3]));
    } });
    globalThis.fetch = (async (input, init) => {
      const response = await originalFetch(new URL(String(input), server.url), init);
      if (new URL(String(input), server.url).searchParams.get("path") === "/old" && held) held.response = response;
      return response;
    }) as typeof fetch;
    const storage = createRoot((cleanup) => { dispose = cleanup;return useSpaceStorage(() => currentSpace); });
    try {
      await run({ storage, location, selectSpace: space => { currentSpace = space; }, dispose,
        requestCount: () => requests, failCurrent: value => { unavailable = value; },
        hold: (status, body) => {
          const item = { status, body } as NonNullable<typeof held>;held = item;
          return {
            // A locked real Response proves the hook passed its header guard
            // and is awaiting JSON, rather than merely waiting for fetch().
            entered: () => until(() => item.response?.body?.locked === true),
            finish: () => { item.stream?.enqueue(new TextEncoder().encode(JSON.stringify(item.body)));item.stream?.close();item.stream = undefined; },
          };
        },
      });
    } finally {
      dispose();held?.stream?.close();globalThis.fetch = originalFetch;
      if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
      else Reflect.deleteProperty(globalThis, "location");
      server.stop(true);
    }
  }

  for (const kind of ["folder", "workspace", "aba"] as const) {
    test(`an older parsed file-list body cannot replace the current ${kind} list`, async () => {
      await fixture(async ({ storage, hold, selectSpace }) => {
        const body = hold(200, listing("old-a", "/old")), old = storage.loadFiles("/old");await body.entered();
        if (kind !== "folder") selectSpace("space-b");
        await storage.loadFiles("/current");
        if (kind === "aba") { selectSpace("space-a");await storage.loadFiles("/current"); }
        const before = { files: storage.files(), path: storage.currentPath(), loading: storage.loading() };
        body.finish();await old;
        expect(storage.files()).toEqual(before.files);expect(storage.currentPath()).toBe(before.path);
        expect(storage.loading()).toBe(false);expect(storage.error()).toBeNull();
      });
    });
  }

  for (const retirement of ["new-list", "dispose"] as const) {
    test(`a retired storage 401 body cannot navigate after ${retirement}`, async () => {
      await fixture(async ({ storage, hold, selectSpace, location, dispose }) => {
        const body = hold(401, { error: "old_login_required" }), old = storage.loadFiles("/old");await body.entered();
        if (retirement === "dispose") dispose();
        else { selectSpace("space-b");await storage.loadFiles("/current"); }
        const before = location.href;body.finish();await old;
        expect(location.href).toBe(before);expect(storage.error()).toBeNull();
      });
    });
  }

  test("a disposed storage view cannot adopt a late list or start a readback", async () => {
    await fixture(async ({ storage, hold, dispose, requestCount }) => {
      const body = hold(200, listing("old-a", "/old")), old = storage.loadFiles("/old");await body.entered();
      dispose();body.finish();await old;
      expect(storage.files()).toEqual([]);expect(storage.error()).toBeNull();
      await storage.loadFiles("/current");expect(requestCount()).toBe(1);
    });
  });

  test("a current 401 keeps the existing login return route", async () => {
    await fixture(async ({ storage, hold, location }) => {
      const body = hold(401, { error: "current_login_required" }), current = storage.loadFiles("/old");await body.entered();body.finish();await current;
      expect(location.href).toBe("/auth/oidc/login?return_to=" + encodeURIComponent(location.pathname + location.search));
      expect(storage.error()).not.toBeNull();expect(storage.loading()).toBe(false);
    });
  });

  test("a current failure is visible and a separate manual list retry recovers", async () => {
    await fixture(async ({ storage, failCurrent, requestCount }) => {
      failCurrent(true);await storage.loadFiles("/current");expect(storage.error()).not.toBeNull();
      expect(storage.files()).toEqual([]);expect(storage.loading()).toBe(false);expect(requestCount()).toBe(1);
      failCurrent(false);await storage.loadFiles("/current");expect(storage.error()).toBeNull();
      expect(storage.files().map(item => item.id)).toEqual(["space-a-current"]);expect(requestCount()).toBe(2);
    });
  });
}
