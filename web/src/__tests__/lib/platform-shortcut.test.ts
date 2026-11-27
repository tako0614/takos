import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "bun:test";
import {
  formatSearchShortcut,
  getSearchShortcutParts,
  isApplePlatform,
} from "../../lib/platform-shortcut.ts";

test("platform-shortcut - detects Apple platforms via userAgentData, platform, and userAgent", () => {
  strictEqual(isApplePlatform({ userAgentData: { platform: "macOS" } }), true);
  strictEqual(isApplePlatform({ platform: "MacIntel" }), true);
  strictEqual(isApplePlatform({ platform: "iPhone" }), true);
  strictEqual(
    isApplePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" }),
    true,
  );
  deepStrictEqual(getSearchShortcutParts({ platform: "MacIntel" }), ["⌘", "K"]);
  strictEqual(formatSearchShortcut({ platform: "MacIntel" }), "⌘K");
});

test("platform-shortcut - falls back to Ctrl+K on Linux, Windows, and missing navigator", () => {
  strictEqual(isApplePlatform({ userAgentData: { platform: "Linux" } }), false);
  strictEqual(isApplePlatform({ platform: "Win32" }), false);
  strictEqual(isApplePlatform({ platform: "Linux x86_64" }), false);
  strictEqual(isApplePlatform(undefined), false);
  deepStrictEqual(getSearchShortcutParts({ platform: "Linux x86_64" }), [
    "Ctrl",
    "K",
  ]);
  strictEqual(formatSearchShortcut({ platform: "Win32" }), "Ctrl+K");
});
