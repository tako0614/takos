import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useStorageActions } from "../../hooks/useStorageActions.ts";
import { useToast } from "../../store/toast.ts";

if (Bun.env.TAKOS_STORAGE_RENAME_TEST_CLIENT !== "1") {
  test("rename dialog, draft and HTTP effects belong to their original target", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_RENAME_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  type Patch = { space: string; id: string; name: string };
  async function until(check: () => boolean) {
    const end = Date.now() + 1500;
    while (!check() && Date.now() < end) await Bun.sleep(1);
    expect(check()).toBe(true);
  }
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>; actions: ReturnType<typeof useStorageActions>;
    open: (id?: string) => void; save: () => Promise<void>; dispose: () => void; selectSpace: (id: string) => void;
    held: () => Promise<void>; release: () => void; patches: Patch[]; reads: string[];
    location: { href: string }; toastTypes: () => string[];
  }) => Promise<void>, status = 200, phase: "headers" | "body" = "body") {
    const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/storage/space-a/a", pathname: "/storage/space-a/a", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: location });
    const toast = useToast(), beforeToasts = new Set(toast.toasts.map(item => item.id));
    const names = new Map([["file-a", "alpha"], ["file-b", "beta"]]);
    const patches: Patch[] = [], reads: string[] = [], pending: Promise<void>[] = [];
    let space = "space-a", dispose!: () => void, entered = false, released = false, first = true;
    let response: Response | undefined, releaseResponse: (() => void) | undefined;
    const release = () => { released = true;releaseResponse?.();releaseResponse = undefined; };
    const file = (id: string, currentSpace: string, path: string) => ({ id, name: names.get(id)!, space_id: currentSpace,
      parent_id: null, path: `${path}/${names.get(id)}`, type: "file" as const, size: 1, mime_type: "text/plain",
      sha256: null, uploaded_by: null, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), target = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);reads.push(`${target}:${url.searchParams.get("path")}`);
        const path = url.searchParams.get("path") ?? "/";
        return Response.json({ files: [file("file-a", target, path), file("file-b", target, path)], path });
      }
      expect(request.method).toBe("PATCH");const id = url.pathname.split("/").at(-1)!;
      const data = await request.json() as { name: string };patches.push({ space: target, id, name: data.name });
      const currentStatus = first ? status : 200, hold = first;first = false;
      if (currentStatus === 200) names.set(id, data.name);
      const body = currentStatus === 200 ? { file: file(id, target, "/a") } : { error: "fixture_rename_unavailable" };
      if (hold && !released) {
        entered = true;
        if (phase === "headers") await new Promise<void>(resolve => { releaseResponse = resolve; });
        else return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(" "));
          releaseResponse = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close(); };
        } }), { status: currentStatus, headers: { "Content-Type": "application/json" } });
      }
      return Response.json(body, { status: currentStatus });
    } });
    globalThis.fetch = (async (input, init) => {
      const result = await originalFetch(new URL(String(input), server.url), init);
      if (init?.method === "PATCH" && !response) response = result;
      return result;
    }) as typeof fetch;
    const { storage, actions } = createRoot(cleanup => {
      dispose = cleanup;const storage = useSpaceStorage(() => space), [, setSelected] = createSignal(new Set<string>());
      return { storage, actions: useStorageActions({ ...storage, getScope: storage.uploadScope, setSelectedFiles: setSelected }) };
    });
    try {
      await storage.loadFiles("/a");
      await run({ storage, actions, dispose, selectSpace: value => { space = value; }, patches, reads, location,
        open: (id = "file-a") => actions.openRenameModal(storage.files().find(item => item.id === id)!),
        save: () => { const result = actions.handleRename();pending.push(result);return result; }, release,
        held: () => until(() => entered && (phase === "headers" || response?.body?.locked === true)),
        toastTypes: () => toast.toasts.filter(item => !beforeToasts.has(item.id)).map(item => item.type),
      });
    } finally {
      release();await Promise.allSettled(pending);dispose();globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "location", descriptor);else Reflect.deleteProperty(globalThis, "location");
      for (const item of toast.toasts) if (!beforeToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  for (const retirement of ["workspace", "folder", "aba", "dispose"] as const) {
    test(`an old dialog cannot submit after ${retirement}`, async () => {
      await fixture(async ({ storage, actions, open, save, release, selectSpace, dispose, patches }) => {
        open();actions.setNewName("draft-a");
        if (retirement === "dispose") dispose();
        else {
          if (retirement !== "folder") selectSpace("space-b");await storage.loadFiles("/b");
          if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
        }
        const pending = save();release();await pending;expect(patches).toEqual([]);expect(actions.showRenameModal()).toBe(false);
      });
    });
  }

  for (const [status, retirement] of [[200, "workspace"], [401, "folder"], [503, "aba"], [401, "dispose"]] as const) {
    test(`retired rename body ${status}/${retirement} has no current feedback/readback`, async () => {
      await fixture(async ({ storage, actions, open, save, held, release, selectSpace, dispose, location, reads, toastTypes }) => {
        open();actions.setNewName("first");const pending = save();await held();
        if (retirement === "dispose") dispose();
        else {
          if (retirement !== "folder") selectSpace("space-b");await storage.loadFiles("/b");
          if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
        }
        const before = { href: location.href, reads: reads.length, error: storage.error() };
        release();await pending;expect(location.href).toBe(before.href);expect(reads).toHaveLength(before.reads);
        expect(storage.error()).toBe(before.error);expect(toastTypes()).toEqual([]);
      }, status);
    });
  }

  for (const status of [200, 401, 503]) {
    test(`a replaced rename session rejects old ${status} effects within the same folder`, async () => {
      await fixture(async ({ storage, actions, open, save, held, release, location, reads, toastTypes }) => {
        open();actions.setNewName("first-a");const pending = save();await held();
        actions.closeRenameModal();open("file-b");actions.setNewName("new-b");
        const before = { href: location.href, reads: reads.length };release();await pending;
        expect(actions.showRenameModal()).toBe(true);expect(actions.renameTarget()?.id).toBe("file-b");
        expect(actions.newName()).toBe("new-b");expect(location.href).toBe(before.href);
        expect(reads).toHaveLength(before.reads);expect(storage.error()).toBeNull();expect(toastTypes()).toEqual([]);
      }, status);
    });
  }

  test("a retired response header cannot redirect a replacement dialog", async () => {
    await fixture(async ({ actions, open, save, held, release, location, toastTypes }) => {
      open();actions.setNewName("first-a");const pending = save();await held();
      actions.closeRenameModal();open("file-b");actions.setNewName("new-b");const before = location.href;
      release();await pending;expect(location.href).toBe(before);expect(actions.newName()).toBe("new-b");expect(toastTypes()).toEqual([]);
    }, 401, "headers");
  });

  test("a current ACK keeps newer edits and a second explicit save applies them", async () => {
    await fixture(async ({ actions, open, save, held, release, patches, toastTypes }) => {
      open();actions.setNewName("  first  ");const pending = save();await held();actions.setNewName("  second  ");release();await pending;
      expect(actions.showRenameModal()).toBe(true);expect(actions.newName()).toBe("  second  ");expect(actions.renameTarget()?.name).toBe("first");
      expect(patches).toEqual([{ space: "space-a", id: "file-a", name: "first" }]);
      await save();expect(patches[1]).toEqual({ space: "space-a", id: "file-a", name: "second" });
      expect(actions.showRenameModal()).toBe(false);expect(toastTypes()).toEqual(["success", "success"]);
    });
  });

  test("a current failure retains a newer draft for explicit retry", async () => {
    await fixture(async ({ storage, actions, open, save, held, release, patches, toastTypes }) => {
      open();actions.setNewName("first");const pending = save();await held();actions.setNewName("second");release();await pending;
      expect(actions.showRenameModal()).toBe(true);expect(actions.newName()).toBe("second");expect(storage.error()).not.toBeNull();
      expect(patches).toHaveLength(1);await save();expect(patches[1].name).toBe("second");
      expect(actions.showRenameModal()).toBe(false);expect(storage.error()).toBeNull();expect(toastTypes()).toEqual(["error", "success"]);
    }, 503);
  });

  test("current 401 preserves login and the submitted draft", async () => {
    await fixture(async ({ actions, open, save, held, release, location, toastTypes }) => {
      open();actions.setNewName("draft");const pending = save();await held();release();await pending;
      expect(location.href).toBe("/auth/oidc/login?return_to=" + encodeURIComponent("/storage/space-a/a"));
      expect(actions.newName()).toBe("draft");expect(actions.showRenameModal()).toBe(true);expect(toastTypes()).toEqual(["error"]);
    }, 401);
  });

  test("duplicate save cannot overlap the current file request", async () => {
    await fixture(async ({ actions, open, save, held, release, patches }) => {
      open();actions.setNewName("first");const pending = save();await held();await save();expect(patches).toHaveLength(1);
      release();await pending;expect(actions.showRenameModal()).toBe(false);
    });
  });

  test("cancel/reopen serializes the same file but preserves its new draft", async () => {
    await fixture(async ({ actions, open, save, held, release, patches, toastTypes }) => {
      open();actions.setNewName("first");const pending = save();await held();actions.closeRenameModal();open();actions.setNewName("second");
      await save();expect(patches).toHaveLength(1);release();await pending;
      expect(actions.showRenameModal()).toBe(true);expect(actions.newName()).toBe("second");expect(toastTypes()).toEqual([]);
      await save();expect(patches[1].name).toBe("second");expect(actions.showRenameModal()).toBe(false);
    });
  });

  test("another file can save before an old canceled file response finishes", async () => {
    await fixture(async ({ actions, open, save, held, release, patches, toastTypes }) => {
      open();actions.setNewName("first");const pending = save();await held();actions.closeRenameModal();open("file-b");actions.setNewName("second");
      await save();expect(patches).toHaveLength(2);expect(actions.showRenameModal()).toBe(false);expect(toastTypes()).toEqual(["success"]);
      release();await pending;expect(toastTypes()).toEqual(["success"]);
    }, 503);
  });

  test("unchanged trimmed names have zero PATCH effects", async () => {
    await fixture(async ({ actions, open, save, release, patches }) => {
      open();actions.setNewName("  alpha  ");release();await save();expect(patches).toEqual([]);expect(actions.showRenameModal()).toBe(true);
    });
  });
}
