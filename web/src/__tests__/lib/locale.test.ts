import { strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import { parseStoredLanguage } from "../../lib/locale.ts";

test("parseStoredLanguage - reads the JSON encoding written by the persisted language signal", () => {
  strictEqual(parseStoredLanguage(JSON.stringify("en")), "en");
  strictEqual(parseStoredLanguage(JSON.stringify("ja")), "ja");
});

test("parseStoredLanguage - keeps accepting the legacy bare value", () => {
  strictEqual(parseStoredLanguage("en"), "en");
  strictEqual(parseStoredLanguage("ja"), "ja");
});

test("parseStoredLanguage - rejects missing or unsupported values", () => {
  strictEqual(parseStoredLanguage(null), null);
  strictEqual(parseStoredLanguage(undefined), null);
  strictEqual(parseStoredLanguage(""), null);
  strictEqual(parseStoredLanguage(JSON.stringify("fr")), null);
  strictEqual(parseStoredLanguage("{not json"), null);
});
