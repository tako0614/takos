import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual folder form keeps its destination, draft and pending request", async () => {
  if (process.env.TAKOS_STORAGE_CREATE_UI_PROCESS === "1") { await verifyCreateUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_STORAGE_CREATE_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage create UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifyCreateUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-create-ui-"));
  const creates: { space: string; name: string; parent_path: string }[] = [], attempts: string[] = [];
  const folders: { id: string; space_id: string; name: string; path: string; parent: string }[] = [];
  const responses = new Map<number, Response>(), releases = new Map<number, () => void>(), decoded = new Set<number>();
  let fixture: { setSpace: (space: string) => void; setPath: (path: string) => void; dispose: () => void;
    toasts: () => { type: string; message: string }[]; clearToasts: () => void } | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
        const path = url.searchParams.get("path") ?? "/";
        return Response.json({ files: folders.filter(folder => folder.space_id === space && folder.parent === path)
          .map(folder => ({ ...folder, type: "folder" })), path });
      }
      expect(request.method).toBe("POST");expect(url.pathname.endsWith("/storage/folders")).toBe(true);
      const body = await request.json() as { name: string; parent_path: string };creates.push({ space, ...body });
      const number = creates.length, status = number === 2 ? 503 : number === 4 ? 401 : 200;
      const folder = { id: `folder-${number}`, space_id: space, name: body.name, parent: body.parent_path,
        path: `${body.parent_path}/${body.name}`, type: "folder", parent_id: null, size: 0, mime_type: null,
        sha256: null, uploaded_by: null, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" };
      if (status === 200) folders.push(folder);
      const data = status === 200 ? { folder } : { error: "fixture_create_unavailable" };
      // Actual production page/hooks/RPC consume real response streams.
      // Only service DTOs and the fixture identity are synthetic.
      if ([1, 4, 5, 6].includes(number)) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        releases.set(number, () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releases.delete(number); });
      } }), { status, headers: { "Content-Type": "application/json" } });
      return Response.json(data, { status });
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"),
        formats: ["iife"], name: "StorageCreateTest", fileName: () => "client.js" } },
    });
    const { document, Event, HTMLElement, Node } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const saved = new Map<string, string>();
    const location = { href: String(server.url), origin: server.url.origin, pathname: "/storage/space-a/a", search: "" };
    const scope: Record<string, unknown> = {
      document, HTMLElement, Node, console, URL, URLSearchParams, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, innerWidth: 1280, innerHeight: 800,
      navigator: { language: "en" }, location,
      localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);expect(url.origin).toBe(server!.url.origin);
        attempts.push(`${init?.method ?? "GET"} ${url.pathname}`);
        const number = init?.method === "POST" ? attempts.filter(item => item.startsWith("POST ")).length : undefined;
        const response = await fetch(url, init);
        if (number) {
          responses.set(number, response);const readJson = response.json.bind(response);
          response.json = async () => { try { return await readJson(); } finally { decoded.add(number); } };
        }
        return response;
      },
    };
    scope.window = scope;scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.storageDeleteFixture as NonNullable<typeof fixture>;
    const dialog = () => document.querySelector('[role="dialog"]');
    const row = (name: string) => document.querySelector(`button[title="${name}"]`)?.closest("tr");
    const button = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === label)!;
    const loaded = () => document.querySelector<HTMLButtonElement>('button[title="Refresh"]')?.disabled === false;
    const open = async () => { await until(loaded);button(document, "New").click();button(document, "New Folder").click();await until(() => dialog() !== null); };
    const input = () => dialog()!.querySelector<HTMLInputElement>("input")!;
    const draft = (value: string) => { input().value = value;input().dispatchEvent(new Event("input", { bubbles: true })); };
    const save = () => button(dialog()!, "Create").click();
    const cancel = () => button(dialog()!, "Cancel").click();
    const enter = (composing = false) => { const event = new Event("keydown", { bubbles: true, cancelable: true });
      Object.assign(event, { key: "Enter", keyCode: 13, isComposing: composing });input().dispatchEvent(event); };
    const held = (number: number) => until(() => responses.get(number)?.body?.locked === true);

    await until(() => attempts.includes("GET /api/spaces/space-a/storage"));await Bun.sleep(0);
    await open();draft("origin-a");fixture.setSpace("space-b");
    await until(() => attempts.includes("GET /api/spaces/space-b/storage"));await Bun.sleep(0);
    expect(dialog()).toBeNull();expect(creates).toEqual([]);
    await open();expect(input().value).toBe("");draft("  first  ");enter(true);await Bun.sleep(0);expect(creates).toEqual([]);
    enter();await held(1);enter();save();expect(creates).toEqual([{ space: "space-b", name: "first", parent_path: "/a" }]);
    expect(button(dialog()!, "Create").disabled).toBe(true);expect(input().disabled).toBe(false);
    draft("  second  ");releases.get(1)!();await until(() => !button(dialog()!, "Create").disabled && row("first") != null);
    expect(input().value).toBe("  second  ");expect(fixture.toasts()[0].message).toBe("Folder created");
    save();await until(() => fixture!.toasts().length === 2 && !button(dialog()!, "Create").disabled);
    expect(input().value).toBe("  second  ");expect(creates).toHaveLength(2);save();
    await until(() => dialog() === null && row("second") != null);
    expect(creates.map(item => item.name)).toEqual(["first", "second", "second"]);
    expect(fixture.toasts().map(item => item.type)).toEqual(["success", "error", "success"]);fixture.clearToasts();

    await open();draft("old-b");save();await held(4);cancel();fixture.setSpace("space-a");
    await until(() => attempts.filter(item => item === "GET /api/spaces/space-a/storage").length === 2);await Bun.sleep(0);
    await open();draft("new-a");save();await held(5);
    const before = { href: location.href, requests: attempts.length, toasts: fixture.toasts().length };
    releases.get(4)!();await until(() => decoded.has(4));
    expect(location.href).toBe(before.href);expect(attempts).toHaveLength(before.requests);expect(fixture.toasts()).toHaveLength(before.toasts);
    expect(input().value).toBe("new-a");expect(button(dialog()!, "Create").disabled).toBe(true);
    releases.get(5)!();await until(() => dialog() === null && row("new-a") != null);fixture.clearToasts();

    await open();draft("canceled-success");save();await held(6);cancel();await open();draft("after-cancel");
    expect(button(dialog()!, "Create").disabled).toBe(true);enter();save();expect(creates).toHaveLength(6);
    releases.get(6)!();await until(() => !button(dialog()!, "Create").disabled && row("canceled-success") != null);
    expect(input().value).toBe("after-cancel");expect(fixture.toasts()).toEqual([]);save();
    await until(() => dialog() === null && row("after-cancel") != null);expect(creates).toHaveLength(7);
    expect(fixture.toasts().map(item => item.type)).toEqual(["success"]);

    await open();draft("old-folder");const beforePath = attempts.length;fixture.setPath("/other");await Bun.sleep(0);expect(dialog()).toBeNull();
    await until(() => attempts.length > beforePath && loaded());fixture.setPath("/a");await Bun.sleep(0);expect(dialog()).toBeNull();
    expect(creates).toHaveLength(7);
  } finally {
    for (const release of releases.values()) release();
    fixture?.clearToasts();fixture?.dispose();server?.stop(true);await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check() && Date.now() < end) await Bun.sleep(1);
  expect(check()).toBe(true);
}
