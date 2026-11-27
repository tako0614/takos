import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import { parseHTML } from "linkedom";
import {
  getFocusableElements,
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
