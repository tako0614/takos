import { expect, test } from "bun:test";
import { MONACO_STORAGE_LANGUAGE_IDS } from "../../../monaco-language-contract.ts";
import {
  detectLanguage,
  STORAGE_EDITOR_LANGUAGE_BY_EXTENSION,
} from "../../lib/languageMap.ts";

test("every Storage editor language has a Monaco registration", () => {
  const detectedLanguages = new Set([
    ...Object.values(STORAGE_EDITOR_LANGUAGE_BY_EXTENSION),
    detectLanguage("Dockerfile"),
    detectLanguage("Makefile"),
    detectLanguage("README"),
  ]);

  for (const language of detectedLanguages) {
    expect(MONACO_STORAGE_LANGUAGE_IDS.has(language)).toBe(true);
  }
});

test("Storage language detection keeps custom diff and case-insensitive extensions", () => {
  expect(detectLanguage("changes.diff")).toBe("diff");
  expect(detectLanguage("changes.PATCH")).toBe("diff");
  expect(detectLanguage("main.CPP")).toBe("cpp");
  expect(detectLanguage("main.C")).toBe("c");
  expect(detectLanguage("README")).toBe("plaintext");
});
