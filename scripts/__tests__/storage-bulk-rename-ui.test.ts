import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual bulk rename UI preserves input, partial ACK and Workspace boundaries", async () => {
  if (process.env.TAKOS_BULK_RENAME_UI_PROCESS === "1") { await verifyBulkRenameUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_BULK_RENAME_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage bulk rename UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifyBulkRenameUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-bulk-rename-ui-"));
  const names = new Map([["file-a", "alpha"], ["file-b", "beta"], ["file-c", "gamma"]]);
  const posts: { space: string; renames: { file_id: string; name: string }[] }[] = [], reads: string[] = [];
  const responses = new Map<number, Response>(), releases = new Map<number, () => void>(), decoded = new Set<number>();
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fixture: { setSpace: (space: string) => void; dispose: () => void; toasts: () => { type: string; message: string }[]; clearToasts: () => void } | undefined;
  const file = (id: string, space: string) => ({ id, name: names.get(id)!, type: "file", path: `/a/${names.get(id)}`, space_id: space,
    parent_id: null, size: 1, mime_type: "text/plain", sha256: null, uploaded_by: null,
    created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);reads.push(space);
        return Response.json({ files: (space === "space-a" ? ["file-a", "file-b"] : ["file-c"]).map(id => file(id, space)), path: "/a" });
      }
      expect(request.method).toBe("POST");expect(url.pathname.endsWith("/storage/bulk-rename")).toBe(true);
      const body = await request.json() as { renames: { file_id: string; name: string }[] };posts.push({ space, renames: body.renames });
      const number = posts.length, status = number === 2 ? 503 : [4, 8].includes(number) ? 401 : 200;
      const renamed = status === 200 ? body.renames.filter((_, index) => number !== 1 || index === 0).map(item => {
        names.set(item.file_id, item.name);return file(item.file_id, space);
      }) : [];
      const errors = body.renames.filter(item => !renamed.some(file => file.id === item.file_id)).map(item => ({ file_id: item.file_id, error: "fixture_conflict" }));
      const data = status === 200 ? { renamed, errors, success_count: renamed.length, error_count: errors.length } : { error: "fixture_bulk_rename_unavailable" };
      // Actual production hooks decode streamed HTTP. Only identity and service DTOs are synthetic.
      if ([1, 4, 5, 6, 8].includes(number)) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        releases.set(number, () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releases.delete(number); });
      } }), { status, headers: { "Content-Type": "application/json" } });
      return Response.json(data, { status });
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false,
        lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"), formats: ["iife"], name: "StorageBulkRenameTest", fileName: () => "client.js" },
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
        const response = await fetch(url, init), number = posts.length;
        if (init?.method === "POST") {
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
    const inputs = () => Array.from(dialog()!.querySelectorAll<HTMLInputElement>("input"));
    const draft = (index: number, value: string) => { const input = inputs()[index];input.value = value;input.dispatchEvent(new Event("input", { bubbles: true }));return input; };
    const select = (name: string, selected = true) => { const checkbox = row(name)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      checkbox.checked = selected;checkbox.dispatchEvent(new Event("input", { bubbles: true })); };
    const open = () => { button(document, "Rename").click();expect(dialog()).not.toBeNull(); };
    const save = () => button(dialog()!, "Rename").click();
    const cancel = () => button(dialog()!, "Cancel").click();
    const held = (number: number) => until(() => responses.get(number)?.body?.locked === true);

    await until(() => row("alpha") != null);select("alpha");select("beta");open();
    const firstInput = draft(0, "  first  ");draft(1, "second");expect(inputs()[0]).toBe(firstInput);
    draft(0, "  first  ");expect(inputs()[0]).toBe(firstInput);save();await held(1);
    expect(button(dialog()!, "Rename").disabled).toBe(true);save();expect(posts).toHaveLength(1);draft(0, "third");
    releases.get(1)!();await until(() => !button(dialog()!, "Rename").disabled && row("first") != null);
    expect(inputs().map(item => item.value)).toEqual(["third", "second"]);expect(inputs()[0]).toBe(firstInput);
    expect(row("first")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(row("beta")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(fixture.toasts().map(item => item.type)).toEqual(["error"]);save();
    await until(() => fixture!.toasts().length === 2 && !button(dialog()!, "Rename").disabled);
    expect(inputs().map(item => item.value)).toEqual(["third", "second"]);save();
    await until(() => dialog() === null && row("third") != null && row("second") != null);
    expect(posts[2].renames).toEqual([{ file_id: "file-a", name: "third" }, { file_id: "file-b", name: "second" }]);
    expect(fixture.toasts().map(item => item.type)).toEqual(["error", "error", "success"]);fixture.clearToasts();

    select("third");open();draft(0, "from-a");fixture.setSpace("space-b");await until(() => row("gamma") != null);
    expect(dialog()).toBeNull();expect(posts).toHaveLength(3);select("gamma");open();draft(0, "from-b");save();await held(4);
    fixture.setSpace("space-a");await until(() => row("third") != null);expect(dialog()).toBeNull();select("third");open();draft(0, "a-fifth");save();await held(5);
    const before = { href: location.href, reads: reads.length };releases.get(4)!();await until(() => decoded.has(4));
    expect(location.href).toBe(before.href);expect(reads).toHaveLength(before.reads);expect(fixture.toasts()).toEqual([]);
    expect(inputs()[0].value).toBe("a-fifth");expect(button(dialog()!, "Rename").disabled).toBe(true);
    releases.get(5)!();await until(() => dialog() === null && row("a-fifth") != null);fixture.clearToasts();

    select("a-fifth");open();draft(0, "canceled-success");save();await held(6);cancel();open();draft(0, "a-fifth");
    expect(button(dialog()!, "Rename").disabled).toBe(true);save();expect(posts).toHaveLength(6);
    releases.get(6)!();await until(() => row("canceled-success") != null && !button(dialog()!, "Rename").disabled);
    expect(inputs()[0].value).toBe("a-fifth");expect(fixture.toasts()).toEqual([]);save();
    await until(() => dialog() === null && row("a-fifth") != null);expect(posts[6].renames).toEqual([{ file_id: "file-a", name: "a-fifth" }]);
    fixture.clearToasts();select("a-fifth");open();draft(0, "disposed");save();await held(8);
    const last = { href: location.href, reads: reads.length };fixture.dispose();releases.get(8)!();await until(() => decoded.has(8));
    expect(location.href).toBe(last.href);expect(reads).toHaveLength(last.reads);expect(fixture.toasts()).toEqual([]);
    expect(posts.map(item => item.space)).toEqual(["space-a", "space-a", "space-a", "space-b", "space-a", "space-a", "space-a", "space-a"]);
  } finally {
    for (const release of releases.values()) release();fixture?.clearToasts();fixture?.dispose();server?.stop(true);await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;while (!check() && Date.now() < end) await Bun.sleep(1);expect(check()).toBe(true);
}
