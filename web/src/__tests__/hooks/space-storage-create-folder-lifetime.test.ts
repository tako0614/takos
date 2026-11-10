import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";

if (Bun.env.TAKOS_STORAGE_CREATE_TEST_CLIENT !== "1") {
  test("folder creation uses the originating view through response headers and body", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_STORAGE_CREATE_TEST_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
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
    storage: ReturnType<typeof useSpaceStorage>; create: (name: string) => ReturnType<ReturnType<typeof useSpaceStorage>["createFolder"]>;
    retireSession: () => void; dispose: () => void; selectSpace: (id: string) => void;
    held: () => Promise<void>; release: () => void; posts: { space: string; name: string; parent_path: string }[];
    reads: string[]; location: { href: string };
  }) => Promise<void>, status = 200, phase: "headers" | "body" = "body") {
    const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/storage/space-a/a", pathname: "/storage/space-a/a", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, writable: true, value: location });
    const posts: { space: string; name: string; parent_path: string }[] = [], reads: string[] = [];
    const pending: Promise<unknown>[] = [], folders: Record<string, unknown>[] = [];
    let space = "space-a", dispose!: () => void, currentSession = true, entered = false, released = false;
    let response: Response | undefined, releaseResponse: (() => void) | undefined;
    const release = () => { released = true;releaseResponse?.();releaseResponse = undefined; };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), target = url.pathname.split("/")[3];
      if (request.method === "GET") {
        const path = url.searchParams.get("path") ?? "/";reads.push(`${target}:${path}`);
        return Response.json({ files: folders.filter(folder => folder.space_id === target && folder.parent_path === path), path });
      }
      expect(request.method).toBe("POST");expect(url.pathname.endsWith("/storage/folders")).toBe(true);
      const data = await request.json() as { name: string; parent_path: string };posts.push({ space: target, ...data });
      const first = posts.length === 1, currentStatus = first ? status : 200;
      const folder = { id: `folder-${posts.length}`, name: data.name, space_id: target, parent_path: data.parent_path,
        path: `${data.parent_path}/${data.name}`, type: "folder", parent_id: null, size: 0, mime_type: null,
        sha256: null, uploaded_by: null, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" };
      if (currentStatus === 200) folders.push(folder);
      const body = currentStatus === 200 ? { folder } : { error: "fixture_create_unavailable" };
      if (first && !released) {
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
      if (init?.method === "POST" && !response) response = result;
      return result;
    }) as typeof fetch;
    const storage = createRoot(cleanup => { dispose = cleanup;return useSpaceStorage(() => space); });
    try {
      await storage.loadFiles("/a");
      await run({ storage, dispose, selectSpace: value => { space = value; }, posts, reads, location, release,
        retireSession: () => { currentSession = false; },
        create: name => { const result = storage.createFolder(name, () => currentSession);pending.push(result);return result; },
        held: () => until(() => entered && (phase === "headers" || response?.body?.locked === true)),
      });
    } finally {
      release();await Promise.allSettled(pending);dispose();globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "location", descriptor);else Reflect.deleteProperty(globalThis, "location");
      server.stop(true);
    }
  }

  for (const retirement of ["session", "dispose"]) {
    test(`retired ${retirement} has no create dispatch`, async () => {
      await fixture(async ({ create, retireSession, dispose, release, posts }) => {
        if (retirement === "session") retireSession();else dispose();
        release();expect(await create("old")).toBeNull();expect(posts).toEqual([]);
      });
    });
  }

  for (const phase of ["headers", "body"] as const) {
    for (const [status, retirement] of [[200, "workspace"], [401, "folder"], [503, "aba"], [401, "dispose"]] as const) {
      test(`retired create ${phase} ${status}/${retirement} cannot affect the current view`, async () => {
        await fixture(async ({ storage, create, held, release, selectSpace, dispose, reads, location }) => {
          const pending = create("old");await held();
          if (retirement === "dispose") dispose();
          else {
            if (retirement !== "folder") selectSpace("space-b");await storage.loadFiles("/b");
            if (retirement === "aba") { selectSpace("space-a");await storage.loadFiles("/a"); }
          }
          const before = { href: location.href, reads: reads.length, error: storage.error(), files: storage.files() };
          release();expect(await pending).toBeNull();expect(location.href).toBe(before.href);
          expect(reads).toHaveLength(before.reads);expect(storage.error()).toBe(before.error);expect(storage.files()).toBe(before.files);
        }, status, phase);
      });
    }

    test(`canceled create ${phase} success still reconciles its current view`, async () => {
      await fixture(async ({ storage, create, held, retireSession, release, reads, posts }) => {
        const pending = create("first");await held();retireSession();const before = reads.length;release();
        expect((await pending)?.name).toBe("first");expect(reads).toHaveLength(before + 1);
        expect(storage.files().map(folder => folder.name)).toEqual(["first"]);expect(storage.error()).toBeNull();
        expect(posts).toEqual([{ space: "space-a", parent_path: "/a", name: "first" }]);
      }, 200, phase);
    });

    test(`canceled create ${phase} 401 cannot navigate a replacement dialog`, async () => {
      await fixture(async ({ storage, create, held, retireSession, release, reads, location }) => {
        const pending = create("first");await held();retireSession();const before = { href: location.href, reads: reads.length };release();
        expect(await pending).toBeNull();expect(location.href).toBe(before.href);
        expect(reads).toHaveLength(before.reads);expect(storage.error()).toBeNull();
      }, 401, phase);
    });
  }

  test("current create failure retains an explicit retry and its original parent", async () => {
    await fixture(async ({ storage, create, held, release, posts }) => {
      const pending = create("first");await held();release();expect(await pending).toBeNull();expect(storage.error()).not.toBeNull();
      expect((await create("second"))?.name).toBe("second");expect(storage.error()).toBeNull();
      expect(posts).toEqual([{ space: "space-a", parent_path: "/a", name: "first" }, { space: "space-a", parent_path: "/a", name: "second" }]);
    }, 503);
  });

  test("current create 401 keeps login and error feedback", async () => {
    await fixture(async ({ storage, create, held, release, location }) => {
      const pending = create("first");await held();release();expect(await pending).toBeNull();expect(storage.error()).not.toBeNull();
      expect(location.href).toBe("/auth/oidc/login?return_to=" + encodeURIComponent("/storage/space-a/a"));
    }, 401);
  });
}
