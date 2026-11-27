import { strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import { parseHTML } from "linkedom";
import { acquireBodyScrollLock } from "../../hooks/useDialogLifecycle.ts";

test("acquireBodyScrollLock - ref-counts stacked locks cleanly across out-of-order and duplicate releases", () => {
  const { document } = parseHTML("<body></body>");
  const originalDocument = globalThis.document;
  (globalThis as unknown as { document: Document }).document =
    document as unknown as Document;

  try {
    document.body.style.overflow = "auto";

    const releaseOuter = acquireBodyScrollLock();
    strictEqual(document.body.style.overflow, "hidden");

    const releaseInner = acquireBodyScrollLock();
    strictEqual(document.body.style.overflow, "hidden");

    // Out-of-order: outer closes before inner; body scroll must remain locked.
    releaseOuter();
    strictEqual(document.body.style.overflow, "hidden");

    // Idempotency: releasing outer a second time must not decrement count again.
    releaseOuter();
    strictEqual(document.body.style.overflow, "hidden");

    // Final release restores original overflow value.
    releaseInner();
    strictEqual(document.body.style.overflow, "auto");
  } finally {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});
