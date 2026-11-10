import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual direct-file route opens once and Back returns to its folder", async () => {
  if (process.env.TAKOS_STORAGE_DIRECT_UI_PROCESS === "1") { await verifyDirectFileUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_STORAGE_DIRECT_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage direct-file UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifyDirectFileUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-direct-file-ui-"));
  const urls: { space: string; id: string }[] = [], lists: string[] = [], requests: string[] = [];
  let includeMissing = false, includeLater = false, holdNextList = false, decodedLists = 0;
  let listResponse: Response | undefined, lateListResponse: Response | undefined, heldResponse: Response | undefined, decoded = false;
  let releaseList: (() => void) | undefined, releaseLateList: (() => void) | undefined, releaseURL: (() => void) | undefined;
  type FileRoute = { spaceId: string; path: string; filePath?: string };
  let fixture: { setRoute: (route: FileRoute) => void; route: () => FileRoute; setNotify: (value: boolean) => void;
    navigations: { view?: string; spaceId?: string; storagePath?: string; filePath?: string }[];
    remount: () => void; dispose: () => void; clearToasts: () => void } | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];expect(request.method).toBe("GET");
      if (url.pathname.endsWith("/file-handlers")) return Response.json({ handlers: [] });
      if (url.pathname.endsWith("/download-url")) {
        const id = url.searchParams.get("file_id")!;urls.push({ space, id });
        if (urls.length === 4) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(" "));
          releaseURL = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: "fixture_retired_auth" })));controller.close();releaseURL = undefined; };
        } }), { status: 401, headers: { "Content-Type": "application/json" } });
        return Response.json({ download_url: new URL(`/fixture/${space}/${id}`, request.url).href });
      }
      expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
      const path = url.searchParams.get("path") ?? "/";lists.push(`${space}:${path}`);
      const data = { path, files: ["alpha.png", "beta.png", ...(includeMissing ? ["missing.png"] : []), ...(includeLater ? ["later.png"] : [])].map(name => ({
        id: `${space}-${name}`, space_id: space, name, path: `${path}/${name}`, type: "file", size: 1, mime_type: "image/png",
        parent_id: null, sha256: null, uploaded_by: null, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z",
      })) };
      if (holdNextList) {
        holdNextList = false;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(" "));
          releaseLateList = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releaseLateList = undefined; };
        } }), { headers: { "Content-Type": "application/json" } });
      }
      if (lists.length === 1) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        releaseList = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releaseList = undefined; };
      } }), { headers: { "Content-Type": "application/json" } });
      return Response.json(data);
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/storage-direct-file/client.tsx"),
        formats: ["iife"], name: "StorageDirectFileTest", fileName: () => "client.js" } },
    });
    const { document, HTMLElement, Node } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const saved = new Map<string, string>();
    const location = { href: String(server.url), origin: server.url.origin, pathname: "/storage/space-a/a/alpha.png", search: "" };
    const scope: Record<string, unknown> = {
      document, HTMLElement, Node, console, URL, URLSearchParams, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, innerWidth: 1280, innerHeight: 800,
      navigator: { language: "en" }, location,
      localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);expect(url.origin).toBe(server!.url.origin);requests.push(url.pathname + url.search);
        const response = await fetch(url, init);
        if (url.pathname.endsWith("/storage")) {
          if (!listResponse) listResponse = response;
          if (releaseLateList) lateListResponse = response;
          const json = response.json.bind(response);
          response.json = async () => { const data = await json();decodedLists++;return data; };
        }
        if (url.pathname.endsWith("/download-url") && response.status === 401) {
          heldResponse = response;const json = response.json.bind(response);
          response.json = async () => { try { return await json(); } finally { decoded = true; } };
        }
        return response;
      },
    };
    scope.window = scope;scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.storageDirectFileFixture as NonNullable<typeof fixture>;
    const heading = () => document.querySelector("h2")?.textContent?.trim();
    const file = (name: string) => document.querySelector<HTMLButtonElement>(`button[title="${name}"]`);
    const back = () => document.querySelector<HTMLButtonElement>('button[title="Back"]')!.click();
    const loaded = () => document.querySelector<HTMLButtonElement>('button[title="Refresh"]')?.disabled === false;
    const refresh = async () => {
      const before = lists.length;document.querySelector<HTMLButtonElement>('button[title="Refresh"]')!.click();
      await until(() => lists.length > before && loaded());
    };

    await until(() => listResponse?.body?.locked === true);expect(urls).toEqual([]);releaseList!();
    await until(() => heading() === "alpha.png");expect(urls).toEqual([{ space: "space-a", id: "space-a-alpha.png" }]);
    back();await until(() => file("alpha.png") !== null);await Bun.sleep(0);
    expect(heading()).toBeUndefined();expect(urls).toHaveLength(1);expect(fixture.route().filePath).toBeUndefined();
    expect(fixture.navigations).toHaveLength(1);expect(fixture.navigations[0]).toMatchObject({ view: "storage", spaceId: "space-a", storagePath: "/a", filePath: undefined });
    await refresh();expect(urls).toHaveLength(1);expect(file("alpha.png")).not.toBeNull();

    fixture.setNotify(false);fixture.setRoute({ spaceId: "space-a", path: "/a", filePath: "/a/beta.png" });
    try { await until(() => heading() === "beta.png"); } catch (error) {
      console.info(JSON.stringify({ stage: "new-file", route: fixture.route(), urls, lists, requests, heading: heading(), text: document.body.textContent }));throw error;
    }
    expect(urls).toHaveLength(2);back();await until(() => loaded());await Bun.sleep(0);
    expect(heading()).toBeUndefined();expect(file("beta.png")).not.toBeNull();expect(fixture.route().filePath).toBe("/a/beta.png");expect(urls).toHaveLength(2);
    await refresh();expect(urls).toHaveLength(2);file("alpha.png")!.click();await until(() => heading() === "alpha.png");
    expect(urls).toHaveLength(3);back();await until(() => loaded());await Bun.sleep(0);expect(heading()).toBeUndefined();expect(urls).toHaveLength(3);
    fixture.setRoute({ spaceId: "space-a", path: "/a", filePath: "/a/beta.png" });await Bun.sleep(0);
    expect(heading()).toBeUndefined();expect(urls).toHaveLength(3);

    fixture.setRoute({ spaceId: "space-a", path: "/a", filePath: "/a/alpha.png" });await until(() => heldResponse?.body?.locked === true);
    fixture.setRoute({ spaceId: "space-b", path: "/a", filePath: "/a/beta.png" });await until(() => heading() === "beta.png");
    expect(urls).toHaveLength(5);expect(urls[4]).toEqual({ space: "space-b", id: "space-b-beta.png" });const before401 = location.href;
    releaseURL!();await until(() => decoded);await Bun.sleep(0);expect(location.href).toBe(before401);expect(heading()).toBe("beta.png");
    fixture.setRoute({ spaceId: "space-a", path: "/a", filePath: "/a/alpha.png" });await until(() => heading() === "alpha.png");
    expect(urls).toHaveLength(6);expect(urls[5]).toEqual({ space: "space-a", id: "space-a-alpha.png" });
    back();await until(() => loaded());await Bun.sleep(0);expect(heading()).toBeUndefined();expect(urls).toHaveLength(6);

    fixture.remount();await until(() => heading() === "alpha.png");expect(urls).toHaveLength(7);
    back();await until(() => loaded());await Bun.sleep(0);expect(heading()).toBeUndefined();expect(urls).toHaveLength(7);
    const beforeMissing = lists.length;fixture.setRoute({ spaceId: "space-a", path: "/a", filePath: "/a/missing.png" });
    await until(() => lists.length > beforeMissing && loaded());expect(urls).toHaveLength(7);
    includeMissing = true;document.querySelector<HTMLButtonElement>('button[title="Refresh"]')!.click();
    await until(() => heading() === "missing.png");expect(urls).toHaveLength(8);expect(urls[7]).toEqual({ space: "space-a", id: "space-a-missing.png" });
    fixture.setNotify(true);back();await until(() => loaded());await Bun.sleep(0);expect(heading()).toBeUndefined();
    expect(fixture.route().filePath).toBeUndefined();expect(urls).toHaveLength(8);expect(fixture.navigations).toHaveLength(2);

    fixture.setNotify(false);const beforeLater = lists.length;
    fixture.setRoute({ spaceId: "space-a", path: "/a", filePath: "/a/later.png" });
    await until(() => lists.length > beforeLater && loaded());expect(urls).toHaveLength(8);
    includeLater = true;holdNextList = true;document.querySelector<HTMLButtonElement>('button[title="Refresh"]')!.click();
    await until(() => lateListResponse?.body?.locked === true);file("alpha.png")!.click();await until(() => heading() === "alpha.png");
    expect(urls).toHaveLength(9);const beforeLateDecode = decodedLists;releaseLateList!();
    await until(() => decodedLists > beforeLateDecode);await Bun.sleep(0);
    expect(requests.filter(item => item.includes("/download-url?"))).toHaveLength(9);expect(heading()).toBe("alpha.png");
    back();await until(() => loaded());await Bun.sleep(0);expect(heading()).toBeUndefined();expect(urls).toHaveLength(9);
  } finally {
    releaseList?.();releaseLateList?.();releaseURL?.();fixture?.clearToasts();fixture?.dispose();server?.stop(true);await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check() && Date.now() < end) await Bun.sleep(1);
  expect(check()).toBe(true);
}
