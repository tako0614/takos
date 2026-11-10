import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

test("the actual ZIP button keeps its archive, pending state and feedback in the original view", async () => {
  if (process.env.TAKOS_STORAGE_ZIP_UI_PROCESS === "1") { await verifyZipUI();return; }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_STORAGE_ZIP_UI_PROCESS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Storage ZIP UI: ${stderr.split("\n").filter(line => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map(line => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifyZipUI() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-storage-zip-ui-"));
  const plan = [{ status: 200, phase: "headers" }, { status: 200, phase: "body" }, { status: 503, phase: "body" },
    { status: 200, phase: "body" }, { status: 503 }, { status: 200 }, { status: 200, phase: "body" }, { status: 200, phase: "body" }];
  const zipRequests: string[] = [], lists: string[] = [], responses = new Map<number, Response>(), entered = new Set<number>(), decoded = new Set<number>();
  const releases = new Map<number, () => void>(), blobReads: Promise<void>[] = [];
  const downloads: { name: string; entries?: Record<string, string> }[] = [];
  let fixture: { setSpace: (space: string) => void; setPath: (path: string) => void; dispose: () => void;
    toasts: () => { type: string; message: string }[]; clearToasts: () => void } | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined, attempts = 0;
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), space = url.pathname.split("/")[3], path = url.searchParams.get("path") ?? "/";
      expect(request.method).toBe("GET");
      if (url.pathname.endsWith("/download-zip")) {
        zipRequests.push(`${space}:${path}`);const number = zipRequests.length, responsePlan = plan[number - 1];expect(responsePlan).toBeDefined();
        const payload = responsePlan.status === 200 ? zipSync({ "origin.txt": strToU8(`${space}:${path}`) })
          : new TextEncoder().encode(JSON.stringify({ error: "fixture_zip_unavailable" }));
        const headers = { "Content-Type": responsePlan.status === 200 ? "application/zip" : "application/json" };
        if (responsePlan.phase === "headers") {
          entered.add(number);await new Promise<void>(resolve => { releases.set(number, resolve); });
        } else if (responsePlan.phase === "body") {
          entered.add(number);const prefix = responsePlan.status === 200 ? payload.subarray(0, 8) : new TextEncoder().encode(" ");
          return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(prefix);releases.set(number, () => { controller.enqueue(responsePlan.status === 200 ? payload.subarray(8) : payload);controller.close();releases.delete(number); });
          } }), { status: responsePlan.status, headers });
        }
        return new Response(payload.slice().buffer, { status: responsePlan.status, headers });
      }
      expect(url.pathname).toMatch(/^\/api\/spaces\/space-[ab]\/storage$/);lists.push(`${space}:${path}`);
      return Response.json({ files: [], path });
    } });
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/storage-delete/client.tsx"),
        formats: ["iife"], name: "StorageZipTest", fileName: () => "client.js" } },
    });
    const { document, Event, HTMLElement, Node } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    document.addEventListener("click", event => {
      const anchor = event.target as HTMLAnchorElement;if (anchor.tagName !== "A") return;
      const download: { name: string; entries?: Record<string, string> } = { name: anchor.download };downloads.push(download);
      blobReads.push(fetch(anchor.href).then(response => response.arrayBuffer()).then(buffer => {
        download.entries = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buffer))).map(([name, data]) => [name, strFromU8(data)]));
      }));
    });
    const saved = new Map<string, string>();
    const scope: Record<string, unknown> = {
      document, Event, HTMLElement, Node, console, URL, URLSearchParams, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, innerWidth: 1280, innerHeight: 800,
      navigator: { language: "en" }, location: { href: String(server.url), origin: server.url.origin, pathname: "/storage/space-a/a", search: "" },
      localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server!.url);expect(url.origin).toBe(server!.url.origin);
        const number = url.pathname.endsWith("/download-zip") ? ++attempts : undefined;
        const response = await fetch(url, init);
        if (number) {
          responses.set(number, response);const blob = response.blob.bind(response), json = response.json.bind(response);
          response.blob = async () => { try { return await blob(); } finally { decoded.add(number); } };
          response.json = async () => { try { return await json(); } finally { decoded.add(number); } };
        }
        return response;
      },
    };
    scope.window = scope;scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.storageDeleteFixture as NonNullable<typeof fixture>;
    const zip = () => document.querySelector<HTMLButtonElement>('button[title="ZIP"]')!;
    const refresh = () => document.querySelector<HTMLButtonElement>('button[title="Refresh"]')!;
    const loaded = () => refresh()?.disabled === false;
    const held = (number: number) => until(() => entered.has(number) && (plan[number - 1].phase === "headers" || responses.get(number)?.body?.locked === true));
    const finishBody = async (number: number) => { releases.get(number)!();await until(() => decoded.has(number));await Bun.sleep(0); };

    await until(loaded);zip().click();await held(1);expect(zip().disabled).toBe(true);
    fixture.setSpace("space-b");fixture.setPath("/b");await until(() => lists.includes("space-b:/b") && loaded());
    expect(zip().disabled).toBe(false);zip().click();await held(2);expect(zip().disabled).toBe(true);
    releases.get(1)!();releases.delete(1);await until(() => responses.has(1));await Bun.sleep(0);
    expect(zip().disabled).toBe(true);expect(downloads).toEqual([]);expect(fixture.toasts()).toEqual([]);expect(document.body.textContent).toContain("0 B");
    await finishBody(2);await Promise.all(blobReads);expect(downloads).toEqual([{ name: "b.zip", entries: { "origin.txt": "space-b:/b" } }]);
    expect(zip().disabled).toBe(false);expect(fixture.toasts().map(item => item.type)).toEqual(["success"]);fixture.clearToasts();

    zip().click();await held(3);fixture.setSpace("space-a");fixture.setPath("/");await until(() => lists.includes("space-a:/") && loaded());
    expect(zip().disabled).toBe(false);zip().click();await held(4);await finishBody(3);
    expect(zip().disabled).toBe(true);expect(downloads).toHaveLength(1);expect(fixture.toasts()).toEqual([]);expect(document.body.textContent).not.toContain("fixture_zip_unavailable");
    await finishBody(4);await Promise.all(blobReads);expect(downloads[1]).toEqual({ name: "workspace.zip", entries: { "origin.txt": "space-a:/" } });
    expect(zip().disabled).toBe(false);fixture.clearToasts();

    zip().click();await until(() => fixture!.toasts().length === 1);expect(zip().disabled).toBe(false);
    expect(downloads).toHaveLength(2);expect(fixture.toasts()[0].type).toBe("error");expect(document.body.textContent).toContain("fixture_zip_unavailable");
    zip().click();await until(() => downloads.length === 3);await Promise.all(blobReads);
    expect(downloads[2]).toEqual({ name: "workspace.zip", entries: { "origin.txt": "space-a:/" } });expect(document.body.textContent).not.toContain("fixture_zip_unavailable");fixture.clearToasts();

    zip().click();await held(7);zip().click();expect(zipRequests).toHaveLength(7);
    const beforeRefresh = lists.length;refresh().click();await until(() => lists.length > beforeRefresh && loaded());
    expect(zip().disabled).toBe(true);await finishBody(7);await Promise.all(blobReads);expect(downloads).toHaveLength(4);expect(zipRequests).toHaveLength(7);fixture.clearToasts();
    zip().click();await held(8);fixture.dispose();await finishBody(8);
    expect(downloads).toHaveLength(4);expect(fixture.toasts()).toEqual([]);
  } finally {
    for (const release of releases.values()) release();
    fixture?.clearToasts();fixture?.dispose();server?.stop(true);await Promise.allSettled(blobReads);await rm(output, { recursive: true, force: true });
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check() && Date.now() < end) await Bun.sleep(1);
  expect(check()).toBe(true);
}
