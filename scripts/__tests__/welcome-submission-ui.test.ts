import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("Welcome retains a failed first draft and attachments, then retries explicitly", async () => {
  if (process.env.TAKOS_WELCOME_UI_PROCESS === "1") {
    await verifyWelcomeSubmission();
    return;
  }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_WELCOME_UI_PROCESS: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled Welcome UI: ${stderr.split("\n").filter((line) => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map((line) => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyWelcomeSubmission() {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-welcome-ui-"));
  const releases: (() => void)[] = [];
  type Gate = { entered: Promise<void>; release: () => void; start: () => void; released: Promise<void>; status: number };
  let next: Gate | undefined;
  const arm = (status: number): Gate => {
    let start!: () => void, release!: () => void;
    const gate = { entered: new Promise<void>((yes) => { start = yes; }), released: new Promise<void>((yes) => { release = yes; }), status };
    next = { ...gate, start, release }; releases.push(release); return next;
  };
  const requests: { path: string; method: string; title: string }[] = [];
  const attempts: { path: string; method: string }[] = [];
  const previewURLs = new Set<string>();
  class PreviewURL extends URL {
    static createObjectURL(...args: Parameters<typeof URL.createObjectURL>) {
      const value = URL.createObjectURL(...args); previewURLs.add(value); return value;
    }
    static revokeObjectURL(...args: Parameters<typeof URL.revokeObjectURL>) {
      previewURLs.delete(args[0]); URL.revokeObjectURL(...args);
    }
  }
  let reads = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    attempts.push({ path, method: request.method });
    if (request.method !== "POST" || !/^\/api\/spaces\/space-[ab]\/threads$/.test(path) || !next) {
      throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
    }
    const gate = next; next = undefined;
    const body = await request.json() as { title: string };
    requests.push({ path, method: request.method, title: body.title });
    const requestNumber = requests.length;
    gate.start(); await gate.released;
    // Only response DTOs are synthetic. Production Welcome, action, Hono
    // client and RPC decoder run through real loopback HTTP unchanged.
    return gate.status === 201
      ? Response.json({ thread: { id: `created-${requestNumber}`, space_id: path.includes("space-b") ? "workspace-b" : "workspace-a", title: body.title, status: "active", created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z" } }, { status: 201 })
      : Response.json({ error: { code: "SYNTHETIC_UNAVAILABLE", message: "Synthetic create unavailable" } }, { status: gate.status });
  } });
  let fixture: { setSpace: (id: "a" | "b") => void; state: () => { accepted: { spaceId: string; threadId: string; message: string; files: string[] }[]; toasts: { type: string; message: string }[] }; dispose: () => void } | undefined;
  try {
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/welcome-submission/client.tsx"), formats: ["iife"], name: "WelcomeSubmissionTest", fileName: () => "client.js" } },
    });
    const { document, Event, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const storage = new Map<string, string>();
    const scope: Record<string, unknown> = {
      document, HTMLElement, console, URL: PreviewURL, Headers, Request, Response, Blob, File,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      navigator: { language: "en" },
      location: { href: String(server.url), origin: server.url.origin, pathname: "/chat/space-a", search: "" },
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server.url);
        if (url.origin !== server.url.origin) throw new Error("Non-loopback fixture request refused");
        const response = await fetch(url, init);
        const readJson = response.json.bind(response);
        response.json = async () => { try { return await readJson(); } finally { reads++; } };
        return response;
      },
    };
    scope.window = scope; scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.welcomeSubmissionFixture as NonNullable<typeof fixture>;
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!;
    const send = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
    textarea.value = "  Draft to retry  "; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const file = new File(["draft attachment"], "draft.txt", { type: "text/plain" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.body.textContent).toContain("draft.txt");
    const failure = arm(400); send.click(); await failure.entered;
    expect(textarea.value).toBe("  Draft to retry  ");
    expect(document.body.textContent).toContain("draft.txt");
    expect(send.disabled).toBe(true);
    send.click();
    expect(requests).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    failure.release(); await waitFor(() => reads === 1 && !send.disabled);
    expect(textarea.value).toBe("  Draft to retry  ");
    expect(document.body.textContent).toContain("draft.txt");
    expect(fixture.state().accepted).toEqual([]);
    expect(fixture.state().toasts.at(-1)?.message).toContain("Synthetic create unavailable");
    const success = arm(201); send.click(); await success.entered;
    expect(requests.map(({ title }) => title)).toEqual(["Draft to retry", "Draft to retry"]);
    success.release(); await waitFor(() => fixture!.state().accepted.length === 1);
    expect(textarea.value).toBe("");
    expect(document.body.textContent).not.toContain("draft.txt");
    expect(fixture.state().accepted[0]).toMatchObject({ spaceId: "space-a", message: "Draft to retry", files: ["draft.txt"] });
    expect(requests).toHaveLength(2);

    // The actual reused form must become usable for B while A is pending.
    textarea.value = "Old A draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=", "base64"));
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File([png], "a-only.png", { type: "image/png" })] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(previewURLs.size).toBe(1);
    const oldA = arm(400); send.click(); await oldA.entered;
    fixture.setSpace("b");
    expect(textarea.value).toBe("");
    expect(document.body.textContent).not.toContain("a-only.png");
    expect(previewURLs.size).toBe(0);
    expect(textarea.disabled).toBe(false);
    expect(send.disabled).toBe(true);
    textarea.value = "Current B draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["B"], "b.txt", { type: "text/plain" })] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    const currentB = arm(201); send.click(); await currentB.entered;
    const toastCount = fixture.state().toasts.length;
    oldA.release(); await waitFor(() => reads === 3);
    expect(send.disabled).toBe(true);
    expect(textarea.value).toBe("Current B draft");
    expect(document.body.textContent).toContain("b.txt");
    expect(fixture.state().toasts).toHaveLength(toastCount);
    expect(fixture.state().accepted).toHaveLength(1);
    currentB.release(); await waitFor(() => fixture!.state().accepted.length === 2);
    expect(fixture.state().accepted[1]).toMatchObject({ spaceId: "space-b", message: "Current B draft", files: ["b.txt"] });
    expect(requests.map(({ path }) => path)).toEqual([
      "/api/spaces/space-a/threads", "/api/spaces/space-a/threads",
      "/api/spaces/space-a/threads", "/api/spaces/space-b/threads",
    ]);
    expect(textarea.value).toBe("");
    expect(document.body.textContent).not.toContain("b.txt");
    fixture.setSpace("a");
    expect(textarea.value).toBe("Old A draft");
    expect(document.body.textContent).toContain("a-only.png");
    expect(document.body.textContent).not.toContain("b.txt");
    expect(previewURLs.size).toBe(1);
    expect(attempts).toEqual(requests.map(({ path, method }) => ({ path, method })));
    expect(attempts).toHaveLength(4);

    textarea.value = "Created while away"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const lateCreated = arm(201); send.click(); await lateCreated.entered;
    fixture.setSpace("b"); lateCreated.release(); await waitFor(() => reads === 5);
    fixture.setSpace("a");
    expect(send.getAttribute("aria-label")).toBe("Continue");
    expect(document.body.textContent).toContain("Chat created");
    textarea.value = "Updated visible draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    send.click(); await waitFor(() => fixture!.state().accepted.length === 3);
    expect(fixture.state().accepted[2]).toMatchObject({ threadId: "created-5", spaceId: "space-a", message: "Updated visible draft", files: ["a-only.png"] });
    expect(attempts).toHaveLength(5);
    expect(textarea.value).toBe("");

    // A timeout is not proof that create had no effect. Ordinary Send is refused;
    // only an explicit, scope-bound new-chat confirmation may issue a POST.
    textarea.value = "Unknown A result"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const unknown = arm(408); send.click(); await unknown.entered;
    unknown.release(); await waitFor(() => reads === 6 && !textarea.disabled);
    expect(document.body.textContent).toContain("may already have been created");
    expect(send.disabled).toBe(true);
    send.click(); expect(attempts).toHaveLength(6);
    const createAnother = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Create another chat")!.click();
    const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((button) => button.textContent === text)!.click();
    createAnother(); await waitFor(() => document.querySelector("[role=dialog]") !== null);
    dialogButton("Cancel"); await waitFor(() => document.querySelector("[role=dialog]") === null);
    expect(attempts).toHaveLength(6);
    expect(textarea.value).toBe("Unknown A result");
    createAnother(); await waitFor(() => document.querySelector("[role=dialog]") !== null);
    fixture.setSpace("b"); dialogButton("Create another chat"); await Bun.sleep(0);
    expect(attempts).toHaveLength(6);
    expect(textarea.value).toBe("");
    fixture.setSpace("a");
    expect(textarea.value).toBe("Unknown A result");
    expect(send.disabled).toBe(true);
    const explicitNew = arm(201);
    createAnother(); await waitFor(() => document.querySelector("[role=dialog]") !== null);
    dialogButton("Create another chat"); await explicitNew.entered;
    explicitNew.release(); await waitFor(() => fixture!.state().accepted.length === 4);
    expect(attempts).toHaveLength(7);
    expect(requests.at(-1)).toMatchObject({ path: "/api/spaces/space-a/threads", title: "Unknown A result" });
    expect(textarea.value).toBe("");
    expect(attempts).toEqual(requests.map(({ path, method }) => ({ path, method })));
  } finally {
    for (const release of releases) release();
    fixture?.dispose(); server.stop(true);
    await rm(output, { recursive: true, force: true });
    expect(previewURLs.size).toBe(0);
  }
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Welcome UI phase did not close");
    await Bun.sleep(5);
  }
}
