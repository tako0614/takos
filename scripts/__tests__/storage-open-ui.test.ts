import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the actual Storage page keeps late Open and Download in their original view", async () => {
  if (process.env.TAKOS_STORAGE_OPEN_UI_PROCESS === "1") { await verifyOpenUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_STORAGE_OPEN_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage Open UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifyOpenUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-open-ui-"));
  const plan = [
    { status: 200, hold: true }, { status: 401, hold: true }, { status: 200 },
    { status: 200, hold: true }, { status: 503, hold: true }, { status: 200 },
    { status: 200, hold: true }, { status: 200 }, { status: 401, hold: true },
    { status: 503 }, { status: 200 },
  ];
  const requests: string[] = [], urls: { space: string; id: string }[] = [], windows: unknown[][] = [];
  const responses = new Map<number, Response>(), releases = new Map<number, () => void>(), decoded = new Set<number>();
  let fixture: { setSpace: (space: string) => void; setPath: (path: string) => void; dispose: () => void;
    toasts: () => { type: string; message: string }[]; clearToasts: () => void } | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  const file = (id: string, space: string, path: string) => ({ id, space_id: space, name: `${id}.png`, path: `${path}/${id}.png`,
    type: "file", size: 1, parent_id: null, mime_type: "image/png", sha256: null, uploaded_by: null,
    created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" });
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3];expect(request.method).toBe("GET");
      if (url.pathname.endsWith("/download-url")) {
        const id = url.searchParams.get("file_id")!;urls.push({ space, id });const number = urls.length;
        const responsePlan = plan[number - 1];expect(responsePlan).toBeDefined();
        const data = responsePlan.status === 200 ? { download_url: new URL(`/fixture/${space}/${id}.png`, request.url).href }
          : { error: "fixture_download_unavailable" };
        // Actual compiled page/hooks/RPC consume the real HTTP response streams.
        // Service DTOs and the fixture identity are synthetic.
        if (responsePlan.hold) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(" "));
          releases.set(number, () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();releases.delete(number); });
        } }), { status: responsePlan.status, headers: { "Content-Type": "application/json" } });
        return Response.json(data, { status: responsePlan.status });
      }
      if (url.pathname.endsWith("/file-handlers")) return Response.json({ handlers: [] });
      expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);
      const path = url.searchParams.get("path") ?? "/", prefix = space === "space-a" ? "alpha" : "beta";
      return Response.json({ path, files: [file(prefix, space, path), file(`${prefix}-2`, space, path)] });
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"),
        formats: ["iife"], name: "StorageOpenTest", fileName: () => "client.js" } },
    });
    const { document, Event, HTMLElement, Node } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const saved = new Map<string, string>();
    const location = { href: String(server.url), origin: server.url.origin, pathname: "/storage/space-a/a", search: "" };
    const scope: Record<string, unknown> = {
      document, HTMLElement, Node, console, URL, URLSearchParams, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, innerWidth: 1280, innerHeight: 800,
      navigator: { language: "en" }, location, open: (...args: unknown[]) => { windows.push(args); },
      localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);expect(url.origin).toBe(server!.url.origin);
        requests.push(url.pathname + url.search);
        const number = url.pathname.endsWith("/download-url") ? requests.filter(item => item.includes("/download-url?")).length : undefined;
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
    const fileButton = (name: string) => document.querySelector<HTMLButtonElement>(`button[title="${name}.png"]`);
    const heading = () => document.querySelector("h2")?.textContent?.trim();
    const button = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === label)!;
    const open = async (name: string) => { await until(() => fileButton(name) !== null);fileButton(name)!.click(); };
    const back = () => document.querySelector<HTMLButtonElement>('button[title="Back"]')!.click();
    const download = async (name: string) => {
      await until(() => fileButton(name) !== null);const event = new Event("contextmenu", { bubbles: true, cancelable: true });
      Object.assign(event, { clientX: 100, clientY: 100 });fileButton(name)!.closest("tr")!.dispatchEvent(event);
      button(document.querySelector('[role="menu"]')!, "Download").click();
    };
    const held = (number: number) => until(() => responses.get(number)?.body?.locked === true);
    const finish = async (number: number) => { releases.get(number)!();await until(() => decoded.has(number));await Bun.sleep(0); };

    await open("alpha");await held(1);fixture.setSpace("space-b");await until(() => fileButton("beta") !== null);
    await finish(1);expect(fileButton("beta")).not.toBeNull();expect(heading()).toBeUndefined();expect(windows).toEqual([]);

    await open("beta");await held(2);await open("beta-2");await until(() => heading() === "beta-2.png");
    button(document, "Download").click();expect(windows).toHaveLength(1);
    expect(windows[0][0]).toBe(new URL("/fixture/space-b/beta-2.png", server.url).href);
    expect(windows[0].slice(1)).toEqual(["_blank", "noopener,noreferrer"]);
    back();await until(() => fileButton("beta-2") !== null);const before401 = location.href;
    await finish(2);expect(location.href).toBe(before401);expect(fileButton("beta-2")).not.toBeNull();expect(heading()).toBeUndefined();

    await download("beta");await held(4);fixture.setSpace("space-a");await until(() => fileButton("alpha") !== null);
    await finish(4);expect(windows).toHaveLength(1);expect(fileButton("alpha")).not.toBeNull();expect(fixture.toasts()).toEqual([]);
    await download("alpha");await held(5);const beforeFolder = requests.length;fixture.setPath("/other");
    await until(() => requests.length > beforeFolder && requests.some(item => item.includes("path=%2Fother")));
    await finish(5);expect(windows).toHaveLength(1);expect(fixture.toasts()).toEqual([]);expect(document.body.textContent).not.toContain("fixture_download_unavailable");

    await open("alpha");await until(() => heading() === "alpha.png");
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === "Image ViewerIncluded")!.click();
    await until(() => document.querySelector('img[alt="alpha.png"]') !== null);
    expect(document.querySelector("img")!.getAttribute("src")).toBe(new URL("/fixture/space-a/alpha.png", server.url).href);
    back();await until(() => fileButton("alpha") !== null);

    await open("alpha");await held(7);await open("alpha-2");await until(() => heading() === "alpha-2.png");
    back();await until(() => fileButton("alpha-2") !== null);await finish(7);
    expect(fileButton("alpha-2")).not.toBeNull();expect(heading()).toBeUndefined();

    await open("alpha");await held(9);fixture.setSpace("space-b");await until(() => fileButton("beta") !== null);
    await finish(9);expect(location.href).toBe(before401);expect(fileButton("beta")).not.toBeNull();expect(fixture.toasts()).toEqual([]);
    await download("beta");await until(() => fixture!.toasts().length === 1);
    expect(windows).toHaveLength(1);expect(fixture.toasts()[0].type).toBe("error");expect(document.body.textContent).toContain("fixture_download_unavailable");
    await download("beta");await until(() => windows.length === 2);
    expect(windows[1][0]).toBe(new URL("/fixture/space-b/beta.png", server.url).href);
    expect(document.body.textContent).not.toContain("fixture_download_unavailable");expect(fileButton("beta")).not.toBeNull();
    expect(urls).toHaveLength(11);
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
