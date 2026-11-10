import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { parseHTML } from "linkedom";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useStorageActions } from "../../hooks/useStorageActions.ts";
import { useToast } from "../../store/toast.ts";

if (Bun.env.TAKOS_STORAGE_ZIP_TEST_CLIENT !== "1") {
  test("ZIP target, bytes and feedback belong to their originating view", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_ZIP_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
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
    download: () => Promise<void>; selectSpace: (space: string) => void; dispose: () => void;
    held: (number?: number) => Promise<void>; release: (number?: number) => void;
    requests: string[]; downloads: { name: string; entries?: Record<string, string> }[];
    archive: (space: string, path: string) => Uint8Array; drain: () => Promise<void>; toastTypes: () => string[];
  }) => Promise<void>, status = 200, phase: "headers" | "body" = "body", holdSecond = false) {
    const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const { document } = parseHTML("<!doctype html><html><body></body></html>");
    Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: document });
    const toast = useToast(), beforeToasts = new Set(toast.toasts.map(item => item.id));
    const requests: string[] = [], downloads: { name: string; entries?: Record<string, string> }[] = [], pending: Promise<void>[] = [], blobReads: Promise<void>[] = [];
    const responses = new Map<number, Response>(), releases = new Map<number, () => void>(), released = new Set<number>(), entered = new Set<number>();
    const archives = new Map<string, Uint8Array>();
    const archive = (space: string, path: string) => {
      const key = `${space}:${path}`;
      if (!archives.has(key)) archives.set(key, zipSync({ "origin.txt": strToU8(key) }));
      return archives.get(key)!;
    };
    let space = "space-a", dispose!: () => void, attempts = 0;
    const release = (number = 1) => { released.add(number);releases.get(number)?.();releases.delete(number); };
    document.addEventListener("click", event => {
      const anchor = event.target as HTMLAnchorElement;if (anchor.tagName !== "A") return;
      const download: { name: string; entries?: Record<string, string> } = { name: anchor.download };downloads.push(download);
      blobReads.push(originalFetch(anchor.href).then(response => response.arrayBuffer()).then(buffer => {
        download.entries = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buffer))).map(([name, data]) => [name, strFromU8(data)]));
      }));
    });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), target = url.pathname.split("/")[3], path = url.searchParams.get("path") ?? "/";
      expect(request.method).toBe("GET");
      if (url.pathname.endsWith("/download-zip")) {
        requests.push(`${target}:${path}`);const number = requests.length, code = number === 1 ? status : 200;
        const payload = code === 200 ? archive(target, path) : new TextEncoder().encode(JSON.stringify({ error: "fixture_zip_unavailable" }));
        const headers = { "Content-Type": code === 200 ? "application/zip" : "application/json" };
        if ((number === 1 || (number === 2 && holdSecond)) && !released.has(number)) {
          entered.add(number);
          if (phase === "headers" && number === 1) await new Promise<void>(resolve => { releases.set(number, resolve); });
          else {
            const prefix = code === 200 ? payload.subarray(0, 8) : new TextEncoder().encode(" ");
            return new Response(new ReadableStream<Uint8Array>({ start(controller) {
              controller.enqueue(prefix);
              releases.set(number, () => { controller.enqueue(code === 200 ? payload.subarray(8) : payload);controller.close(); });
            } }), { status: code, headers });
          }
        }
        return new Response(payload.slice().buffer, { status: code, headers });
      }
      expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
      return Response.json({ files: [], path });
    } });
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input), server.url);expect(url.origin).toBe(server.url.origin);
      const number = url.pathname.endsWith("/download-zip") ? ++attempts : undefined;
      const response = await originalFetch(url, init);if (number) responses.set(number, response);return response;
    }) as typeof fetch;
    const { storage, actions } = createRoot(cleanup => {
      dispose = cleanup;const storage = useSpaceStorage(() => space), [, setSelected] = createSignal(new Set<string>());
      return { storage, actions: useStorageActions({ ...storage, getScope: storage.uploadScope, setSelectedFiles: setSelected }) };
    });
    try {
      await storage.loadFiles("/a");
      await run({ storage, actions, dispose, selectSpace: value => { space = value; }, requests, downloads, archive,
        download: () => { const result = actions.handleDownloadZip();pending.push(result);return result; }, release,
        held: (number = 1) => until(() => entered.has(number) && (phase === "headers" && number === 1 || responses.get(number)?.body?.locked === true)),
        drain: () => Promise.all(blobReads).then(() => {}),
        toastTypes: () => toast.toasts.filter(item => !beforeToasts.has(item.id)).map(item => item.type),
      });
    } finally {
      for (let number = 1; number <= attempts + 2; number++) release(number);
      await Promise.allSettled(pending);await Promise.allSettled(blobReads);dispose();globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "document", descriptor);else Reflect.deleteProperty(globalThis, "document");
      for (const item of toast.toasts) if (!beforeToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  for (const retirement of ["dispose", "unlisted-space"] as const) {
    test(`${retirement} cannot dispatch a ZIP`, async () => {
      await fixture(async ({ dispose, selectSpace, download, release, requests, actions, downloads }) => {
        if (retirement === "dispose") dispose();else selectSpace("space-b");
        release();await download();expect(requests).toEqual([]);expect(downloads).toEqual([]);expect(actions.downloadingZip()).toBe(false);
      });
    });
  }
  for (const phase of ["headers", "body"] as const) {
    for (const [status, retirement] of [[200, "workspace"], [401, "folder"], [503, "aba"], [200, "dispose"]] as const) {
      test(`retired ZIP ${phase}/${status}/${retirement} has no current effects`, async () => {
        await fixture(async ({ storage, actions, download, held, release, selectSpace, dispose, downloads, toastTypes }) => {
          const pending = download();await held();
          if (retirement === "dispose") dispose();
          else {
            if (retirement !== "folder") selectSpace("space-b");await storage.loadFiles("/b");
            if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
          }
          expect(actions.downloadingZip()).toBe(false);expect(actions.downloadedZipBytes()).toBe(0);
          const error = storage.error();release();await pending;
          expect(downloads).toEqual([]);expect(toastTypes()).toEqual([]);expect(storage.error()).toBe(error);expect(actions.downloadedZipBytes()).toBe(0);
        }, status, phase);
      });
    }
    for (const target of ["workspace", "aba"] as const) {
      test(`new ${target} ZIP starts while old ${phase} is pending and keeps its busy flag`, async () => {
        await fixture(async ({ storage, actions, download, held, release, selectSpace, downloads, requests, drain, archive, toastTypes }) => {
          const first = download();await held();selectSpace("space-b");await storage.loadFiles("/b");
          if (target === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
          expect(actions.downloadingZip()).toBe(false);const second = download();await held(2);
          release();await first;expect(actions.downloadingZip()).toBe(true);expect(actions.downloadedZipBytes()).toBe(0);expect(downloads).toEqual([]);expect(toastTypes()).toEqual([]);
          await download();expect(requests).toHaveLength(2);release(2);await second;await drain();
          const space = target === "aba" ? "space-a" : "space-b", path = target === "aba" ? "/a" : "/b";
          expect(downloads).toEqual([{ name: path.slice(1) + ".zip", entries: { "origin.txt": `${space}:${path}` } }]);
          expect(actions.downloadingZip()).toBe(false);expect(actions.downloadedZipBytes()).toBe(archive(space, path).length);expect(toastTypes()).toEqual(["success"]);
        }, 200, phase, true);
      });
    }
  }
  for (const path of ["/a", "/"]) {
    test(`current ZIP ${path} preserves filename and exact archive content`, async () => {
      await fixture(async ({ storage, download, held, release, downloads, drain, actions, archive }) => {
        await storage.loadFiles(path);const pending = download();await held();release();await pending;await drain();
        expect(downloads).toEqual([{ name: path === "/" ? "workspace.zip" : "a.zip", entries: { "origin.txt": `space-a:${path}` } }]);
        expect(actions.downloadedZipBytes()).toBe(archive("space-a", path).length);expect(actions.downloadingZip()).toBe(false);
      });
    });
  }
  test("same-folder refresh preserves a current ZIP and duplicate click dispatches once", async () => {
    await fixture(async ({ storage, download, held, release, requests, downloads, drain, actions }) => {
      const pending = download();await held();await storage.loadFiles("/a");expect(actions.downloadingZip()).toBe(true);
      await download();expect(requests).toHaveLength(1);release();await pending;await drain();expect(downloads).toHaveLength(1);
    });
  });
  for (const status of [401, 503]) {
    test(`current ZIP ${status} keeps error feedback and allows explicit retry`, async () => {
      await fixture(async ({ storage, download, held, release, downloads, drain, actions, toastTypes, requests }) => {
        const pending = download();await held();release();await pending;expect(storage.error()).not.toBeNull();expect(actions.downloadingZip()).toBe(false);
        expect(downloads).toEqual([]);expect(toastTypes()).toEqual(["error"]);await download();await drain();
        expect(requests).toHaveLength(2);expect(downloads).toHaveLength(1);expect(storage.error()).toBeNull();expect(toastTypes()).toEqual(["error", "success"]);
      }, status);
    });
  }
}
