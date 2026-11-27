import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import { parseHTML } from "linkedom";
import {
  getFocusableElements,
  restoreFocusAfterDialogClose,
  shouldRestoreFocus,
} from "../../hooks/useFocusTrap.ts";

test("getFocusableElements - skips disabled, hidden, inert, aria-hidden, tabindex=-1, disabled fieldset, and closed details content", () => {
  const { document } = parseHTML(`
    <div id="dialog">
      <button id="ok-btn">OK</button>
      <button id="disabled-btn" disabled>Disabled</button>
      <input id="hidden-type" type="hidden" value="x" />
      <input id="hidden-attr" hidden />
      <div inert><button id="inert-btn">Inert</button></div>
      <div aria-hidden="true"><button id="aria-hidden-btn">Hidden</button></div>
      <button id="neg-tab" tabindex="-1">No tab</button>
      <fieldset disabled>
        <legend><button id="legend-btn">Legend</button></legend>
        <button id="fieldset-btn">Fieldset</button>
      </fieldset>
      <details id="closed-details">
        <summary id="closed-summary">More</summary>
        <button id="closed-inner-btn">Hidden inside closed details</button>
      </details>
      <details id="open-details" open>
        <summary id="open-summary">Open</summary>
        <button id="open-inner-btn">Visible inside open details</button>
      </details>
      <a id="ok-link" href="/privacy">Privacy</a>
    </div>
  `);

  const dialog = document.getElementById("dialog") as unknown as HTMLElement;
  const focusableIds = getFocusableElements(dialog).map((el) => el.id);

  deepStrictEqual(focusableIds, [
    "ok-btn",
    "legend-btn",
    "closed-summary",
    "open-summary",
    "open-inner-btn",
    "ok-link",
  ]);
});

test("shouldRestoreFocus - restores to trigger when no other modal is open and respects stacked modals", () => {
  const { document } = parseHTML(`
    <body>
      <button id="trigger">Open</button>
      <div id="outer" role="dialog" aria-modal="true">
        <button id="outer-btn">Open inner</button>
      </div>
      <div id="inner" role="dialog" aria-modal="true">
        <button id="inner-btn">Close</button>
      </div>
    </body>
  `);

  const originalDocument = globalThis.document;
  (globalThis as unknown as { document: Document }).document =
    document as unknown as Document;

  try {
    const trigger = document.getElementById("trigger") as unknown as HTMLElement;
    const outer = document.getElementById("outer") as unknown as HTMLElement;
    const outerBtn = document.getElementById("outer-btn") as unknown as HTMLElement;
    const inner = document.getElementById("inner") as unknown as HTMLElement;

    // Closing inner while outer is open should restore to outerBtn, not outside trigger.
    strictEqual(shouldRestoreFocus(outerBtn, inner), true);
    strictEqual(shouldRestoreFocus(trigger, inner), false);

    // Once inner is removed, closing outer should restore to trigger.
    inner.remove();
    strictEqual(shouldRestoreFocus(trigger, outer), true);
    strictEqual(shouldRestoreFocus(null, outer), false);
  } finally {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

test("getFocusableElements - skips descendants of display:none ancestors and visibility:hidden elements", () => {
  const { document } = parseHTML(`
    <div id="dialog">
      <button id="visible-btn">Visible</button>
      <div id="hidden-ancestor" class="hidden">
        <div id="nested-wrapper">
          <button id="ancestor-hidden-btn">Inside display:none ancestor</button>
        </div>
      </div>
      <button id="vis-hidden-btn" class="invisible">Visibility hidden</button>
    </div>
  `);

  const originalGetComputedStyle = globalThis.getComputedStyle;
  (globalThis as unknown as {
    getComputedStyle: (el: Element) => { display: string; visibility: string };
  }).getComputedStyle = (el: Element) => {
    const cls = el.getAttribute("class") ?? "";
    return {
      display: cls.includes("hidden") ? "none" : "block",
      visibility: cls.includes("invisible") ? "hidden" : "visible",
    };
  };

  try {
    const dialog = document.getElementById("dialog") as unknown as HTMLElement;
    const focusableIds = getFocusableElements(dialog).map((el) => el.id);
    deepStrictEqual(focusableIds, ["visible-btn"]);
  } finally {
    (globalThis as unknown as {
      getComputedStyle: typeof globalThis.getComputedStyle;
    }).getComputedStyle = originalGetComputedStyle;
  }
});

test("restoreFocusAfterDialogClose - falls back to topmost remaining dialog or main landmark when opener is disconnected", () => {
  const { document } = parseHTML(`
    <body>
      <main id="app-main">
        <button id="ephemeral-trigger">Open</button>
      </main>
      <div id="outer-dialog" role="dialog" aria-modal="true" tabindex="-1"></div>
      <div id="inner-dialog" role="dialog" aria-modal="true" tabindex="-1"></div>
    </body>
  `);

  const originalDocument = globalThis.document;
  (globalThis as unknown as { document: Document }).document =
    document as unknown as Document;

  const focusedIds: string[] = [];
  const attachFocusSpy = (el: HTMLElement) => {
    el.focus = () => {
      focusedIds.push(el.id);
    };
  };

  try {
    const main = document.getElementById("app-main") as unknown as HTMLElement;
    const trigger = document.getElementById(
      "ephemeral-trigger",
    ) as unknown as HTMLElement;
    const outer = document.getElementById(
      "outer-dialog",
    ) as unknown as HTMLElement;
    const inner = document.getElementById(
      "inner-dialog",
    ) as unknown as HTMLElement;

    attachFocusSpy(main);
    attachFocusSpy(trigger);
    attachFocusSpy(outer);

    // Simulate trigger removed from DOM while modal was open.
    trigger.remove();

    // Closing inner while outer remains open falls back to outer dialog.
    const target1 = restoreFocusAfterDialogClose(trigger, inner);
    strictEqual(target1, outer);
    deepStrictEqual(focusedIds, ["outer-dialog"]);

    // Removing inner and closing outer falls back to <main> landmark and sets tabIndex=-1.
    inner.remove();
    const target2 = restoreFocusAfterDialogClose(trigger, outer);
    strictEqual(target2, main);
    strictEqual(main.tabIndex, -1);
    deepStrictEqual(focusedIds, ["outer-dialog", "app-main"]);
  } finally {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});
