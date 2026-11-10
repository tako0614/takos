import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual rename dialog retains newer input and retires obsolete saves", async () => {
  if (process.env.TAKOS_STORAGE_RENAME_UI_PROCESS === "1") { await verifyRenameUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_STORAGE_RENAME_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage rename UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyRenameUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-rename-ui-"));
  const names = new Map([["file-a", "alpha"], ["file-b", "beta"], ["file-c", "gamma"]]);
  const patches: { space: string; id: string; name: string }[] = [], attempts: string[] = [];
  const responses = new Map<number, Response>(), releases = new Map<number, () => void>(), decoded = new Set<number>();
  let server: ReturnType<typeof Bun.serve> | undefined, folderEntered = false, releaseFolder: (() => void) | undefined;
  let fixture: { setSpace: (space: string) => void; setPath: (path: string) => void; dispose: () => void;
    toasts: () => { type: string; message: string }[]; clearToasts: () => void } | undefined;
  const file = (id: string, space: string) => ({ id, name: names.get(id)!, type: "file", path: `/a/${names.get(id)}`,
    space_id: space, parent_id: null, size: 1, mime_type: "text/plain", sha256: null, uploaded_by: null,
    created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
        const path = url.searchParams.get("path") ?? "/";
        if (path === "/waiting") { folderEntered = true;await new Promise<void>(resolve => { releaseFolder = resolve; }); }
        return Response.json({ files: path === "/a" ? (space === "space-a" ? ["file-a", "file-b"] : ["file-c"]).map(id => file(id, space)) : [], path });
      }
      expect(request.method).toBe("PATCH");const id = url.pathname.split("/").at(-1)!;
      const body = await request.json() as { name: string };patches.push({ space, id, name: body.name });
      const number = patches.length, status = number === 2 ? 503 : number === 4 ? 401 : 200;
      if (status === 200) names.set(id, body.name);
      const data = status === 200 ? { file: file(id, space) } : { error: "fixture_rename_unavailable" };
      // Actual production page/hooks/RPC read these real response streams;
      // only service DTOs and authenticated fixture identity are synthetic.
      if ([1, 4, 5, 6].includes(number)) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        releases.set(number, () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releases.delete(number); });
      } }), { status, headers: { "Content-Type": "application/json" } });
      return Response.json(data, { status });
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false,
        // Reuse the existing real StoragePage/ConfirmDialog fixture.
        lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"), formats: ["iife"], name: "StorageRenameTest", fileName: () => "client.js" },
      },
    });
    const { document, Event, HTMLElement, Node } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const persisted = new Map<string, string>();
    const location = { href: String(server.url), origin: server.url.origin, pathname: "/storage/space-a/a", search: "" };
    const scope: Record<string, unknown> = {
      document, HTMLElement, Node, console, URL, URLSearchParams, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, innerWidth: 1280, innerHeight: 800,
      navigator: { language: "en" }, location,
      localStorage: { getItem: (key: string) => persisted.get(key) ?? null, setItem: (key: string, value: string) => persisted.set(key, value), removeItem: (key: string) => persisted.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);expect(url.origin).toBe(server!.url.origin);
        attempts.push(`${init?.method ?? "GET"} ${url.pathname}`);
        const number = init?.method === "PATCH" ? attempts.filter(value => value.startsWith("PATCH ")).length : undefined;
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
    const row = (name: string) => document.querySelector(`button[title="${name}"]`)?.closest("tr");
    const dialog = () => document.querySelector('[role="dialog"]');
    const button = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === label)!;
    const input = () => dialog()!.querySelector<HTMLInputElement>("input")!;
    const draft = (value: string) => { input().value = value;input().dispatchEvent(new Event("input", { bubbles: true })); };
    const enter = (composing = false) => { const event = new Event("keydown", { bubbles: true, cancelable: true });Object.assign(event, { key: "Enter", keyCode: 13, isComposing: composing });input().dispatchEvent(event); };
    const save = () => button(dialog()!, "Rename").click();
    const cancel = () => button(dialog()!, "Cancel").click();
    const open = async (name: string) => {
      const target = row(name);expect(target).not.toBeNull();const event = new Event("contextmenu", { bubbles: true, cancelable: true });
      Object.assign(event, { clientX: 100, clientY: 100 });target!.dispatchEvent(event);
      button(document.querySelector('[role="menu"]')!, "Rename").click();await until(() => dialog() !== null);
    };
    const held = (number: number) => until(() => responses.get(number)?.body?.locked === true);

    await until(() => row("alpha") != null);await open("alpha");draft("kept");
    fixture.setPath("/waiting");await until(() => folderEntered);
    expect(dialog()).toBeNull();releaseFolder!();releaseFolder = undefined;
    fixture.setPath("/a");await until(() => row("alpha") != null);await open("alpha");expect(input().value).toBe("kept");cancel();
    await open("alpha");expect(input().value).toBe("alpha");draft("  first  ");enter(true);await Bun.sleep(0);expect(patches).toEqual([]);
    enter();await held(1);expect(button(dialog()!, "Rename").disabled).toBe(true);expect(input().disabled).toBe(false);
    enter();save();expect(patches).toHaveLength(1);draft("  second  ");releases.get(1)!();
    await until(() => !button(dialog()!, "Rename").disabled && row("first") != null);
    expect(input().value).toBe("  second  ");expect(fixture.toasts()[0].message).toContain("first");
    save();await until(() => fixture!.toasts().length === 2 && !button(dialog()!, "Rename").disabled);
    expect(input().value).toBe("  second  ");expect(patches).toHaveLength(2);save();
    await until(() => dialog() === null && row("second") != null);
    expect(patches.map(item => item.name)).toEqual(["first", "second", "second"]);
    expect(fixture.toasts().map(item => item.type)).toEqual(["success", "error", "success"]);fixture.clearToasts();

    await open("second");draft("old-a");save();await held(4);cancel();await open("beta");draft("new-b");save();await held(5);
    const before = { href: location.href, attempts: attempts.length, toasts: fixture.toasts().length };
    releases.get(4)!();await until(() => decoded.has(4));
    expect(location.href).toBe(before.href);expect(attempts).toHaveLength(before.attempts);expect(fixture.toasts()).toHaveLength(before.toasts);
    expect(input().value).toBe("new-b");expect(button(dialog()!, "Rename").disabled).toBe(true);
    releases.get(5)!();await until(() => dialog() === null && row("new-b") != null);

    await open("second");draft("fourth");save();await held(6);cancel();await open("second");draft("fifth");
    expect(button(dialog()!, "Rename").disabled).toBe(true);enter();save();expect(patches).toHaveLength(6);
    releases.get(6)!();await until(() => !button(dialog()!, "Rename").disabled);
    expect(input().value).toBe("fifth");save();await until(() => dialog() === null && row("fifth") != null);
    expect(patches).toHaveLength(7);expect(fixture.toasts().map(item => item.type)).toEqual(["success", "success"]);
  } finally {
    releaseFolder?.();for (const release of releases.values()) release();
    fixture?.clearToasts();fixture?.dispose();server?.stop(true);await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check() && Date.now() < end) await Bun.sleep(1);
  expect(check()).toBe(true);
}
