import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useStorageActions } from "../../hooks/useStorageActions.ts";
import { useToast } from "../../store/toast.ts";

if (Bun.env.TAKOS_STORAGE_OPEN_TEST_CLIENT !== "1") {
  test("Open and Download responses belong to their original view and intent", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_OPEN_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  async function until(check: () => boolean) {
    const end = Date.now() + 1500;
    while (!check() && Date.now() < end) await Bun.sleep(1);
    expect(check()).toBe(true);
  }
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>; actions: ReturnType<typeof useStorageActions>;
    open: (id?: string) => Promise<void>; download: (id?: string) => Promise<void>;
    selectSpace: (space: string) => void; dispose: () => void;
    held: () => Promise<void>; release: () => void; reads: string[]; urls: string[];
    windows: unknown[][]; location: { href: string }; toastTypes: () => string[];
  }) => Promise<void>, status = 200, phase: "headers" | "body" = "body") {
    const originalFetch = globalThis.fetch, locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location"),
      openDescriptor = Object.getOwnPropertyDescriptor(globalThis, "open");
    const location = { href: "/storage/space-a/a", pathname: "/storage/space-a/a", search: "" };
    const windows: unknown[][] = [];
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: location });
    Object.defineProperty(globalThis, "open", { configurable: true, writable: true, value: (...args: unknown[]) => { windows.push(args); } });
    const toast = useToast(), beforeToasts = new Set(toast.toasts.map(item => item.id));
    const reads: string[] = [], urls: string[] = [], pending: Promise<void>[] = [];
    let space = "space-a", dispose!: () => void, entered = false, released = false;
    let response: Response | undefined, releaseResponse: (() => void) | undefined;
    const release = () => { released = true;releaseResponse?.();releaseResponse = undefined; };
    const file = (id: string, target: string, path: string) => ({ id, name: `${id}.png`, space_id: target,
      path: `${path}/${id}.png`, type: "file" as const, parent_id: null, size: 1, mime_type: "image/png",
      sha256: null, uploaded_by: null, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), target = url.pathname.split("/")[3];expect(request.method).toBe("GET");
      if (url.pathname.endsWith("/download-url")) {
        const id = url.searchParams.get("file_id")!;urls.push(`${target}:${id}`);
        const first = urls.length === 1, currentStatus = first ? status : 200;
        const body = currentStatus === 200 ? { download_url: new URL(`/fixture/${target}/${id}.png`, request.url).href }
          : { error: "fixture_download_unavailable" };
        if (first && !released) {
          entered = true;
          if (phase === "headers") await new Promise<void>(resolve => { releaseResponse = resolve; });
          else return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(new TextEncoder().encode(" "));
            releaseResponse = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close(); };
          } }), { status: currentStatus, headers: { "Content-Type": "application/json" } });
        }
        return Response.json(body, { status: currentStatus });
      }
      expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
      const path = url.searchParams.get("path") ?? "/";reads.push(`${target}:${path}`);
      return Response.json({ path, files: [file("file-a", target, path), file("file-b", target, path)] });
    } });
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input), server.url);expect(url.origin).toBe(server.url.origin);
      const result = await originalFetch(url, init);
      if (url.pathname.endsWith("/download-url") && !response) response = result;
      return result;
    }) as typeof fetch;
    const { storage, actions } = createRoot(cleanup => {
      dispose = cleanup;const storage = useSpaceStorage(() => space), [, setSelected] = createSignal(new Set<string>());
      return { storage, actions: useStorageActions({ ...storage, getScope: storage.uploadScope, setSelectedFiles: setSelected }) };
    });
    const start = (id: string, download: boolean) => {
      const target = storage.files().find(item => item.id === id)!;
      const result = download ? actions.handleDownload(target) : actions.handleOpenFile(target);pending.push(result);return result;
    };
    try {
      await storage.loadFiles("/a");
      await run({ storage, actions, dispose, selectSpace: value => { space = value; }, reads, urls, windows, location, release,
        open: (id = "file-a") => start(id, false), download: (id = "file-a") => start(id, true),
        held: () => until(() => entered && (phase === "headers" || response?.body?.locked === true)),
        toastTypes: () => toast.toasts.filter(item => !beforeToasts.has(item.id)).map(item => item.type),
      });
    } finally {
      release();await Promise.allSettled(pending);dispose();globalThis.fetch = originalFetch;
      if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);else Reflect.deleteProperty(globalThis, "location");
      if (openDescriptor) Object.defineProperty(globalThis, "open", openDescriptor);else Reflect.deleteProperty(globalThis, "open");
      for (const item of toast.toasts) if (!beforeToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  test("disposed actions cannot dispatch Open or Download", async () => {
    await fixture(async ({ open, download, dispose, release, urls, windows, actions }) => {
      dispose();release();await open();await download();expect(urls).toEqual([]);expect(windows).toEqual([]);expect(actions.viewingFile()).toBeNull();
    });
  });

  for (const phase of ["headers", "body"] as const) {
    for (const [status, retirement] of [[200, "workspace"], [401, "folder"], [503, "aba"], [401, "dispose"]] as const) {
      test(`old Open ${phase} ${status}/${retirement} has no current view effects`, async () => {
        await fixture(async ({ storage, actions, open, held, release, selectSpace, dispose, reads, location, toastTypes }) => {
          const pending = open();await held();
          if (retirement === "dispose") dispose();
          else {
            if (retirement !== "folder") selectSpace("space-b");await storage.loadFiles("/b");
            if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
          }
          const before = { href: location.href, reads: reads.length, error: storage.error() };release();await pending;
          expect(actions.viewingFile()).toBeNull();expect(actions.viewingFileDownloadUrl()).toBeNull();expect(location.href).toBe(before.href);
          expect(reads).toHaveLength(before.reads);expect(storage.error()).toBe(before.error);expect(toastTypes()).toEqual([]);
        }, status, phase);
      });
    }
    for (const status of [200, 401]) {
      test(`Close retires pending Open ${phase}/${status} without requiring navigation`, async () => {
        await fixture(async ({ storage, actions, open, held, release, location }) => {
          const pending = open();await held();actions.handleCloseViewer();const before = location.href;release();await pending;
          expect(actions.viewingFile()).toBeNull();expect(actions.viewingFileDownloadUrl()).toBeNull();expect(location.href).toBe(before);expect(storage.error()).toBeNull();
        }, status, phase);
      });
    }
    for (const status of [200, 401, 503]) {
      test(`newer Open wins over earlier ${phase}/${status} in the same folder`, async () => {
        await fixture(async ({ storage, actions, open, held, release, location }) => {
          const pending = open();await held();await open("file-b");const before = location.href;release();await pending;
          expect(actions.viewingFile()?.id).toBe("file-b");expect(actions.viewingFileDownloadUrl()).toEndWith("/fixture/space-a/file-b.png");
          expect(location.href).toBe(before);expect(storage.error()).toBeNull();
        }, status, phase);
      });
    }
    for (const status of [200, 401, 503]) {
      test(`old Download ${phase}/${status} cannot open a window or toast in a new view`, async () => {
        await fixture(async ({ storage, download, held, release, selectSpace, windows, location, toastTypes }) => {
          const pending = download();await held();selectSpace("space-b");await storage.loadFiles("/b");const before = location.href;
          release();await pending;expect(windows).toEqual([]);expect(location.href).toBe(before);expect(storage.error()).toBeNull();expect(toastTypes()).toEqual([]);
        }, status, phase);
      });
    }
  }

  test("current Open uses the authorized URL and Close clears it", async () => {
    await fixture(async ({ actions, open, release, urls }) => {
      release();await open();expect(urls).toEqual(["space-a:file-a"]);expect(actions.viewingFile()?.id).toBe("file-a");
      expect(actions.viewingFileDownloadUrl()).toEndWith("/fixture/space-a/file-a.png");actions.handleCloseViewer();
      expect(actions.viewingFile()).toBeNull();expect(actions.viewingFileDownloadUrl()).toBeNull();
    });
  });
  test("current failed Open can explicitly retry without retaining the old error", async () => {
    await fixture(async ({ storage, actions, open, held, release, urls }) => {
      const pending = open();await held();release();await pending;expect(storage.error()).not.toBeNull();
      await open();expect(urls).toHaveLength(2);expect(actions.viewingFileDownloadUrl()).toEndWith("/fixture/space-a/file-a.png");expect(storage.error()).toBeNull();
    }, 503);
  });
  test("current Open 401 retains canonical login and error feedback", async () => {
    await fixture(async ({ storage, open, held, release, location }) => {
      const pending = open();await held();release();await pending;expect(storage.error()).not.toBeNull();
      expect(location.href).toBe("/auth/oidc/login?return_to=" + encodeURIComponent("/storage/space-a/a"));
    }, 401);
  });
  test("current Download opens exactly the returned URL with existing window protections", async () => {
    await fixture(async ({ download, release, windows, actions, toastTypes }) => {
      release();await download();expect(windows).toHaveLength(1);expect(windows[0][0]).toEndWith("/fixture/space-a/file-a.png");
      expect(windows[0].slice(1)).toEqual(["_blank", "noopener,noreferrer"]);expect(actions.viewingFile()).toBeNull();expect(toastTypes()).toEqual([]);
    });
  });
  for (const status of [401, 503]) {
    test(`current Download ${status} retains failure feedback`, async () => {
      await fixture(async ({ storage, download, held, release, windows, toastTypes, location }) => {
        const pending = download();await held();release();await pending;expect(windows).toEqual([]);expect(storage.error()).not.toBeNull();expect(toastTypes()).toEqual(["error"]);
        expect(location.href.startsWith("/auth/oidc/login")).toBe(status === 401);
      }, status);
    });
  }
}
