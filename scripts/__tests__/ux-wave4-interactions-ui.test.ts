import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("Wave 4 dropdown menus, Select-in-Modal Escape, Toast live regions, and Textarea describedby behave correctly", async () => {
  if (process.env.TAKOS_UX_WAVE4_UI_PROCESS === "1") {
    await verifyInteractions();
    return;
  }
  const child = Bun.spawn([process.execPath, "test", import.meta.path], {
    env: { ...process.env, TAKOS_UX_WAVE4_UI_PROCESS: "1" },
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
      `Compiled Wave 4 UI: ${
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
  const output = await mkdtemp(join(tmpdir(), "takos-ux-wave4-ui-"));
  let fixture:
    | {
      selectedEvents: Array<{ kind: string; asDefault: boolean }>;
      setModalOpen: (open: boolean) => void;
      isModalOpen: () => boolean;
      setToasts: (
        toasts: Array<{ id: string; type: "success" | "error" | "info"; message: string }>,
      ) => void;
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
            "fixtures/ux-wave4-interactions/client.tsx",
          ),
          formats: ["iife"],
          name: "TakosUxWave4InteractionsTest",
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
    fixture = scope.uxWave4Fixture as NonNullable<typeof fixture>;

    const makeEvent = (type: string, props: Record<string, unknown> = {}) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, props);
      return ev;
    };

    const mouseClick = (el: HTMLElement) => {
      el.dispatchEvent(makeEvent("pointerdown"));
      el.dispatchEvent(makeEvent("pointerup"));
      el.dispatchEvent(makeEvent("click", { detail: 1 }));
    };

    // 1. StorageViewerShell + StorageHandlerDropdown: toggle close, mouse-open focusout, menuitem focus restore
    const viewerSection = document.getElementById("viewer-section")!;
    const handlerTrigger = viewerSection.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    expect(handlerTrigger).not.toBeNull();
    mouseClick(handlerTrigger);
    expect(viewerSection.querySelector('[role="menu"]')).not.toBeNull();

    // 2nd click on trigger must toggle menu CLOSED (no capture-phase reopen race)
    mouseClick(handlerTrigger);
    expect(viewerSection.querySelector('[role="menu"]')).toBeNull();

    // Mouse open -> focusout with relatedTarget === null must close menu (pointerDownInside not stuck true)
    mouseClick(handlerTrigger);
    expect(viewerSection.querySelector('[role="menu"]')).not.toBeNull();
    handlerTrigger.dispatchEvent(
      makeEvent("focusout", { relatedTarget: null }),
    );
    expect(viewerSection.querySelector('[role="menu"]')).toBeNull();

    // Activating a menuitem restores focus to the trigger button
    mouseClick(handlerTrigger);
    const firstHandlerItem = viewerSection.querySelector<HTMLButtonElement>(
      '[role="menu"] [role="menuitem"]',
    )!;
    firstHandlerItem.focus();
    firstHandlerItem.dispatchEvent(makeEvent("click"));
    expect(viewerSection.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(handlerTrigger);
    expect(fixture.selectedEvents).toEqual([
      { kind: "text-editor", asDefault: false },
    ]);

    // Activating the "Set as default" star menuitem also restores focus to trigger
    mouseClick(handlerTrigger);
    const starItem = viewerSection.querySelectorAll<HTMLButtonElement>(
      '[role="menu"] [role="menuitem"]',
    )[1]!;
    starItem.focus();
    starItem.dispatchEvent(makeEvent("click"));
    expect(viewerSection.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(handlerTrigger);
    expect(fixture.selectedEvents).toHaveLength(2);
    expect(fixture.selectedEvents[1].asDefault).toBe(true);

    // 2. ProfileMenu: mouse-open focusout closes menu, and Space activates <a role="menuitem">
    const profileSection = document.getElementById("profile-section")!;
    const profileTrigger = profileSection.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!;
    mouseClick(profileTrigger);
    expect(profileSection.querySelector('[role="menu"]')).not.toBeNull();
    profileTrigger.dispatchEvent(
      makeEvent("focusout", { relatedTarget: null }),
    );
    expect(profileSection.querySelector('[role="menu"]')).toBeNull();

    // Open ProfileMenu, focus <a href="/terms" role="menuitem">, press Space
    mouseClick(profileTrigger);
    const legalLink = profileSection.querySelector<HTMLAnchorElement>(
      'a[href="/terms"][role="menuitem"]',
    )!;
    expect(legalLink).not.toBeNull();
    let linkClicks = 0;
    legalLink.addEventListener("click", () => {
      linkClicks += 1;
    });
    legalLink.focus();
    const spaceEv = makeEvent("keydown", { key: " ", isComposing: false, keyCode: 32 });
    legalLink.dispatchEvent(spaceEv);
    expect(spaceEv.defaultPrevented).toBe(true);
    expect(linkClicks).toBe(1);
    expect(profileSection.querySelector('[role="menu"]')).toBeNull();

    // 3. Select inside Modal: Escape closes Select listbox without closing parent Modal
    fixture.setModalOpen(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const selectTrigger = document.getElementById("modal-select") as HTMLButtonElement;
    selectTrigger.focus();
    selectTrigger.dispatchEvent(makeEvent("click"));
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    const firstOption = document.querySelector<HTMLElement>('[role="option"]')!;
    expect(firstOption.style.minHeight).toBe("44px");

    // First Escape closes only the Select listbox; Modal remains open
    selectTrigger.dispatchEvent(
      makeEvent("keydown", { key: "Escape", isComposing: false, keyCode: 27 }),
    );
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(fixture.isModalOpen()).toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // Second Escape closes the Modal
    selectTrigger.dispatchEvent(
      makeEvent("keydown", { key: "Escape", isComposing: false, keyCode: 27 }),
    );
    expect(fixture.isModalOpen()).toBe(false);

    // 4. ToastContainer: separate persistent assertive/polite regions with zero nested aria-live
    const assertiveRegion = document.querySelector('[aria-live="assertive"]');
    const politeRegion = document.querySelector('[aria-live="polite"]');
    expect(assertiveRegion).not.toBeNull();
    expect(politeRegion).not.toBeNull();
    expect(assertiveRegion!.querySelector('[role="alert"]')).toBeNull();
    expect(politeRegion!.querySelector('[role="status"]')).toBeNull();

    fixture.setToasts([
      { id: "t-err", type: "error", message: "Save failed" },
      { id: "t-ok", type: "success", message: "Saved" },
    ]);
    expect(assertiveRegion!.querySelector('[role="alert"]')?.textContent).toContain("Save failed");
    expect(politeRegion!.querySelector('[role="status"]')?.textContent).toContain("Saved");
    expect(assertiveRegion!.querySelector("[aria-live]")).toBeNull();
    expect(politeRegion!.querySelector("[aria-live]")).toBeNull();

    // 5. Textarea merges caller aria-describedby with generated errorId
    const textarea = document.getElementById("merged-textarea")!;
    const errorEl = document.querySelector('#textarea-section [role="alert"]')!;
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    const describedBy = textarea.getAttribute("aria-describedby")!.split(/\s+/);
    expect(describedBy).toContain("custom-hint");
    expect(describedBy).toContain(errorEl.id);
  } finally {
    fixture?.dispose();
    await rm(output, { recursive: true, force: true });
  }
}
