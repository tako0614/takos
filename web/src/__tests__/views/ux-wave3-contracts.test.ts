import { ok as assert, strictEqual as assertEquals } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { en } from "../../i18n/en.ts";
import { ja } from "../../i18n/ja.ts";

const WEB_ROOT = new URL("../../../", import.meta.url);
const readWeb = (relPath: string) =>
  readFileSync(new URL(relPath, WEB_ROOT), "utf8");

test("every primary screen sets a per-screen document title", () => {
  const titledFiles = [
    "src/app-routes.tsx",
    "src/app-route-shared.tsx",
    "src/views/ChatView.tsx",
    "src/views/SetupPage.tsx",
    "src/views/app/space/WelcomeView.tsx",
    "src/views/legal/LegalPage.tsx",
    "src/views/share/SharedThreadPage.tsx",
  ];
  for (const file of titledFiles) {
    assert(
      readWeb(file).includes("useDocumentTitle("),
      `${file} must call useDocumentTitle`,
    );
  }

  const routes = readWeb("src/app-routes.tsx");
  for (
    const key of [
      "chat",
      "storageTitle",
      "apps",
      "connections",
      "spaceSettings",
      "settingsTitle",
      "memories",
      "install",
      "notFound",
    ]
  ) {
    assert(
      routes.includes(`useDocumentTitle(() => t("${key}"))`),
      `app-routes must title the ${key} screen`,
    );
  }
});

test("authenticated layout owns the single <main> landmark and a skip link", () => {
  const layout = readWeb("src/components/layout/AuthenticatedLayout.tsx");
  assert(layout.includes("<main"), "AuthenticatedLayout must render <main>");
  assert(
    layout.includes('t("skipToMainContent")'),
    "AuthenticatedLayout must render a skip-to-content link",
  );
  for (
    const file of ["src/views/chat/ChatPage.tsx", "src/views/app/SettingsView.tsx"]
  ) {
    assert(
      !readWeb(file).includes("<main"),
      `${file} renders inside AuthenticatedLayout and must not nest <main>`,
    );
  }
});

test("screens without a visible page heading still expose one <h1>", () => {
  assert(
    readWeb("src/views/storage/StoragePage.tsx").includes(
      '<h1 class="sr-only">{t("storageTitle")}</h1>',
    ),
  );
  assert(
    readWeb("src/views/ChatView.tsx").includes(
      '<h1 class="sr-only">{threadTitle()}</h1>',
    ),
  );
  assert(
    /<h1[^>]*>\s*\{t\("spaceSettings"\)\}/.test(
      readWeb("src/views/hub/SpaceSettingsSection.tsx"),
    ),
  );
  assert(
    readWeb("src/views/source/SourcePage.tsx").includes("headingLevel={2}"),
    "Install page embeds Apps with a second-level heading",
  );
});

test("Memory page header icon is explicitly sized so the title stays visible", () => {
  const memoryPage = readWeb("src/views/MemoryPage.tsx");
  assert(!memoryPage.includes('<Icons.HardDrive class="shrink-0" />'));
  assert(memoryPage.includes('<Icons.Database class="h-5 w-5 shrink-0"'));
});

test("storage breadcrumbs are a labelled navigation with aria-current", () => {
  const breadcrumbs = readWeb("src/views/storage/StorageBreadcrumbs.tsx");
  assert(breadcrumbs.includes("<nav"));
  assert(breadcrumbs.includes('aria-label={t("storageBreadcrumb")}'));
  assert(breadcrumbs.includes('aria-current={isLast() ? "page" : undefined}'));
});

test("dead-end space messages offer a recovery action", () => {
  const shared = readWeb("src/app-route-shared.tsx");
  assert(shared.includes("navigation.navigateToPreferredChat()"));
  assert(shared.includes("modal.setShowCreateSpace(true)"));
});

test("legal back link is labelled and touch-sized", () => {
  const legal = readWeb("src/views/legal/LegalPage.tsx");
  assert(legal.includes('aria-label={t("backToHome")}'));
  assert(legal.includes("min-h-[44px] min-w-[44px]"));
});

test("pre-hydration <html lang> parses the JSON-encoded stored language", () => {
  const indexHtml = readWeb("index.html");
  assert(indexHtml.includes("storedLang = JSON.parse(storedLang)"));
});

test("wave 3 i18n keys exist in both languages", () => {
  for (const key of ["skipToMainContent", "storageBreadcrumb"] as const) {
    assert(en[key], `en.${key} missing`);
    assert(ja[key], `ja.${key} missing`);
  }
  assertEquals(en.skipToMainContent, "Skip to main content");
});

test("reactive language getter is never destructured in settings or active workflows", () => {
  for (
    const file of [
      "src/views/app/SettingsLanguage.tsx",
      "src/views/chat/ChatPage.tsx",
      "src/hooks/useChatSession.ts",
      "src/views/agent/WorkTab.tsx",
    ]
  ) {
    assert(
      !/\{[^}]*\blang\b[^}]*\}\s*=\s*useI18n/.test(readWeb(file)),
      `${file} must read i18n.lang reactively instead of destructuring lang`,
    );
  }
  const settingsLang = readWeb("src/views/app/SettingsLanguage.tsx");
  assert(settingsLang.includes('aria-pressed={i18n.lang === "ja"}'));
  assert(settingsLang.includes('aria-pressed={i18n.lang === "en"}'));
});

test("StorageFileTable parent-folder row matches responsive columns instead of colSpan={4}", () => {
  const table = readWeb("src/views/storage/StorageFileTable.tsx");
  assert(
    !table.includes("colSpan={4}"),
    "colSpan={4} creates phantom columns on 375px mobile where size/modified columns are hidden",
  );
});

test("StorageNewDropdown exposes menu semantics, keyboard/focus management, and modal focus restore", () => {
  const dropdown = readWeb("src/views/storage/StorageNewDropdown.tsx");
  assert(dropdown.includes('aria-haspopup="menu"'));
  assert(dropdown.includes("aria-expanded={open()}"));
  assert(dropdown.includes('role="menu"'));
  assert(dropdown.includes('role="menuitem"'));
  assert(dropdown.includes("e.isComposing || e.keyCode === 229"));
  assert(dropdown.includes("focusDropdownMenuItem("));
  assert(dropdown.includes("onKeyDown={handleTriggerKeyDown}"));
  assert(dropdown.includes("onFocusOut={handleFocusOut}"));
  assert(dropdown.includes("activateDropdownMenuItem("));
});

test("MemoryList supports roving tab keyboard navigation, pressed filter states, and AA reminder badge contrast", () => {
  const list = readWeb("src/views/memory/MemoryList.tsx");
  assert(list.includes("moveTabFocus("));
  assert(list.includes("aria-pressed={activeFilter() === filter}"));
  assert(
    !list.includes("bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"),
    "Reminder dismissed badge must meet WCAG AA contrast",
  );
  assert(
    !list.includes(
      'class="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded"',
    ),
    "Reminder trigger value pill must meet WCAG AA contrast",
  );
});

test("CookieConsentBanner preserves Button size=sm 36px height on desktop", () => {
  const banner = readWeb("src/components/common/CookieConsentBanner.tsx");
  assert(!banner.includes("sm:min-h-0"));
  assert(banner.includes("min-h-[44px] flex-1 sm:min-h-[36px] sm:flex-none"));
});

test("SpaceSettings cards use h2/h3 headings beneath the page h1 without skipping levels", () => {
  const cards = readWeb("src/views/hub/SpaceSettingsCards.tsx");
  assert(cards.includes('<CardTitle as="h2">{t("spaceInfo")}</CardTitle>'));
  assert(cards.includes('<CardTitle as="h2" class="text-red-600 dark:text-red-400">'));
  assert(!cards.includes("<h4 "));
});

test("PrivacyContent wraps inline API code paths cleanly on narrow viewports", () => {
  const privacy = readWeb("src/views/legal/content/PrivacyContent.tsx");
  assert(privacy.includes('<code class="break-all">/api/me/privacy/access</code>'));
  assert(privacy.includes('<code class="break-all">/api/me/privacy/export</code>'));
  assert(
    privacy.includes(
      '<code class="break-all">/api/me/privacy/deletion-requests</code>',
    ),
  );
});

test("unauthenticated StoreRoute renders inside a <main> landmark", () => {
  const routes = readWeb("src/app-routes.tsx");
  assert(routes.includes('<main class="h-[100dvh]">'));
});

test("legal footer and chat input hint meet WCAG AA contrast", () => {
  const legal = readWeb("src/views/legal/LegalPage.tsx");
  assert(!legal.includes("text-zinc-400 dark:text-zinc-500"));
  assert(legal.includes("text-zinc-600 dark:text-zinc-400"));
  assert(legal.includes("flex-wrap"));

  const chatInput = readWeb("src/views/chat/ChatInputBar.tsx");
  assert(
    !chatInput.includes('<span class="text-xs text-zinc-500 dark:text-zinc-500">'),
    "ChatInputBar hint must not use low-contrast dark:text-zinc-500",
  );
  assert(chatInput.includes('<span class="text-xs text-zinc-500 dark:text-zinc-400">'));
});
