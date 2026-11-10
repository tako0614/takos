import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useStorageBulkOperations } from "../../hooks/useStorageBulkOperations.ts";
import { useToast } from "../../store/toast.ts";

if (Bun.env.TAKOS_BULK_RENAME_TEST_CLIENT !== "1") {
  test("bulk rename keeps its original view, partial ACK and newer drafts", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_BULK_RENAME_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>; bulk: ReturnType<typeof useStorageBulkOperations>;
    open: (ids?: string[]) => void; draft: (name: string, id?: string) => void; save: () => Promise<void>;
    selected: () => Set<string>; select: (ids: string[]) => void; space: (id: string) => void; dispose: () => void;
    held: () => Promise<void>; release: () => void; posts: { space: string; renames: { file_id: string; name: string }[] }[];
    reads: string[]; location: { href: string }; toasts: () => string[];
  }) => Promise<void>, status: number | "partial" = 200, phase: "headers" | "body" = "body") {
    const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/storage/space-a/a", pathname: "/storage/space-a/a", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, value: location });
    const toast = useToast(), previousToasts = new Set(toast.toasts.map(item => item.id));
    const names = new Map([["file-a", "alpha"], ["file-b", "beta"], ["file-c", "gamma"]]);
    const posts: { space: string; renames: { file_id: string; name: string }[] }[] = [], reads: string[] = [], pending: Promise<void>[] = [];
    let currentSpace = "space-a", dispose!: () => void, first = true, entered = false, response: Response | undefined, released = false;
    let releaseResponse: (() => void) | undefined;
    const release = () => { released = true;releaseResponse?.();releaseResponse = undefined; };
    const file = (id: string, space: string, path = "/a") => ({ id, name: names.get(id)!, space_id: space, path: `${path}/${names.get(id)}`,
      type: "file" as const, size: 1, mime_type: "text/plain", parent_id: null, sha256: null, uploaded_by: null,
      created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
        const path = url.searchParams.get("path") ?? "/";reads.push(`${space}:${path}`);
        return Response.json({ files: (space === "space-a" ? ["file-a", "file-b"] : ["file-c"]).map(id => file(id, space, path)), path });
      }
      expect(request.method).toBe("POST");expect(url.pathname.endsWith("/storage/bulk-rename")).toBe(true);
      const body = await request.json() as { renames: { file_id: string; name: string }[] };posts.push({ space, renames: body.renames });
      const hold = first, code = hold && typeof status === "number" ? status : 200;first = false;
      const renamed = code === 200 ? body.renames.filter((_, index) => !(hold && status === "partial" && index > 0)).map(item => {
        names.set(item.file_id, item.name);return file(item.file_id, space);
      }) : [];
      const errors = code === 200 ? body.renames.filter(item => !renamed.some(file => file.id === item.file_id)).map(item => ({ file_id: item.file_id, error: "fixture_conflict" })) : [];
      const data = code === 200 ? { renamed, errors, success_count: renamed.length, error_count: errors.length } : { error: "fixture_bulk_rename_unavailable" };
      if (hold && !released) {
        entered = true;
        if (phase === "headers") await new Promise<void>(resolve => { releaseResponse = resolve; });
        else return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(" "));
          releaseResponse = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close(); };
        } }), { status: code, headers: { "Content-Type": "application/json" } });
      }
      return Response.json(data, { status: code });
    } });
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input), server.url);expect(url.origin).toBe(server.url.origin);
      const result = await originalFetch(url, init);if (init?.method === "POST" && !response) response = result;return result;
    }) as typeof fetch;
    const { storage, bulk, selected, setSelected } = createRoot(cleanup => {
      dispose = cleanup;const storage = useSpaceStorage(() => currentSpace), [selected, setSelected] = createSignal(new Set<string>());
      return { storage, selected, setSelected, bulk: useStorageBulkOperations({ ...storage, selectedFiles: selected, setSelectedFiles: setSelected, getScope: storage.uploadScope }) };
    });
    try {
      await storage.loadFiles("/a");
      await run({ storage, bulk, selected, select: ids => { setSelected(new Set(ids)); }, space: id => { currentSpace = id; }, dispose, posts, reads, location,
        toasts: () => toast.toasts.filter(item => !previousToasts.has(item.id)).map(item => item.type), release,
        held: () => until(() => entered && (phase === "headers" || response?.body?.locked === true)),
        open: (ids = ["file-a"]) => { setSelected(new Set(ids));bulk.openBulkRename(); },
        draft: (name, id = "file-a") => { bulk.setBulkRenames(previous => previous.map(item => item.file_id === id ? { ...item, name } : item)); },
        save: () => { const task = bulk.handleBulkRename();pending.push(task);return task; },
      });
    } finally {
      release();await Promise.allSettled(pending);dispose();globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "location", descriptor);else Reflect.deleteProperty(globalThis, "location");
      for (const item of toast.toasts) if (!previousToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  for (const retirement of ["workspace", "folder", "aba", "dispose"] as const) {
    test(`bulk rename cannot submit a retired ${retirement} dialog`, async () => {
      await fixture(async f => {
        f.open();f.draft("from-a");
        if (retirement === "dispose") f.dispose();
        else { if (retirement !== "folder") f.space("space-b");await f.storage.loadFiles("/b");
          if (retirement === "aba") { f.space("space-a");await f.storage.loadFiles("/a"); } }
        f.release();await f.save();expect(f.posts).toEqual([]);expect(f.bulk.showBulkRenameModal()).toBe(false);
      });
    });
  }
  for (const phase of ["headers", "body"] as const) {
    for (const status of [200, 401, 503]) {
      test(`retired bulk ${status}/${phase} cannot affect a replacement Workspace`, async () => {
        await fixture(async f => {
          f.open();f.draft("first");const task = f.save();await f.held();f.space("space-b");await f.storage.loadFiles("/b");
          f.open(["file-c"]);f.draft("new-c", "file-c");const before = { href: f.location.href, reads: f.reads.length };
          expect(f.bulk.bulkRenaming()).toBe(false);f.release();await task;
          expect(f.location.href).toBe(before.href);expect(f.reads).toHaveLength(before.reads);
          expect(f.storage.error()).toBeNull();expect(f.bulk.bulkRenames()[0].name).toBe("new-c");expect(f.toasts()).toEqual([]);
        }, status, phase);
      });
    }
    test(`canceled ${phase} ACK reconciles the original view without closing a reopened draft`, async () => {
      await fixture(async f => {
        f.open();f.draft("first");const task = f.save();await f.held();f.bulk.closeBulkRename();f.open();f.draft("second");
        const before = f.reads.length;await f.save();expect(f.posts).toHaveLength(1);expect(f.bulk.bulkRenaming()).toBe(true);
        f.release();await task;expect(f.reads).toHaveLength(before + 1);expect(f.storage.files()[0].name).toBe("first");
        expect(f.bulk.bulkRenames()[0]).toMatchObject({ old_name: "first", name: "second" });expect(f.toasts()).toEqual([]);
        await f.save();expect(f.posts[1].renames).toEqual([{ file_id: "file-a", name: "second" }]);expect(f.bulk.showBulkRenameModal()).toBe(false);
      }, 200, phase);
    });
  }
  test("a newer draft survives ACK, and only changed names are sent", async () => {
    await fixture(async f => {
      f.open(["file-a", "file-b"]);f.draft("  first  ");const task = f.save();await f.held();f.draft("second");f.select(["file-a", "file-b", "file-c"]);
      f.release();await task;expect(f.posts[0].renames).toEqual([{ file_id: "file-a", name: "first" }]);
      expect(f.bulk.bulkRenames()[0]).toMatchObject({ old_name: "first", name: "second" });expect([...f.selected()]).toEqual(["file-b", "file-c"]);
      expect(f.bulk.showBulkRenameModal()).toBe(true);await f.save();expect(f.posts[1].renames).toEqual([{ file_id: "file-a", name: "second" }]);
      expect(f.bulk.showBulkRenameModal()).toBe(false);expect(f.toasts()).toEqual(["success", "success"]);
    });
  });
  test("HTTP 200 partial ACK retains failed names for explicit retry", async () => {
    await fixture(async f => {
      f.open(["file-a", "file-b"]);f.draft("first");f.draft("second", "file-b");const task = f.save();await f.held();f.release();await task;
      expect(f.bulk.showBulkRenameModal()).toBe(true);expect(f.bulk.bulkRenames()[0]).toMatchObject({ old_name: "first", name: "first" });
      expect(f.bulk.bulkRenames()[1]).toMatchObject({ old_name: "beta", name: "second" });expect([...f.selected()]).toEqual(["file-b"]);
      expect(f.toasts()).toEqual(["error"]);expect(f.storage.error()).not.toBeNull();await f.save();
      expect(f.posts[1].renames).toEqual([{ file_id: "file-b", name: "second" }]);expect(f.storage.error()).toBeNull();expect(f.toasts()).toEqual(["error", "success"]);
    }, "partial");
  });
  for (const draft of ["", "   ", "  first  "]) {
    test(`an ACK retains a newer raw draft ${JSON.stringify(draft)}`, async () => {
      await fixture(async f => {
        f.open();f.draft("first");const task = f.save();await f.held();f.draft(draft);f.release();await task;
        expect(f.bulk.showBulkRenameModal()).toBe(true);expect(f.bulk.bulkRenames()[0]).toMatchObject({ old_name: "first", name: draft });
        await f.save();expect(f.posts).toHaveLength(1);f.draft("second");await f.save();
        expect(f.posts[1].renames).toEqual([{ file_id: "file-a", name: "second" }]);expect(f.bulk.showBulkRenameModal()).toBe(false);
      });
    });
  }
  for (const status of [401, 503]) {
    test(`current ${status} keeps the draft and allows explicit retry`, async () => {
      await fixture(async f => {
        f.open();f.draft("first");const task = f.save();await f.held();f.draft("second");f.release();await task;
        expect(f.bulk.bulkRenaming()).toBe(false);expect(f.bulk.showBulkRenameModal()).toBe(true);expect(f.bulk.bulkRenames()[0].name).toBe("second");
        expect(f.storage.error()).not.toBeNull();expect(f.toasts()).toEqual(["error"]);
        expect(f.location.href).toBe(status === 401 ? "/auth/oidc/login?return_to=" + encodeURIComponent("/storage/space-a/a") : "/storage/space-a/a");
        await f.save();expect(f.storage.error()).toBeNull();expect(f.bulk.showBulkRenameModal()).toBe(false);
      }, status);
    });
  }
  test("same-folder refresh and duplicate submit preserve one pending request", async () => {
    await fixture(async f => {
      f.open();f.draft("first");const task = f.save();await f.held();await f.storage.loadFiles("/a");await f.save();expect(f.posts).toHaveLength(1);
      f.release();await task;expect(f.bulk.bulkRenaming()).toBe(false);expect(f.bulk.showBulkRenameModal()).toBe(false);
    });
  });
  test("unchanged or empty input does not dispatch", async () => {
    await fixture(async f => { f.open();f.draft("  alpha  ");f.release();await f.save();f.draft("  ");await f.save();expect(f.posts).toEqual([]); });
  });

  async function until(check: () => boolean) {
    const end = Date.now() + 1500;while (!check() && Date.now() < end) await Bun.sleep(1);expect(check()).toBe(true);
  }
}
