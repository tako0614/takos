import { ok as assert, strictEqual as assertEquals } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { en } from "../../i18n/en.ts";
import { ja } from "../../i18n/ja.ts";

const WEB_ROOT = new URL("../../../", import.meta.url);
const readWeb = (relPath: string) =>
  readFileSync(new URL(relPath, WEB_ROOT), "utf8");

test("web/index.html meta CSP aligns with fonts and omits meta-invalid frame-ancestors", () => {
  const html = readWeb("index.html");
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i,
  );
  assert(match, "Expected Content-Security-Policy meta tag");
  const csp = match[1];
  assert(
    csp.includes("https://fonts.googleapis.com"),
    "style-src must allow https://fonts.googleapis.com",
  );
  assert(
    csp.includes("font-src 'self' https://fonts.gstatic.com"),
    "font-src must allow https://fonts.gstatic.com",
  );
  assert(
    !csp.includes("frame-ancestors"),
    "frame-ancestors must be delivered by HTTP header, not <meta>",
  );
});

test("ChatPage desktop header receives live availableModels from modelSelection", () => {
  const source = readWeb("src/views/chat/ChatPage.tsx");
  assert(
    source.includes("models={modelSelection.availableModels()}"),
    "ChatPage must pass availableModels to desktop ChatHeader",
  );
});

test("ThreadList avoids nested interactive button inside role=button", () => {
  const source = readWeb("src/components/navigation/ThreadList.tsx");
  assert(
    !source.includes('role="button"'),
    "ThreadList should use sibling <button> controls rather than role=button wrappers",
  );
});

test("AgentModal uses dialog lifecycle and avoids top-level JSX icons", () => {
  const source = readWeb("src/views/AgentModal.tsx");
  assert(
    source.includes("useDialogLifecycle"),
    "AgentModal must wire useDialogLifecycle for Escape handling",
  );
  assert(
    !source.includes("icon: <Icons."),
    "AgentModal TAB_CONFIG must store icon component references, not module-level JSX",
  );
});

test("CookieConsentBanner and ModelSwitcher i18n keys exist in both en and ja", () => {
  const requiredKeys = [
    "cookiePreferencesLabel",
    "cookieConsentDescription",
    "cookieEssentialOnly",
    "cookieAllowPreferences",
    "selectModel",
  ] as const;

  for (const key of requiredKeys) {
    assert(en[key].length > 0, `Missing en translation for ${key}`);
    assert(ja[key].length > 0, `Missing ja translation for ${key}`);
    assertEquals(typeof en[key], "string");
    assertEquals(typeof ja[key], "string");
  }

  const bannerSource = readWeb("src/components/common/CookieConsentBanner.tsx");
  assert(
    bannerSource.includes("useI18n"),
    "CookieConsentBanner must localize copy via useI18n",
  );
});
