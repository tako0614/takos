import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

type HydrationFixture = {
  metrics: { fetches: number };
  dispose: () => void;
};

test("Solid SSR resources hydrate into existing DOM and remain interactive", async () => {
  if (process.env.TAKOS_SOLID_HYDRATION_TEST_PROCESS === "1") {
    await verifyHydration();
    return;
  }
  // Bun 1.3's VM can change Error.captureStackTrace behavior in the parent
  // realm. Run browser hydration in a child so the portable suite stays intact.
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_SOLID_HYDRATION_TEST_PROCESS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Hydration proof failed:\n${stdout}${stderr}`);
    }
    expect(exitCode).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyHydration(): Promise<void> {
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] =
    await Promise.all([
      import("linkedom"),
      import("vite"),
      import("vite-plugin-solid"),
      import("node:vm"),
    ]);
  const fixtures = resolve(import.meta.dir, "fixtures/solid-hydration");
  const output = await mkdtemp(join(tmpdir(), "takos-solid-hydration-"));
  let fixture: HydrationFixture | undefined;
  try {
    // Compile the same component using the real SSR and browser transforms.
    // Builds are isolated from the application's dist and from other tests.
    await build({
      configFile: false,
      root: fixtures,
      logLevel: "silent",
      plugins: [solid({ ssr: true })],
      ssr: { noExternal: true },
      build: {
        ssr: resolve(fixtures, "server.jsx"),
        outDir: join(output, "server"),
        minify: false,
      },
    });
    const server = await import(
      pathToFileURL(join(output, "server/server.js")).href
    );
    const html: string = await server.renderWorkspace();
    await build({
      configFile: false,
      root: fixtures,
      logLevel: "silent",
      plugins: [solid({ ssr: true })],
      build: {
        outDir: join(output, "client"),
        minify: false,
        lib: {
          entry: resolve(fixtures, "client.jsx"),
          formats: ["iife"],
          name: "TakosHydrationTest",
          fileName: () => "client.js",
        },
      },
    });

    const { document, Event } = parseHTML(html);
    const originalButton = document.getElementById("increment");
    const originalLabel = document.getElementById("workspace-label");
    expect(originalButton?.textContent.trim()).toBe("0");
    expect(originalLabel?.textContent).toBe("Takos <workspace>");
    expect(html).toContain("Takos &lt;workspace>");

    // Run emitted hydration scripts and browser runtime in their own realm;
    // no DOM globals, module mocks, or condition switches leak to other tests.
    const scope: Record<string, unknown> = {
      document, console, URL, Headers, Request, Response, Blob,
      setTimeout, clearTimeout, queueMicrotask,
    };
    scope.window = scope;
    scope.self = scope;
    const context = createContext(scope);
    for (const script of document.querySelectorAll("script")) {
      runInContext(script.textContent, context);
    }
    runInContext(await readFile(join(output, "client/client.js"), "utf8"), context);
    fixture = scope.takosHydrationFixture as HydrationFixture;
    await new Promise<void>((done) => setTimeout(done, 0));

    expect(document.getElementById("increment")).toBe(originalButton);
    expect(document.getElementById("workspace-label")).toBe(originalLabel);
    expect(fixture.metrics.fetches).toBe(0);
    expect(document.getElementById("workspace-date")?.textContent).toBe(
      "2026-10-14T12:00:00.000Z",
    );
    expect(document.getElementById("workspace-host")?.textContent).toBe(
      "example.test",
    );
    expect(document.getElementById("workspace-count")?.textContent).toBe("3");
    expect(document.getElementById("promise-status")?.textContent).toBe(
      "restored promise",
    );

    originalButton!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(originalButton?.textContent.trim()).toBe("1");
    originalButton!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(originalButton?.textContent.trim()).toBe("2");
  } finally {
    fixture?.dispose();
    await rm(output, { recursive: true, force: true });
  }
}
