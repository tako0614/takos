import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useStorageBulkOperations } from "../../hooks/useStorageBulkOperations.ts";
import { useToast } from "../../store/toast.ts";

if (Bun.env.TAKOS_BULK_MOVE_TEST_CLIENT !== "1") {
  test("bulk move owns its selection, destination, ACK and response lifetime", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_BULK_MOVE_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>; bulk: ReturnType<typeof useStorageBulkOperations>;
    open: (ids?: string[]) => void; save: () => Promise<void>; select: (ids: string[]) => void; selected: () => Set<string>;
    space: (id: string) => void; dispose: () => void; held: (n?: number) => Promise<void>; release: (n?: number) => void;
    posts: { space: string; ids: string[]; dest: string }[]; reads: string[]; location: { href: string }; toasts: () => string[];
  }) => Promise<void>, status: number | "partial" = 200, phase: "headers" | "body" = "body", holdSecond = false) {
    const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/storage/space-a/a", pathname: "/storage/space-a/a", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, value: location });
    const toast = useToast(), previousToasts = new Set(toast.toasts.map(item => item.id));
    const names = new Map([["file-a", "alpha"], ["file-b", "beta"], ["file-c", "gamma"]]);
    const parents = new Map([...names.keys()].map(id => [id, "/a"]));
    const posts: { space: string; ids: string[]; dest: string }[] = [], reads: string[] = [], pending: Promise<void>[] = [];
    const releases = new Map<number, () => void>(), responses = new Map<number, Response>(), entered = new Set<number>(), released = new Set<number>();
    let currentSpace = "space-a", dispose!: () => void;
    const file = (id: string, space: string) => ({ id, name: names.get(id)!, space_id: space, path: `${parents.get(id)}/${names.get(id)}`,
      type: "file" as const, size: 1, mime_type: "text/plain", parent_id: null, sha256: null, uploaded_by: null,
      created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
        const path = url.searchParams.get("path") ?? "/";reads.push(`${space}:${path}`);
        return Response.json({ files: (space === "space-a" ? ["file-a", "file-b"] : ["file-c"]).filter(id => parents.get(id) === path).map(id => file(id, space)), path });
      }
      expect(request.method).toBe("POST");expect(url.pathname.endsWith("/storage/bulk-move")).toBe(true);
      const body = await request.json() as { file_ids: string[]; parent_path: string };posts.push({ space, ids: body.file_ids, dest: body.parent_path });
      const n = posts.length, code = n === 1 && typeof status === "number" ? status : 200;
      const moved = code === 200 ? body.file_ids.filter((_, index) => !(n === 1 && status === "partial" && index > 0)).map(id => {
        parents.set(id, body.parent_path);return file(id, space);
      }) : [];
      const errors = body.file_ids.filter(id => !moved.some(file => file.id === id)).map(file_id => ({ file_id, error: "fixture_conflict" }));
      const data = code === 200 ? { moved, errors, success_count: moved.length, error_count: errors.length } : { error: "fixture_bulk_move_unavailable" };
      if (!released.has(n) && (n === 1 || (n === 2 && holdSecond))) {
        entered.add(n);
        if (phase === "headers") await new Promise<void>(resolve => { releases.set(n, resolve); });
        else return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(" "));
          releases.set(n, () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close(); });
        } }), { status: code, headers: { "Content-Type": "application/json" } });
      }
      return Response.json(data, { status: code });
    } });
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input), server.url);expect(url.origin).toBe(server.url.origin);
      const response = await originalFetch(url, init);if (init?.method === "POST") responses.set(posts.length, response);return response;
    }) as typeof fetch;
    const { storage, bulk, selected, setSelected } = createRoot(cleanup => {
      dispose = cleanup;const storage = useSpaceStorage(() => currentSpace), [selected, setSelected] = createSignal(new Set<string>());
      return { storage, selected, setSelected, bulk: useStorageBulkOperations({ ...storage, selectedFiles: selected, setSelectedFiles: setSelected, getScope: storage.uploadScope }) };
    });
    try {
      await storage.loadFiles("/a");
      await run({ storage, bulk, selected, select: ids => { setSelected(new Set(ids)); }, space: id => { currentSpace = id; }, dispose, posts, reads, location,
        toasts: () => toast.toasts.filter(item => !previousToasts.has(item.id)).map(item => item.type),
        held: (n = 1) => until(() => entered.has(n) && (phase === "headers" || responses.get(n)?.body?.locked === true)),
        release: (n = 1) => { released.add(n);releases.get(n)?.();releases.delete(n); },
        open: (ids = ["file-a"]) => { setSelected(new Set(ids));bulk.openBulkMove(); },
        save: () => { const task = bulk.handleBulkMove();pending.push(task);return task; },
      });
    } finally {
      released.add(1);released.add(2);for (const release of releases.values()) release();await Promise.allSettled(pending);dispose();globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "location", descriptor);else Reflect.deleteProperty(globalThis, "location");
      for (const item of toast.toasts) if (!previousToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  for (const retirement of ["workspace", "folder", "aba", "dispose"] as const) {
    test(`a retired ${retirement} move dialog cannot dispatch`, async () => {
      await fixture(async f => {
        f.open();f.bulk.setBulkMovePath("/dest-a");
        if (retirement === "dispose") f.dispose();
        else { if (retirement !== "folder") f.space("space-b");await f.storage.loadFiles("/b");
          if (retirement === "aba") { f.space("space-a");await f.storage.loadFiles("/a"); } }
        f.release();await f.save();expect(f.posts).toEqual([]);expect(f.bulk.showBulkMoveModal()).toBe(false);
      });
    });
  }
  for (const phase of ["headers", "body"] as const) {
    for (const status of [200, 401, 503]) {
      test(`old ${status}/${phase} leaves a replacement Workspace untouched`, async () => {
        await fixture(async f => {
          f.open();f.bulk.setBulkMovePath("/dest-a");const old = f.save();await f.held();f.space("space-b");await f.storage.loadFiles("/a");
          f.open(["file-c"]);f.bulk.setBulkMovePath("/dest-c");expect(f.bulk.bulkMoving()).toBe(false);
          const current = f.save();await f.held(2);const before = { href: f.location.href, reads: f.reads.length };
          f.release();await old;expect(f.location.href).toBe(before.href);expect(f.reads).toHaveLength(before.reads);
          expect(f.bulk.showBulkMoveModal()).toBe(true);expect(f.bulk.bulkMovePath()).toBe("/dest-c");expect(f.bulk.bulkMoving()).toBe(true);
          expect([...f.selected()]).toEqual(["file-c"]);expect(f.storage.error()).toBeNull();expect(f.toasts()).toEqual([]);
          f.release(2);await current;expect(f.bulk.showBulkMoveModal()).toBe(false);expect(f.toasts()).toEqual(["success"]);
        }, status, phase, true);
      });
    }
    test(`canceled ${phase} success refreshes its original view and preserves a reopened intent`, async () => {
      await fixture(async f => {
        f.open();f.bulk.setBulkMovePath("/first");const old = f.save();await f.held();f.bulk.closeBulkMove();f.open();f.bulk.setBulkMovePath("/second");
        await f.save();expect(f.posts).toHaveLength(1);const before = f.reads.length;f.release();await old;
        expect(f.reads).toHaveLength(before + 1);expect(f.storage.files().some(file => file.id === "file-a")).toBe(false);
        expect(f.bulk.showBulkMoveModal()).toBe(true);expect(f.bulk.bulkMovePath()).toBe("/second");expect(f.toasts()).toEqual([]);
        await f.save();expect(f.posts[1]).toEqual({ space: "space-a", ids: ["file-a"], dest: "/second" });
        expect(f.bulk.showBulkMoveModal()).toBe(false);
      }, 200, phase);
    });
  }
  test("selection changes cannot change the captured submitted IDs", async () => {
    await fixture(async f => {
      f.open();f.bulk.setBulkMovePath(" dest/ ");f.select(["file-b"]);const task = f.save();await f.held();f.release();await task;
      expect(f.posts).toEqual([{ space: "space-a", ids: ["file-a"], dest: "/dest" }]);expect([...f.selected()]).toEqual(["file-b"]);
    });
  });
  test("a partial HTTP200 retains only failed IDs for explicit retry", async () => {
    await fixture(async f => {
      f.open(["file-a", "file-b"]);f.bulk.setBulkMovePath("/dest");const task = f.save();await f.held();f.release();await task;
      expect(f.bulk.showBulkMoveModal()).toBe(true);expect([...f.selected()]).toEqual(["file-b"]);expect(f.storage.error()).not.toBeNull();
      expect(f.toasts()).toEqual(["error"]);await f.save();expect(f.posts[1]).toEqual({ space: "space-a", ids: ["file-b"], dest: "/dest" });
      expect(f.storage.error()).toBeNull();expect(f.bulk.showBulkMoveModal()).toBe(false);expect(f.toasts()).toEqual(["error", "success"]);
    }, "partial");
  });
  for (const path of ["/second", "", "  ", " /first "]) {
    test(`an ACK retains newer raw destination ${JSON.stringify(path)}`, async () => {
      await fixture(async f => {
        f.open();f.bulk.setBulkMovePath("/first");const task = f.save();await f.held();f.bulk.setBulkMovePath(path);f.release();await task;
        expect(f.bulk.showBulkMoveModal()).toBe(true);expect(f.bulk.bulkMovePath()).toBe(path);f.bulk.setBulkMovePath("/explicit");await f.save();
        expect(f.posts[1].dest).toBe("/explicit");expect(f.bulk.showBulkMoveModal()).toBe(false);
      });
    });
  }
  for (const status of [401, 503]) {
    test(`current ${status} retains destination and permits explicit retry`, async () => {
      await fixture(async f => {
        f.open();f.bulk.setBulkMovePath("/first");const task = f.save();await f.held();f.release();await task;
        expect(f.bulk.showBulkMoveModal()).toBe(true);expect(f.bulk.bulkMoving()).toBe(false);expect(f.bulk.bulkMovePath()).toBe("/first");
        expect(f.storage.error()).not.toBeNull();expect(f.toasts()).toEqual(["error"]);
        expect(f.location.href).toBe(status === 401 ? "/auth/oidc/login?return_to=" + encodeURIComponent("/storage/space-a/a") : "/storage/space-a/a");
        await f.save();expect(f.bulk.showBulkMoveModal()).toBe(false);expect(f.storage.error()).toBeNull();
      }, status);
    });
  }
  test("same-folder Refresh and duplicate saves keep one pending request", async () => {
    await fixture(async f => {
      f.open();f.bulk.setBulkMovePath("/dest");const task = f.save();await f.held();await f.storage.loadFiles("/a");await f.save();expect(f.posts).toHaveLength(1);
      f.release();await task;expect(f.bulk.bulkMoving()).toBe(false);
    });
  });
  test("empty destination and an empty selection have no POST effects", async () => {
    await fixture(async f => {
      f.release();f.open([]);await f.save();expect(f.bulk.showBulkMoveModal()).toBe(false);f.open();f.bulk.setBulkMovePath("  ");await f.save();expect(f.posts).toEqual([]);
    });
  });
  async function until(check: () => boolean) {
    const end = Date.now() + 1500;while (!check() && Date.now() < end) await Bun.sleep(1);expect(check()).toBe(true);
  }
}
