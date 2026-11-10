import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual bulk Move UI owns its count, destination and delayed ACK", async () => {
  if (process.env.TAKOS_BULK_MOVE_UI_PROCESS === "1") { await verifyBulkMoveUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_BULK_MOVE_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage bulk Move UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifyBulkMoveUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-bulk-move-ui-"));
  const names = new Map([["file-a", "alpha"], ["file-b", "beta"], ["file-c", "gamma"], ["file-d", "delta"], ["file-e", "epsilon"]]);
  const parents = new Map([...names.keys()].map(id => [id, "/a"]));
  const posts: { space: string; ids: string[]; dest: string }[] = [], reads: string[] = [];
  const responses = new Map<number, Response>(), releases = new Map<number, () => void>(), decoded = new Set<number>();
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fixture: { setSpace: (space: string) => void; dispose: () => void; toasts: () => { type: string; message: string }[]; clearToasts: () => void } | undefined;
  const file = (id: string, space: string) => ({ id, name: names.get(id)!, type: "file", path: `${parents.get(id)}/${names.get(id)}`, space_id: space,
    parent_id: null, size: 1, mime_type: "text/plain", sha256: null, uploaded_by: null,
    created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);reads.push(space);
        const path = url.searchParams.get("path") ?? "/";
        return Response.json({ files: (space === "space-a" ? ["file-a", "file-b", "file-d", "file-e"] : ["file-c"]).filter(id => parents.get(id) === path).map(id => file(id, space)), path });
      }
      expect(request.method).toBe("POST");expect(url.pathname.endsWith("/storage/bulk-move")).toBe(true);
      const body = await request.json() as { file_ids: string[]; parent_path: string };posts.push({ space, ids: body.file_ids, dest: body.parent_path });
      const n = posts.length, status = n === 2 ? 503 : [4, 9].includes(n) ? 401 : 200;
      const moved = status === 200 ? body.file_ids.filter((_, index) => n !== 1 || index === 0).map(id => {
        parents.set(id, body.parent_path);return file(id, space);
      }) : [];
      const errors = body.file_ids.filter(id => !moved.some(file => file.id === id)).map(file_id => ({ file_id, error: "fixture_conflict" }));
      const data = status === 200 ? { moved, errors, success_count: moved.length, error_count: errors.length } : { error: "fixture_bulk_move_unavailable" };
      // Production hooks consume real HTTP streams; identity and service DTOs are synthetic.
      if ([1, 4, 5, 7, 9].includes(n)) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        releases.set(n, () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releases.delete(n); });
      } }), { status, headers: { "Content-Type": "application/json" } });
      return Response.json(data, { status });
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false,
        lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"), formats: ["iife"], name: "StorageBulkMoveTest", fileName: () => "client.js" },
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
        const response = await fetch(url, init), n = posts.length;
        if (init?.method === "POST") {
          responses.set(n, response);const readJson = response.json.bind(response);
          response.json = async () => { try { return await readJson(); } finally { decoded.add(n); } };
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
    const select = (name: string) => { const checkbox = row(name)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      checkbox.checked = true;checkbox.dispatchEvent(new Event("input", { bubbles: true })); };
    const open = () => { button(document, "Move").click();expect(dialog()).not.toBeNull(); };
    const save = () => button(dialog()!, "Move").click();
    const cancel = () => button(dialog()!, "Cancel").click();
    const enter = (composing = false) => { const event = new Event("keydown", { bubbles: true, cancelable: true });
      Object.assign(event, { key: "Enter", keyCode: composing ? 229 : 13, isComposing: composing });input().dispatchEvent(event);return event; };
    const held = (n: number) => until(() => responses.get(n)?.body?.locked === true);
    const count = (n: number) => expect(dialog()!.textContent).toContain(`Move ${n} items to`);

    await until(() => row("alpha") != null);select("alpha");select("beta");open();count(2);draft(" dest/ ");
    enter(true);await Bun.sleep(0);expect(posts).toEqual([]);expect(enter().defaultPrevented).toBe(true);await held(1);
    enter();save();expect(posts).toHaveLength(1);expect(button(dialog()!, "Move").disabled).toBe(true);draft("/retry");
    document.querySelector<HTMLButtonElement>('button[title="Refresh"]')!.click();await until(() => row("alpha") == null);count(2);
    releases.get(1)!();await until(() => fixture!.toasts().length === 1);count(1);expect(input().value).toBe("/retry");
    expect(row("beta")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);expect(fixture.toasts()[0].type).toBe("error");
    save();await until(() => fixture!.toasts().length === 2);count(1);expect(input().value).toBe("/retry");save();
    await until(() => dialog() === null && row("beta") == null);
    expect(posts.slice(0, 3)).toEqual([
      { space: "space-a", ids: ["file-a", "file-b"], dest: "/dest" },
      { space: "space-a", ids: ["file-b"], dest: "/retry" }, { space: "space-a", ids: ["file-b"], dest: "/retry" },
    ]);expect(fixture.toasts().map(item => item.type)).toEqual(["error", "error", "success"]);fixture.clearToasts();

    fixture.setSpace("space-b");await until(() => row("gamma") != null);select("gamma");open();draft("/old-b");save();await held(4);
    fixture.setSpace("space-a");await until(() => row("delta") != null);expect(dialog()).toBeNull();select("delta");open();draft("/new-a");
    expect(button(dialog()!, "Move").disabled).toBe(false);save();await held(5);const before = { href: location.href, reads: reads.length };
    releases.get(4)!();await until(() => decoded.has(4));expect(location.href).toBe(before.href);expect(reads).toHaveLength(before.reads);
    expect(fixture.toasts()).toEqual([]);count(1);expect(input().value).toBe("/new-a");expect(button(dialog()!, "Move").disabled).toBe(true);
    draft("");releases.get(5)!();await until(() => row("delta") == null && fixture!.toasts().length === 1);
    count(1);expect(input().value).toBe("");save();expect(posts).toHaveLength(5);draft("/follow-up");enter();
    await until(() => dialog() === null);expect(posts[5]).toEqual({ space: "space-a", ids: ["file-d"], dest: "/follow-up" });fixture.clearToasts();

    select("epsilon");open();draft("/canceled");save();await held(7);cancel();open();draft("/a");
    expect(button(dialog()!, "Move").disabled).toBe(true);enter();save();expect(posts).toHaveLength(7);releases.get(7)!();
    await until(() => row("epsilon") == null && !button(dialog()!, "Move").disabled);count(1);expect(input().value).toBe("/a");expect(fixture.toasts()).toEqual([]);
    save();await until(() => dialog() === null && row("epsilon") != null);expect(posts[7].ids).toEqual(["file-e"]);fixture.clearToasts();
    select("epsilon");open();draft("/disposed");save();await held(9);const last = { href: location.href, reads: reads.length };
    fixture.dispose();releases.get(9)!();await until(() => decoded.has(9));expect(location.href).toBe(last.href);expect(reads).toHaveLength(last.reads);expect(fixture.toasts()).toEqual([]);
  } finally {
    for (const release of releases.values()) release();fixture?.clearToasts();fixture?.dispose();server?.stop(true);await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;while (!check() && Date.now() < end) await Bun.sleep(1);expect(check()).toBe(true);
}
