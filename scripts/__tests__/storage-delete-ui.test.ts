import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual Storage menu, confirmation and partial delete keep their original target", async () => {
  if (process.env.TAKOS_STORAGE_DELETE_UI_PROCESS === "1") { await verifyDeleteUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_STORAGE_DELETE_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage delete UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyDeleteUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-delete-ui-"));
  const mutations: { space: string; ids: string[]; method: string }[] = [];
  const reads: string[] = [], clientAttempts: string[] = [], deleted = new Set<string>();
  let server: ReturnType<typeof Bun.serve> | undefined;
  let fixture: { setSpace: (id: string) => void; dispose: () => void; toasts: () => { type: string }[]; clearToasts: () => void } | undefined;
  let releaseResponse: (() => void) | undefined, heldSingle: Response | undefined, heldBulk: Response | undefined;
  let firstSingle = true, firstBulk = true, decodedSingles = 0;
  const file = (id: string, space: string) => ({ id, name: id, type: "file", path: `/a/${id}`, parent_id: null,
    space_id: space, size: 1, mime_type: "text/plain", sha256: null, uploaded_by: null,
    created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];
      if (request.method === "GET") {
        expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);reads.push(space);
        const ids = space === "space-a" ? ["file-a", "file-a2", "file-later"] : ["file-b"];
        return Response.json({ files: ids.filter(id => !deleted.has(`${space}:${id}`)).map(id => file(id, space)), path: "/a" });
      }
      let ids: string[], failed: string[] = [], hold: boolean;
      if (request.method === "DELETE") {
        ids = [url.pathname.split("/").at(-1)!];hold = firstSingle;firstSingle = false;
      } else {
        expect(request.method).toBe("POST");expect(url.pathname).toMatch(/\/storage\/bulk-delete$/);
        ids = (await request.json() as { file_ids: string[] }).file_ids;
        failed = ids.filter(id => id === "file-a2");hold = firstBulk;firstBulk = false;
      }
      mutations.push({ space, ids, method: request.method });
      for (const id of ids) if (!failed.includes(id)) deleted.add(`${space}:${id}`);
      const body = { success: true, deleted_count: ids.length - failed.length, error_count: failed.length, failed_ids: failed };
      // Only storage/auth DTOs are synthetic. The production page, menu,
      // confirmation, both callers and Hono/RPC decoder run unchanged.
      if (hold) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        releaseResponse = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();releaseResponse = undefined; };
      } }), { headers: { "Content-Type": "application/json" } });
      return Response.json(body);
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false,
        lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"), formats: ["iife"], name: "StorageDeleteTest", fileName: () => "client.js" },
      },
    });
    const { document, Event, HTMLElement, Node } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const persisted = new Map<string, string>();
    const scope: Record<string, unknown> = {
      document, HTMLElement, Node, console, URL, URLSearchParams, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, innerWidth: 1280, innerHeight: 800,
      navigator: { language: "en" },
      location: { href: String(server.url), origin: server.url.origin, pathname: "/storage/space-a/a", search: "" },
      localStorage: { getItem: (key: string) => persisted.get(key) ?? null, setItem: (key: string, value: string) => persisted.set(key, value), removeItem: (key: string) => persisted.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);expect(url.origin).toBe(server!.url.origin);
        clientAttempts.push(`${init?.method ?? "GET"} ${url.pathname}`);
        const response = await fetch(url, init);
        if (init?.method === "DELETE") {
          if (!heldSingle) heldSingle = response;
          const readJson = response.json.bind(response);
          response.json = async () => { try { return await readJson(); } finally { decodedSingles++; } };
        } else if (init?.method === "POST" && !heldBulk) heldBulk = response;
        return response;
      },
    };
    scope.window = scope;scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.storageDeleteFixture as NonNullable<typeof fixture>;
    const row = (id: string) => document.querySelector<HTMLButtonElement>(`button[title="${id}"]`)?.closest("tr");
    const button = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === label)!;
    const openMenu = async (id: string) => {
      const target = row(id);expect(target).not.toBeNull();
      const event = new Event("contextmenu", { bubbles: true, cancelable: true });
      Object.assign(event, { clientX: 100, clientY: 100 });target!.dispatchEvent(event);
      await until(() => document.querySelector('[role="menu"]') !== null);
    };
    const openDelete = async (id: string) => {
      await openMenu(id);button(document.querySelector('[role="menu"]')!, "Delete").click();
      await until(() => document.querySelector('[role="dialog"]') !== null);
    };
    const confirm = () => button(document.querySelector('[role="dialog"]')!, "Delete").click();
    const select = (id: string) => {
      const input = row(id)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      input.checked = true;input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await until(() => row("file-a") != null);

    // A truthy menu replacement must use its new file; closing the Show must
    // not make its action callback read a disposed Show accessor.
    await openMenu("file-a");await openMenu("file-a2");
    button(document.querySelector('[role="menu"]')!, "Rename").click();
    await until(() => document.querySelector('[role="dialog"] input') !== null);
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("file-a2");
    button(document.querySelector('[role="dialog"]')!, "Cancel").click();
    expect(mutations).toEqual([]);

    await openDelete("file-a");fixture.setSpace("space-b");await until(() => row("file-b") != null);
    confirm();await Bun.sleep(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();expect(mutations).toEqual([]);expect(fixture.toasts()).toEqual([]);

    await openDelete("file-b");confirm();await until(() => heldSingle?.body?.locked === true);
    fixture.setSpace("space-a");await until(() => row("file-a") != null);
    await openDelete("file-a");
    const currentDialogText = document.querySelector('[role="dialog"]')!.textContent;
    const attemptsBefore = clientAttempts.length, readsBefore = reads.length;
    releaseResponse!();await until(() => decodedSingles === 1);
    expect(clientAttempts).toHaveLength(attemptsBefore);expect(reads).toHaveLength(readsBefore);expect(fixture.toasts()).toEqual([]);
    expect(mutations).toEqual([{ space: "space-b", ids: ["file-b"], method: "DELETE" }]);
    await openMenu("file-a2");button(document.querySelector('[role="menu"]')!, "Delete").click();
    expect(document.querySelector('[role="dialog"]')!.textContent).toBe(currentDialogText);
    button(document.querySelector('[role="dialog"]')!, "Cancel").click();

    select("file-a");select("file-a2");button(document, "Delete").click();
    await until(() => document.querySelector('[role="dialog"]') !== null);confirm();
    await until(() => heldBulk?.body?.locked === true);select("file-later");releaseResponse!();
    await until(() => row("file-a") == null && row("file-a2") != null && fixture!.toasts().length > 0);
    expect(row("file-a2")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(row("file-later")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(fixture.toasts().map(item => item.type)).toEqual(["error"]);
    expect(mutations[1]).toEqual({ space: "space-a", ids: ["file-a", "file-a2"], method: "POST" });
  } finally {
    releaseResponse?.();fixture?.clearToasts();fixture?.dispose();server?.stop(true);
    await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check() && Date.now() < end) await Bun.sleep(1);
  expect(check()).toBe(true);
}
