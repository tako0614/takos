import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { useFileUpload } from "../../hooks/useFileUpload.ts";
import { useToast } from "../../store/toast.ts";

if (Bun.env.TAKOS_STORAGE_UPLOAD_TEST_CLIENT !== "1") {
  test("storage uploads retain their selected target through actual HTTP stages", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_UPLOAD_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  type Stage = "upload-url" | "blob" | "confirm-upload";
  async function until(check: () => boolean) {
    const end = Date.now() + 1500;
    while (!check() && Date.now() < end) await Bun.sleep(1);
    expect(check()).toBe(true);
  }
  function selection(...names: string[]) {
    return names.map(name => new File([name], name, { type: "text/plain" })) as unknown as FileList;
  }
  async function fixture(run: (f: {
    storage: ReturnType<typeof useSpaceStorage>; batch: ReturnType<typeof useFileUpload>;
    selectSpace: (space: string) => void; dispose: () => void;
    held: () => Promise<void>; release: () => void;
    uploads: { space: string; parent: string; name: string }[];
    trace: string[]; location: { href: string }; toastCount: () => number;
  }) => Promise<void>, stage: Stage = "confirm-upload", status = 200) {
    const originalFetch = globalThis.fetch, locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/app/a/storage", pathname: "/app/a/storage", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: location });
    const toast = useToast(), initialToasts = new Set(toast.toasts.map(item => item.id));
    const uploads: { space: string; parent: string; name: string }[] = [], trace: string[] = [];
    let currentSpace = "space-a", dispose!: () => void, heldResponse: Response | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let releaseBlob: (() => void) | undefined, entered = false, releaseBody: (() => void) | undefined;
    let first = true;
    const pendingBatches: Promise<void>[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), action = url.pathname.split("/").at(-1)!;
      if (request.method === "GET") return Response.json({ files: [], path: url.searchParams.get("path") ?? "/" });
      const currentStage: Stage = request.method === "PUT" ? "blob" : action as Stage;
      trace.push(currentStage);
      let body: unknown;
      if (currentStage === "upload-url") {
        const data = await request.json() as { name: string; parent_path: string };
        uploads.push({ space: url.pathname.split("/")[3], parent: data.parent_path, name: data.name });
        body = { file_id: `file-${uploads.length}`, upload_url: `${server.url}blob`, r2_key: "fixture-key", expires_at: "2026-11-10T00:00:00Z" };
      } else if (currentStage === "confirm-upload") {
        const data = await request.json() as { file_id: string };
        body = { file: { id: data.file_id } };
      }
      if (first && currentStage === stage) {
        first = false;entered = true;
        if (stage === "blob") {
          await new Promise<void>(resolve => { releaseBlob = resolve; });
          return new Response(null, { status: 204 });
        }
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          stream = controller;controller.enqueue(new TextEncoder().encode(" "));
          releaseBody = () => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(status === 200 ? body : { error: "fixture_upload_unavailable" })));
            controller.close();stream = undefined;
          };
        } }), { status, headers: { "Content-Type": "application/json" } });
      }
      return currentStage === "blob" ? new Response(null, { status: 204 }) : Response.json(body);
    } });
    globalThis.fetch = (async (input, init) => {
      const response = await originalFetch(new URL(String(input), server.url), init);
      if (entered && !heldResponse && stage !== "blob") heldResponse = response;
      return response;
    }) as typeof fetch;
    const { storage, batch } = createRoot((cleanup) => {
      dispose = cleanup;
      const storage = useSpaceStorage(() => currentSpace);
      const actualBatch = useFileUpload({ uploadFile: storage.uploadFile, getScope: () => storage.uploadScope() });
      const batch = { ...actualBatch, handleFileSelect(files: FileList | null) {
        const pending = actualBatch.handleFileSelect(files);pendingBatches.push(pending);return pending;
      } };
      return { storage, batch };
    });
    const release = () => { releaseBlob?.();releaseBlob = undefined;releaseBody?.();releaseBody = undefined; };
    try {
      await storage.loadFiles("/a");
      await run({ storage, batch, dispose, uploads, trace, location, selectSpace: value => { currentSpace = value; },
        held: () => until(() => entered && (stage === "blob" || heldResponse?.body?.locked === true)), release,
        toastCount: () => toast.toasts.filter(item => !initialToasts.has(item.id)).length,
      });
    } finally {
      release();await Promise.allSettled(pendingBatches);stream?.close();dispose();globalThis.fetch = originalFetch;
      if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
      else Reflect.deleteProperty(globalThis, "location");
      for (const item of toast.toasts) if (!initialToasts.has(item.id)) toast.dismissToast(item.id);
      server.stop(true);
    }
  }

  for (const target of ["folder", "workspace", "aba", "missing-workspace", "dispose"] as const) {
    test(`a selected batch stops unsent files after ${target} retirement`, async () => {
      await fixture(async ({ storage, batch, held, release, selectSpace, dispose, uploads, toastCount }) => {
        const pending = batch.handleFileSelect(selection("first.txt", "second.txt"));await held();
        if (target === "dispose") dispose();
        else {
          if (target !== "folder") selectSpace(target === "missing-workspace" ? "" : "space-b");
          await storage.loadFiles("/b");
          if (target === "aba" || target === "missing-workspace") { selectSpace("space-a");await storage.loadFiles("/a"); }
        }
        release();await pending;
        expect(uploads).toEqual([{ space: "space-a", parent: "/a", name: "first.txt" }]);
        expect(toastCount()).toBe(0);
        if (target !== "dispose") expect(batch.uploading()).toBe(false);
      });
    });
  }

  for (const stage of ["upload-url", "blob"] as const) {
    test(`a retired ${stage} does not dispatch another upload stage`, async () => {
      await fixture(async ({ storage, batch, held, release, selectSpace, trace }) => {
        const pending = batch.handleFileSelect(selection("first.txt", "second.txt"));await held();
        selectSpace("space-b");await storage.loadFiles("/b");release();await pending;
        expect(trace).toEqual(stage === "upload-url" ? ["upload-url"] : ["upload-url", "blob"]);
        expect(storage.error()).toBeNull();expect(batch.uploading()).toBe(false);
      }, stage);
    });
  }

  for (const status of [401, 503]) {
    test(`a retired upload ${status} has no login, error or toast effect`, async () => {
      await fixture(async ({ storage, batch, held, release, selectSpace, location, toastCount, uploads }) => {
        const pending = batch.handleFileSelect(selection("first.txt", "second.txt"));await held();
        selectSpace("space-b");await storage.loadFiles("/b");const before = location.href;
        release();await pending;
        expect(location.href).toBe(before);expect(storage.error()).toBeNull();expect(toastCount()).toBe(0);
        expect(uploads).toHaveLength(1);expect(batch.uploading()).toBe(false);
      }, "confirm-upload", status);
    });
  }

  test("a current batch snapshots selection and completes both files in the selected folder", async () => {
    await fixture(async ({ batch, held, release, uploads, toastCount }) => {
      const files = selection("first.txt", "second.txt"), pending = batch.handleFileSelect(files);await held();
      (files as unknown as File[])[1] = new File(["changed"], "changed.txt");
      release();await pending;
      expect(uploads).toEqual(["first.txt", "second.txt"].map(name => ({ space: "space-a", parent: "/a", name })));
      expect(batch.uploading()).toBe(false);expect(toastCount()).toBe(1);
    });
  });

  test("an active batch refuses a second concurrent selection", async () => {
    await fixture(async ({ batch, held, release, uploads }) => {
      const pending = batch.handleFileSelect(selection("first.txt"));await held();
      await batch.handleFileSelect(selection("other.txt"));
      expect(uploads).toHaveLength(1);expect(batch.uploading()).toBe(true);
      release();await pending;expect(batch.uploading()).toBe(false);
    });
  });

  test("a current failed file leaves a visible error and permits a separate manual selection", async () => {
    await fixture(async ({ storage, batch, held, release, uploads, toastCount }) => {
      const pending = batch.handleFileSelect(selection("first.txt"));await held();release();await pending;
      expect(storage.error()).not.toBeNull();expect(batch.uploading()).toBe(false);expect(toastCount()).toBe(1);
      await batch.handleFileSelect(selection("second.txt"));
      expect(storage.error()).toBeNull();expect(uploads).toHaveLength(2);expect(batch.uploading()).toBe(false);
    }, "confirm-upload", 503);
  });

  test("a current upload 401 retains the normal login return route", async () => {
    await fixture(async ({ storage, batch, held, release, location, uploads }) => {
      const pending = batch.handleFileSelect(selection("first.txt", "second.txt"));await held();release();await pending;
      expect(location.href).toBe("/auth/oidc/login?return_to=" + encodeURIComponent("/app/a/storage"));
      expect(storage.error()).not.toBeNull();expect(batch.uploading()).toBe(false);expect(uploads).toHaveLength(1);
    }, "confirm-upload", 401);
  });

  test("a callback exception releases the batch for a separate manual selection", async () => {
    const toast = useToast(), before = new Set(toast.toasts.map(item => item.id));
    let dispose!: () => void, attempts = 0;
    const scope = Symbol("fixture-scope");
    const batch = createRoot(cleanup => { dispose = cleanup;return useFileUpload({
      getScope: () => scope, uploadFile: async () => { attempts++;throw new Error("fixture callback failure"); },
    }); });
    try {
      await batch.handleFileSelect(selection("first.txt", "not-dispatched.txt"));expect(batch.uploading()).toBe(false);expect(attempts).toBe(1);
      await batch.handleFileSelect(selection("second.txt"));expect(batch.uploading()).toBe(false);expect(attempts).toBe(2);
    } finally {
      dispose();for (const item of toast.toasts) if (!before.has(item.id)) toast.dismissToast(item.id);
    }
  });
}
