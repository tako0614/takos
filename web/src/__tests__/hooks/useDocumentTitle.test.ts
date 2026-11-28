import { strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import { parseHTML } from "linkedom";
import {
  APP_DOCUMENT_TITLE,
  formatDocumentTitle,
  pushDocumentTitle,
} from "../../hooks/useDocumentTitle.ts";

test("formatDocumentTitle - suffixes the product name and falls back to it", () => {
  strictEqual(formatDocumentTitle("Memory"), `Memory · ${APP_DOCUMENT_TITLE}`);
  strictEqual(formatDocumentTitle("  Storage  "), `Storage · ${APP_DOCUMENT_TITLE}`);
  strictEqual(formatDocumentTitle(""), APP_DOCUMENT_TITLE);
  strictEqual(formatDocumentTitle("   "), APP_DOCUMENT_TITLE);
  strictEqual(formatDocumentTitle(null), APP_DOCUMENT_TITLE);
  strictEqual(formatDocumentTitle(undefined), APP_DOCUMENT_TITLE);
});

test("pushDocumentTitle - newest surface wins and out-of-order releases restore the right title", () => {
  const { document } = parseHTML(
    "<html><head><title>Takos</title></head><body></body></html>",
  );
  const originalDocument = globalThis.document;
  (globalThis as unknown as { document: Document }).document =
    document as unknown as Document;

  try {
    const route = pushDocumentTitle("Chat");
    strictEqual(document.title, "Chat · Takos");

    const thread = pushDocumentTitle("Plan the launch");
    strictEqual(document.title, "Plan the launch · Takos");

    // A thread rename updates the visible title in place.
    thread.update("Launch plan v2");
    strictEqual(document.title, "Launch plan v2 · Takos");

    // Updating an entry that is not on top must not steal the title.
    route.update("チャット");
    strictEqual(document.title, "Launch plan v2 · Takos");

    // The next route can mount before the previous one is disposed.
    const nextRoute = pushDocumentTitle("Memory");
    thread.release();
    route.release();
    strictEqual(document.title, "Memory · Takos");

    // Releases are idempotent.
    route.release();
    strictEqual(document.title, "Memory · Takos");

    nextRoute.release();
    strictEqual(document.title, APP_DOCUMENT_TITLE);
  } finally {
    (globalThis as unknown as { document: Document }).document =
      originalDocument;
  }
});
