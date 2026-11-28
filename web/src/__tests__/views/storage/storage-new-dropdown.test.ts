import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import { parseHTML } from "linkedom";
import { restoreFocusAfterDialogClose } from "../../../hooks/useFocusTrap.ts";
import {
  activateDropdownMenuItem,
  focusDropdownMenuItem,
  handleDropdownMenuKeyDown,
  handleMenuTriggerKeyDown,
  type MenuFocusTarget,
  shouldCloseOnFocusOut,
} from "../../../views/storage/storage-new-dropdown-menu.ts";

function setupDropdownDom() {
  const { document } = parseHTML(`
    <body>
      <main id="app-main">
        <div id="dropdown-root">
          <button id="trigger" type="button" aria-haspopup="menu">New</button>
          <div id="menu" role="menu">
            <button id="item-folder" type="button" role="menuitem">New folder</button>
            <button id="item-upload" type="button" role="menuitem">Upload</button>
          </div>
        </div>
        <button id="refresh" type="button">Refresh</button>
      </main>
    </body>
  `);

  const originalDocument = globalThis.document;
  (globalThis as unknown as { document: Document }).document =
    document as unknown as Document;

  let activeElement: HTMLElement | null = document.body as unknown as HTMLElement;
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => activeElement,
  });

  const focusedIds: string[] = [];
  const wireFocus = (id: string) => {
    const el = document.getElementById(id) as unknown as HTMLElement;
    el.focus = () => {
      activeElement = el;
      focusedIds.push(id);
    };
    return el;
  };

  const root = document.getElementById("dropdown-root") as unknown as HTMLElement;
  const trigger = wireFocus("trigger");
  const menu = document.getElementById("menu") as unknown as HTMLElement;
  const itemFolder = wireFocus("item-folder");
  const itemUpload = wireFocus("item-upload");
  const refresh = wireFocus("refresh");

  return {
    document,
    root,
    trigger,
    menu,
    itemFolder,
    itemUpload,
    refresh,
    focusedIds,
    setActiveElement: (el: HTMLElement | null) => {
      activeElement = el;
    },
    cleanup: () => {
      (globalThis as unknown as { document: Document }).document = originalDocument;
    },
  };
}

function makeKeyEvent(
  key: string,
  extra?: Partial<{ isComposing: boolean; keyCode: number }>,
) {
  let prevented = false;
  const event = {
    key,
    isComposing: extra?.isComposing ?? false,
    keyCode: extra?.keyCode ?? 0,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as KeyboardEvent;
  return {
    event,
    wasPrevented: () => prevented,
  };
}

test("StorageNewDropdown trigger ArrowDown/ArrowUp opens and targets first/last item while respecting IME", () => {
  const dom = setupDropdownDom();
  try {
    const openedTargets: MenuFocusTarget[] = [];

    // IME composing must be ignored.
    const ime = makeKeyEvent("ArrowDown", { isComposing: true });
    strictEqual(
      handleMenuTriggerKeyDown(ime.event, {
        isOpen: false,
        getMenu: () => dom.menu,
        openWithTarget: (target) => openedTargets.push(target),
      }),
      false,
    );
    strictEqual(ime.wasPrevented(), false);
    strictEqual(openedTargets.length, 0);

    // ArrowDown when closed requests opening on first item.
    const down = makeKeyEvent("ArrowDown");
    strictEqual(
      handleMenuTriggerKeyDown(down.event, {
        isOpen: false,
        getMenu: () => dom.menu,
        openWithTarget: (target) => openedTargets.push(target),
      }),
      true,
    );
    strictEqual(down.wasPrevented(), true);

    // ArrowUp when closed requests opening on last item.
    const up = makeKeyEvent("ArrowUp");
    strictEqual(
      handleMenuTriggerKeyDown(up.event, {
        isOpen: false,
        getMenu: () => dom.menu,
        openWithTarget: (target) => openedTargets.push(target),
      }),
      true,
    );
    strictEqual(up.wasPrevented(), true);
    deepStrictEqual(openedTargets, ["first", "last"]);

    // focusDropdownMenuItem moves focus into menu immediately upon open.
    strictEqual(focusDropdownMenuItem(dom.menu, "first"), dom.itemFolder);
    strictEqual(dom.document.activeElement, dom.itemFolder);
    strictEqual(focusDropdownMenuItem(dom.menu, "last"), dom.itemUpload);
    strictEqual(dom.document.activeElement, dom.itemUpload);
  } finally {
    dom.cleanup();
  }
});

test("StorageNewDropdown menu handles Arrow/Home/End roving focus and closes cleanly on Tab without preventing default", () => {
  const dom = setupDropdownDom();
  try {
    let closed = false;
    const opts = {
      getMenu: () => dom.menu,
      getTrigger: () => dom.trigger,
      close: () => {
        closed = true;
      },
    };

    // Starting on first item: ArrowDown -> Upload, ArrowDown -> wraps to Folder.
    dom.itemFolder.focus();
    const down1 = makeKeyEvent("ArrowDown");
    strictEqual(handleDropdownMenuKeyDown(down1.event, opts), true);
    strictEqual(down1.wasPrevented(), true);
    strictEqual(dom.document.activeElement, dom.itemUpload);

    const down2 = makeKeyEvent("ArrowDown");
    strictEqual(handleDropdownMenuKeyDown(down2.event, opts), true);
    strictEqual(dom.document.activeElement, dom.itemFolder);

    // ArrowUp wraps to Upload; Home -> Folder; End -> Upload.
    const up = makeKeyEvent("ArrowUp");
    strictEqual(handleDropdownMenuKeyDown(up.event, opts), true);
    strictEqual(dom.document.activeElement, dom.itemUpload);

    const home = makeKeyEvent("Home");
    strictEqual(handleDropdownMenuKeyDown(home.event, opts), true);
    strictEqual(dom.document.activeElement, dom.itemFolder);

    const end = makeKeyEvent("End");
    strictEqual(handleDropdownMenuKeyDown(end.event, opts), true);
    strictEqual(dom.document.activeElement, dom.itemUpload);

    // Tab closes menu and moves focus to trigger without calling preventDefault
    // so the browser advances naturally to the next control (Refresh).
    const tab = makeKeyEvent("Tab");
    strictEqual(handleDropdownMenuKeyDown(tab.event, opts), true);
    strictEqual(tab.wasPrevented(), false);
    strictEqual(closed, true);
    strictEqual(dom.document.activeElement, dom.trigger);
  } finally {
    dom.cleanup();
  }
});

test("StorageNewDropdown focusout closes only when focus leaves the dropdown container", () => {
  const dom = setupDropdownDom();
  try {
    // Moving between menu items or back to trigger stays open.
    strictEqual(
      shouldCloseOnFocusOut(
        { relatedTarget: dom.itemUpload } as unknown as FocusEvent,
        dom.root,
        false,
      ),
      false,
    );
    strictEqual(
      shouldCloseOnFocusOut(
        { relatedTarget: dom.trigger } as unknown as FocusEvent,
        dom.root,
        false,
      ),
      false,
    );

    // Pointer interaction inside container with null relatedTarget keeps menu open until click.
    strictEqual(
      shouldCloseOnFocusOut(
        { relatedTarget: null } as unknown as FocusEvent,
        dom.root,
        true,
      ),
      false,
    );

    // Focus moving outside to Refresh or window blur closes the menu.
    strictEqual(
      shouldCloseOnFocusOut(
        { relatedTarget: dom.refresh } as unknown as FocusEvent,
        dom.root,
        false,
      ),
      true,
    );
    strictEqual(
      shouldCloseOnFocusOut(
        { relatedTarget: null } as unknown as FocusEvent,
        dom.root,
        false,
      ),
      true,
    );
  } finally {
    dom.cleanup();
  }
});

test("StorageNewDropdown restores focus to trigger before invoking modal action so closing modal returns focus to trigger", () => {
  const dom = setupDropdownDom();
  try {
    dom.itemFolder.focus();

    let capturedBeforeModal: HTMLElement | null = null;
    const modal = dom.document.createElement("div") as unknown as HTMLElement;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    dom.document.body.appendChild(modal as unknown as Node);

    activateDropdownMenuItem({
      close: () => {
        // Simulate Solid unmounting the menu and activeElement falling back to <body>.
        dom.menu.remove();
        dom.setActiveElement(dom.document.body as unknown as HTMLElement);
      },
      getTrigger: () => dom.trigger,
      action: () => {
        // useFocusTrap captures document.activeElement when CreateFolderModal mounts.
        capturedBeforeModal = dom.document.activeElement as HTMLElement | null;
      },
    });

    strictEqual(capturedBeforeModal, dom.trigger);

    // Closing the modal restores focus directly to the mounted trigger button.
    modal.remove();
    const restored = restoreFocusAfterDialogClose(capturedBeforeModal, modal);
    strictEqual(restored, dom.trigger);
    strictEqual(dom.document.activeElement, dom.trigger);
  } finally {
    dom.cleanup();
  }
});
