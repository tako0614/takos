import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useStorageActions } from "../../hooks/useStorageActions.ts";
import { useStorageBulkOperations } from "../../hooks/useStorageBulkOperations.ts";
import { useConfirmDialogActions, useConfirmDialogState } from "../../store/confirm-dialog.ts";
import { useToast } from "../../store/toast.ts";
import type { StorageFile } from "../../types/index.ts";

if (Bun.env.TAKOS_STORAGE_DELETE_TEST_CLIENT !== "1") {
  test("storage delete intent and feedback use the originating browser view", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_DELETE_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  type Kind = "single" | "selected";
  type Mutation = { space: string; ids: string[] };
  const file = (id: string, space = "space-a", path = "/a"): StorageFile => ({
    id, name: id, type: "file", path: `${path}/${id}`, parent_id: null, space_id: space, sha256: null, uploaded_by: null,
    size: 1, mime_type: "text/plain", created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z",
  });
  async function until(check: () => boolean) {
    const end = Date.now() + 1500;
    while (!check() && Date.now() < end) await Bun.sleep(1);
    expect(check()).toBe(true);
  }
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>;
    start: (kind: Kind, id?: string) => Promise<void>; confirm: () => void; cancel: () => void; dialogOpen: () => boolean;
    held: () => Promise<void>; release: () => void; dispose: () => void;
    selectSpace: (space: string) => void; selected: () => Set<string>; select: (ids: string[]) => void;
    mutations: Mutation[]; reads: { space: string; path: string }[];
    location: { href: string }; toastCount: () => number; toastTypes: () => string[];
  }) => Promise<void>, status = 200, phase: "body" | "headers" = "body", failedIds: string[] = []) {
    const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/storage/space-a/a", pathname: "/storage/space-a/a", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: location });
    const toast = useToast(), initialToasts = new Set(toast.toasts.map(item => item.id));
    const dialog = useConfirmDialogState(), dialogActions = useConfirmDialogActions();
    const mutations: Mutation[] = [], reads: { space: string; path: string }[] = [], deleted = new Set<string>();
    const pendingActions: Promise<void>[] = [];
    let space = "space-a", dispose!: () => void, entered = false, released = false, first = true;
    let response: Response | undefined, releaseResponse: (() => void) | undefined;
    const release = () => { released = true;releaseResponse?.();releaseResponse = undefined; };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), target = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
        const path = url.searchParams.get("path") ?? "/";reads.push({ space: target, path });
        const ids = target === "space-a" ? ["file-a", "file-a2", "file-later"] : ["file-b"];
        return Response.json({ files: ids.filter(id => !deleted.has(`${target}:${id}`)).map(id => file(id, target, path)), path });
      }
      let ids: string[];
      if (request.method === "DELETE") ids = [url.pathname.split("/").at(-1)!];
      else {
        expect(request.method).toBe("POST");expect(url.pathname).toMatch(/\/storage\/bulk-delete$/);
        ids = (await request.json() as { file_ids: string[] }).file_ids;
      }
      mutations.push({ space: target, ids });
      const currentStatus = first ? status : 200, hold = first;first = false;
      const rejected = hold ? ids.filter(id => failedIds.includes(id)) : [];
      if (currentStatus === 200) for (const id of ids) if (!rejected.includes(id)) deleted.add(`${target}:${id}`);
      const body = currentStatus === 200
        ? { success: true, deleted_count: ids.length - rejected.length, error_count: rejected.length, failed_ids: rejected }
        : { error: "fixture_delete_unavailable" };
      if (hold && !released) {
        entered = true;
        if (phase === "headers") {
          await new Promise<void>(resolve => { releaseResponse = resolve; });
        } else {
          return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(new TextEncoder().encode(" "));
            releaseResponse = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close(); };
          } }), { status: currentStatus, headers: { "Content-Type": "application/json" } });
        }
      }
      return Response.json(body, { status: currentStatus });
    } });
    globalThis.fetch = (async (input, init) => {
      const result = await originalFetch(new URL(String(input), server.url), init);
      if (init?.method && init.method !== "GET" && !response) response = result;
      return result;
    }) as typeof fetch;
    const state = createRoot(cleanup => {
      dispose = cleanup;
      const storage = useSpaceStorage(() => space), [selected, setSelected] = createSignal(new Set(["file-a", "file-a2"]));
      const actions = useStorageActions({ ...storage, getScope: storage.uploadScope, setSelectedFiles: setSelected });
      const bulk = useStorageBulkOperations({ ...storage, getScope: storage.uploadScope, selectedFiles: selected, setSelectedFiles: setSelected });
      return { storage, actions, bulk, selected, setSelected };
    });
    try {
      await state.storage.loadFiles("/a");
      await run({ storage: state.storage, mutations, reads, location, dispose,
        start: (kind, id = "file-a") => {
          const pending = kind === "single" ? state.actions.handleDelete(file(id, space)) : state.bulk.handleBulkDelete();
          pendingActions.push(pending);return pending;
        },
        confirm: dialogActions.handleConfirm, cancel: dialogActions.handleCancel, dialogOpen: () => dialog().isOpen,
        selected: state.selected, select: ids => state.setSelected(new Set(ids)), selectSpace: value => { space = value; },
        held: () => until(() => entered && (phase === "headers" || response?.body?.locked === true)), release,
        toastCount: () => toast.toasts.filter(item => !initialToasts.has(item.id)).length,
        toastTypes: () => toast.toasts.filter(item => !initialToasts.has(item.id)).map(item => item.type),
      });
    } finally {
      // Failed assertions must not let an earlier action contaminate a later fixture.
      release();if (dialog().isOpen) dialogActions.handleCancel();await Promise.allSettled(pendingActions);
      dispose();globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "location", descriptor);else Reflect.deleteProperty(globalThis, "location");
      for (const item of toast.toasts) if (!initialToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  for (const kind of ["single", "selected"] as const) {
    for (const [status, retirement] of [[401, "workspace"], [503, "folder"], [200, "aba"], [200, "dispose"]] as const) {
      test(`retired ${kind} delete ${status}/${retirement} has no current feedback or readback`, async () => {
        await fixture(async ({ storage, start, confirm, held, release, selectSpace, select, selected, dispose, reads, location, toastCount }) => {
          const pending = start(kind);confirm();await held();
          if (retirement === "dispose") dispose();
          else {
            if (retirement !== "folder") selectSpace("space-b");
            await storage.loadFiles("/b");
            if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
          }
          select(["file-later"]);
          const before = { href: location.href, error: storage.error(), reads: reads.length };
          release();await pending;
          expect(location.href).toBe(before.href);expect(storage.error()).toBe(before.error);
          expect(reads).toHaveLength(before.reads);expect(toastCount()).toBe(0);
          expect([...selected()]).toEqual(["file-later"]);
        }, status);
      });
    }

    for (const retirement of ["workspace", "aba", "dispose"] as const) {
      test(`late ${kind} confirmation cannot delete after ${retirement}`, async () => {
        await fixture(async ({ storage, start, confirm, dialogOpen, selectSpace, dispose, mutations, toastCount, release }) => {
          const pending = start(kind);expect(dialogOpen()).toBe(true);
          if (retirement === "dispose") dispose();
          else {
            selectSpace("space-b");await storage.loadFiles("/b");
            if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
          }
          confirm();release();await pending;expect(mutations).toEqual([]);expect(toastCount()).toBe(0);
        });
      });
    }

    test(`a retired ${kind} response header cannot redirect the new view`, async () => {
      await fixture(async ({ storage, start, confirm, held, release, selectSpace, location, toastCount }) => {
        const pending = start(kind);confirm();await held();selectSpace("space-b");await storage.loadFiles("/b");
        const before = location.href;release();await pending;
        expect(location.href).toBe(before);expect(storage.error()).toBeNull();expect(toastCount()).toBe(0);
      }, 401, "headers");
    });

    test(`a current ${kind} success reads back once and preserves newer selection`, async () => {
      await fixture(async ({ storage, start, confirm, held, release, select, selected, mutations, reads, toastCount }) => {
        const pending = start(kind);confirm();await held();select(["file-a", "file-later"]);release();await pending;
        expect(mutations).toEqual([{ space: "space-a", ids: kind === "single" ? ["file-a"] : ["file-a", "file-a2"] }]);
        expect(reads).toEqual([{ space: "space-a", path: "/a" }, { space: "space-a", path: "/a" }]);
        expect([...selected()]).toEqual(["file-later"]);expect(storage.files().some(item => item.id === "file-a")).toBe(false);
        expect(storage.error()).toBeNull();expect(toastCount()).toBe(1);
      });
    });

    test(`current ${kind} failure permits a separate confirmed retry without automatic replay`, async () => {
      await fixture(async ({ storage, start, confirm, held, release, mutations, toastCount }) => {
        const pending = start(kind);confirm();await held();release();await pending;
        expect(storage.error()).not.toBeNull();expect(mutations).toHaveLength(1);expect(toastCount()).toBe(1);
        const retry = start(kind);confirm();await retry;
        expect(mutations).toHaveLength(2);expect(storage.error()).toBeNull();expect(toastCount()).toBe(2);
      }, 503);
    });

    test(`current ${kind} 401 retains login and visible failure`, async () => {
      await fixture(async ({ storage, start, confirm, held, release, mutations, location, toastCount }) => {
        const pending = start(kind);confirm();await held();release();await pending;
        expect(location.href).toBe("/auth/oidc/login?return_to=" + encodeURIComponent("/storage/space-a/a"));
        expect(storage.error()).not.toBeNull();expect(mutations).toHaveLength(1);expect(toastCount()).toBe(1);
      }, 401);
    });

    test(`canceling ${kind} confirmation has no mutation and releases the intent`, async () => {
      await fixture(async ({ start, cancel, confirm, dialogOpen, held, release, mutations, toastCount }) => {
        const canceled = start(kind);cancel();await canceled;expect(mutations).toEqual([]);expect(toastCount()).toBe(0);
        const pending = start(kind);expect(dialogOpen()).toBe(true);confirm();await held();release();await pending;
        expect(mutations).toHaveLength(1);
      });
    });

    test(`an active ${kind} delete cannot open another confirmation`, async () => {
      await fixture(async ({ start, confirm, held, release, dialogOpen, mutations }) => {
        const pending = start(kind);confirm();await held();const duplicate = start(kind);
        expect(dialogOpen()).toBe(false);await duplicate;expect(mutations).toHaveLength(1);release();await pending;
      });
    });

    test(`a pending old ${kind} delete does not block a newly confirmed Workspace operation`, async () => {
      await fixture(async ({ storage, start, confirm, dialogOpen, held, release, selectSpace, select, mutations, location, toastCount }) => {
        const old = start(kind);confirm();await held();selectSpace("space-b");await storage.loadFiles("/b");select(["file-b"]);
        const current = start(kind, "file-b");expect(dialogOpen()).toBe(true);confirm();await current;
        expect(mutations).toEqual([{ space: "space-a", ids: kind === "single" ? ["file-a"] : ["file-a", "file-a2"] }, { space: "space-b", ids: ["file-b"] }]);
        const before = location.href;expect(toastCount()).toBe(1);release();await old;
        expect(location.href).toBe(before);expect(storage.error()).toBeNull();expect(toastCount()).toBe(1);
      }, 401);
    });
  }

  test("selected deletion confirms original IDs rather than a later selection", async () => {
    await fixture(async ({ start, confirm, held, release, select, selected, mutations }) => {
      const pending = start("selected");select(["file-later"]);confirm();await held();release();await pending;
      expect(mutations).toEqual([{ space: "space-a", ids: ["file-a", "file-a2"] }]);
      expect([...selected()]).toEqual(["file-later"]);
    });
  });

  test("a partial selected delete retains failed and newer IDs with failure feedback", async () => {
    await fixture(async ({ storage, start, confirm, held, release, select, selected, mutations, toastTypes }) => {
      const pending = start("selected");confirm();await held();select(["file-a2", "file-later"]);release();await pending;
      expect(mutations).toEqual([{ space: "space-a", ids: ["file-a", "file-a2"] }]);
      expect(storage.files().map(item => item.id)).toEqual(["file-a2", "file-later"]);
      expect([...selected()]).toEqual(["file-a2", "file-later"]);
      expect(storage.error()).not.toBeNull();expect(toastTypes()).toEqual(["error"]);
    }, 200, "body", ["file-a2"]);
  });
}
