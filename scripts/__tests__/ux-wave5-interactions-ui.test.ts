import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("Wave 5 modals, label associations, filter recovery, CardTitle, Input, and StorageContextMenu behave correctly", async () => {
  if (process.env.TAKOS_UX_WAVE5_UI_PROCESS === "1") {
    await verifyInteractions();
    return;
  }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_UX_WAVE5_UI_PROCESS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(
      `Compiled Wave 5 UI: ${
        stderr
          .split("\n")
          .filter((line) => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line))
          .map((line) => line.trim())
          .join("; ")
      }`,
    );
    expect(code).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 45_000);

async function verifyInteractions() {
  const [
    { parseHTML },
    { build },
    { default: solid },
    { createContext, runInContext },
  ] = await Promise.all([
    import("linkedom"),
    import("vite"),
    import("vite-plugin-solid"),
    import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-ux-wave5-ui-"));
  let fixture:
    | {
      setShowMcpModal: (open: boolean) => void;
      setShowGitModal: (open: boolean) => void;
      setGitInitial: (v: { url?: string; ref?: string; modulePath?: string }) => void;
      setShowRepoModal: (open: boolean) => void;
      setRepoCreateHandler: (
        fn: (
          name: string,
          description: string,
          visibility: "public" | "private",
        ) => Promise<void>,
      ) => void;
      setShowExportModal: (open: boolean) => void;
      exportedFormats: string[];
      setShowConfirm: (open: boolean) => void;
      setShowCtxMenu: (open: boolean) => void;
      isCtxMenuOpen: () => boolean;
      dispose: () => void;
    }
    | undefined;

  try {
    await build({
      configFile: false,
      root: resolve(import.meta.dir, "../.."),
      logLevel: "silent",
      plugins: [solid()],
      build: {
        outDir: output,
        minify: false,
        lib: {
          entry: resolve(
            import.meta.dir,
            "fixtures/ux-wave5-interactions/client.tsx",
          ),
          formats: ["iife"],
          name: "TakosUxWave5InteractionsTest",
          fileName: () => "client.js",
        },
      },
    });

    const { window, document, Event, HTMLElement, Node } = parseHTML(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    let activeEl: Element | null = document.body;
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => activeEl,
    });
    const setActiveEl = (el: Element | null) => {
      activeEl = el;
    };
    const origFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function focusPatched(this: HTMLElement) {
      setActiveEl(this);
      if (typeof origFocus === "function") {
        try {
          origFocus.call(this);
        } catch {
          // linkedom focus no-op
        }
      }
    };

    const storage = new Map<string, string>();
    const scope: Record<string, unknown> = {
      document,
      HTMLElement,
      Node,
      Event,
      console,
      crypto,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
      cancelAnimationFrame: clearTimeout,
      innerWidth: 1024,
      innerHeight: 800,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
      }),
      navigator: { language: "en" },
      location: { href: "http://127.0.0.1/", origin: "http://127.0.0.1" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    };
    scope.window = scope;
    scope.self = scope;
    runInContext(
      await readFile(join(output, "client.js"), "utf8"),
      createContext(scope),
    );
    fixture = scope.uxWave5Fixture as NonNullable<typeof fixture>;

    const makeEvent = (type: string, props: Record<string, unknown> = {}) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, props);
      return ev;
    };

    // 1. CardTitle honors explicit text color class without inline color override
    const defaultTitle = document.getElementById("default-card-title")!;
    const dangerTitle = document.getElementById("danger-card-title")!;
    expect(defaultTitle.style.color).toBe("var(--color-text-primary)");
    expect(dangerTitle.style.color).toBe("");
    expect(dangerTitle.className).toContain("text-red-600");

    // 2. Input merges caller aria-describedby with generated errorId
    const mergedInput = document.getElementById("merged-input")!;
    const inputAlert = document.querySelector('#input-section [role="alert"]')!;
    expect(mergedInput.getAttribute("aria-invalid")).toBe("true");
    const inputDescribedBy = mergedInput.getAttribute("aria-describedby")!.split(/\s+/);
    expect(inputDescribedBy).toContain("input-hint");
    expect(inputDescribedBy).toContain(inputAlert.id);

    // 3. MemoryList search filter empty state offers Clear filters and restores items
    const memSection = document.getElementById("memory-section")!;
    const stars = memSection.querySelector('[aria-label^="Importance:"]');
    expect(stars).not.toBeNull();
    expect(stars!.getAttribute("aria-label")).toBe("Importance: 4/5");
    expect(stars!.querySelector('[aria-hidden="true"]')?.textContent).toBe("\u2605\u2605\u2605\u2605\u2606");

    const memSearch = memSection.querySelector<HTMLInputElement>('input[type="text"]')!;
    memSearch.value = "no-such-memory-match";
    memSearch.dispatchEvent(makeEvent("input"));
    expect(memSection.textContent).toContain("No results found");
    const clearBtn = Array.from(memSection.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Clear filters"),
    );
    expect(clearBtn).toBeDefined();
    clearBtn!.dispatchEvent(makeEvent("click"));
    expect(memSection.textContent).toContain("Keep contrast above WCAG AA");

    // 4. CreateMcpServerModal: explicit label[for]/id and alerts outside <label>
    fixture.setShowMcpModal(true);
    const mcpDialog = document.querySelector('[role="dialog"]')!;
    const mcpLabels = Array.from(mcpDialog.querySelectorAll("label"));
    expect(mcpLabels.length).toBe(2);
    for (const lbl of mcpLabels) {
      const targetId = lbl.getAttribute("for");
      expect(targetId).toBeTruthy();
      expect(document.getElementById(targetId!)).not.toBeNull();
    }
    const mcpNameInput = document.getElementById(mcpLabels[0].getAttribute("for")!) as HTMLInputElement;
    mcpNameInput.value = "123-bad";
    mcpNameInput.dispatchEvent(makeEvent("input"));
    const mcpNameAlert = mcpDialog.querySelector('[role="alert"]')!;
    expect(mcpNameAlert).not.toBeNull();
    expect(mcpNameAlert.closest("label")).toBeNull();
    expect(mcpNameInput.getAttribute("aria-describedby")).toBe(mcpNameAlert.id);

    const advBtn = mcpDialog.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(advBtn.getAttribute("aria-expanded")).toBe("false");
    advBtn.dispatchEvent(makeEvent("click"));
    expect(advBtn.getAttribute("aria-expanded")).toBe("true");
    expect(mcpDialog.querySelectorAll("label").length).toBe(3);
    fixture.setShowMcpModal(false);

    // 5. GitUrlInstallModal: explicit label[for]/id and resync on reopen with new props
    fixture.setShowGitModal(true);
    const gitDialog = document.querySelector('[role="dialog"]')!;
    const gitLabels = Array.from(gitDialog.querySelectorAll("label"));
    expect(gitLabels.length).toBe(3);
    for (const lbl of gitLabels) {
      const targetId = lbl.getAttribute("for");
      expect(targetId).toBeTruthy();
      expect(document.getElementById(targetId!)).not.toBeNull();
    }
    const urlInput = document.getElementById(gitLabels[0].getAttribute("for")!) as HTMLInputElement;
    expect(urlInput.value).toBe("https://github.com/example/one.git");

    fixture.setShowGitModal(false);
    fixture.setGitInitial({
      url: "https://github.com/example/two.git",
      ref: "v2.0.0",
      modulePath: "packages/app",
    });
    fixture.setShowGitModal(true);
    const reopenedDialog = document.querySelector('[role="dialog"]')!;
    const reopenedLabels = Array.from(reopenedDialog.querySelectorAll("label"));
    const reopenedUrl = document.getElementById(reopenedLabels[0].getAttribute("for")!) as HTMLInputElement;
    const reopenedRef = document.getElementById(reopenedLabels[1].getAttribute("for")!) as HTMLInputElement;
    const reopenedMod = document.getElementById(reopenedLabels[2].getAttribute("for")!) as HTMLInputElement;
    expect(reopenedUrl.value).toBe("https://github.com/example/two.git");
    expect(reopenedRef.value).toBe("v2.0.0");
    expect(reopenedMod.value).toBe("packages/app");
    fixture.setShowGitModal(false);

    // 6. CreateRepoModal: async submitting aria-busy and error recovery preserving draft
    let rejectCreate: ((err: Error) => void) | undefined;
    fixture.setRepoCreateHandler(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCreate = reject;
        }),
    );
    fixture.setShowRepoModal(true);
    const repoDialog = document.querySelector('[role="dialog"]')!;
    const repoNameInput = repoDialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    repoNameInput.value = "demo-repo";
    repoNameInput.dispatchEvent(makeEvent("input"));
    const repoForm = repoDialog.querySelector("form")!;
    const repoSubmitBtn = repoDialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    repoForm.dispatchEvent(makeEvent("submit"));
    expect(repoSubmitBtn.getAttribute("aria-busy")).toBe("true");
    expect(repoSubmitBtn.disabled).toBe(true);

    rejectCreate!(new Error("Repository already exists"));
    await new Promise((r) => setTimeout(r, 0));
    expect(repoSubmitBtn.getAttribute("aria-busy")).toBeNull();
    expect(repoDialog.querySelector('[role="alert"]')?.textContent).toContain(
      "Repository already exists",
    );
    expect(repoNameInput.value).toBe("demo-repo");
    fixture.setShowRepoModal(false);

    // 7. ChatExportModal: useFocusTrap focuses spread autofocus button and exports selected format
    fixture.setShowExportModal(true);
    const exportDialog = document.querySelector('[role="dialog"]')!;
    const mdBtn = Array.from(exportDialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Markdown",
    )!;
    expect(document.activeElement).toBe(mdBtn);
    mdBtn.dispatchEvent(makeEvent("click"));
    expect(fixture.exportedFormats).toEqual(["markdown"]);
    fixture.setShowExportModal(false);

    // 8. ConfirmDialog: renders <h2> title (no h1 -> h3 heading skip)
    fixture.setShowConfirm(true);
    const confirmDialog = document.querySelector('[role="dialog"]')!;
    expect(confirmDialog.querySelector("h2")?.textContent).toBe("Delete workspace");
    expect(confirmDialog.querySelector("h3")).toBeNull();
    fixture.setShowConfirm(false);

    // 9. StorageContextMenu: Tab and focusout dismiss without stealing focus back
    const triggerBtn = document.getElementById("ctx-trigger") as HTMLButtonElement;
    const outsideBtn = document.getElementById("ctx-outside") as HTMLButtonElement;
    triggerBtn.focus();
    fixture.setShowCtxMenu(true);
    const ctxMenu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(ctxMenu).not.toBeNull();
    const firstItem = ctxMenu.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(document.activeElement).toBe(firstItem);

    // Tab dismisses menu without restoring focus to trigger
    firstItem.dispatchEvent(makeEvent("keydown", { key: "Tab", isComposing: false, keyCode: 9 }));
    expect(fixture.isCtxMenuOpen()).toBe(false);
    expect(document.activeElement).not.toBe(triggerBtn);

    // focusout moving to outside element dismisses menu
    triggerBtn.focus();
    fixture.setShowCtxMenu(true);
    const ctxMenu2 = document.querySelector<HTMLElement>('[role="menu"]')!;
    ctxMenu2.dispatchEvent(makeEvent("focusout", { relatedTarget: outsideBtn }));
    expect(fixture.isCtxMenuOpen()).toBe(false);
    expect(document.activeElement).not.toBe(triggerBtn);
  } finally {
    fixture?.dispose();
    await rm(output, { recursive: true, force: true });
  }
}
