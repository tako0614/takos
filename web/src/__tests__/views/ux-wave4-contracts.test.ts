import { ok as assert, strictEqual as assertEquals } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { en } from "../../i18n/en.ts";
import { ja } from "../../i18n/ja.ts";
import {
  getPriorityClasses,
  getStatusClasses,
} from "../../views/agent/work/task-work-utils.ts";

const WEB_ROOT = new URL("../../../", import.meta.url);
const readWeb = (relPath: string) =>
  readFileSync(new URL(relPath, WEB_ROOT), "utf8");

test("wave 4 i18n keys exist in both English and Japanese", () => {
  for (
    const key of [
      "appearance",
      "themeSystem",
      "themeLight",
      "themeDark",
      "invalidPassword",
    ] as const
  ) {
    assert(en[key], `en.${key} missing`);
    assert(ja[key], `ja.${key} missing`);
  }
  assertEquals(en.appearance, "Appearance");
  assertEquals(en.themeSystem, "System");
});

test("SettingsView exposes an appearance/theme switcher wired to themePreference", () => {
  const settingsView = readWeb("src/views/app/SettingsView.tsx");
  assert(settingsView.includes("<SettingsAppearance />"));

  const appearance = readWeb("src/views/app/SettingsAppearance.tsx");
  assert(appearance.includes("useTheme()"));
  assert(appearance.includes("theme.themePreference"));
  assert(appearance.includes("theme.setThemePreference("));
  assert(appearance.includes('aria-pressed={theme.themePreference === option.value}'));
});

test("light-mode semantic foreground tokens meet WCAG AA contrast on tinted Badge surfaces", () => {
  const css = readWeb("src/styles.css");
  assert(css.includes("--color-error: #b91c1c;"));
  assert(css.includes("--color-warning: #b45309;"));
  assert(css.includes("--color-success: #15803d;"));
  assert(css.includes("--color-info: #1d4ed8;"));
});

test("shared UI controls support 44px mobile touch targets, Select labelling/IME safety, Textarea alerts, and persistent Toast live region", () => {
  const button = readWeb("src/components/ui/Button.tsx");
  assert(button.includes("min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-0"));

  const errorBoundary = readWeb("src/components/ui/ErrorBoundary.tsx");
  assert(errorBoundary.includes('role="alert"'));
  assert(errorBoundary.includes("<h1 "));
  assert(errorBoundary.includes("min-h-[44px] sm:min-h-0"));

  const select = readWeb("src/components/ui/Select.tsx");
  assert(select.includes("id?: string;"));
  assert(select.includes('"aria-labelledby"?: string;'));
  assert(select.includes("e.isComposing || e.keyCode === 229"));
  assert(select.includes('"min-height": "44px"'));

  const textarea = readWeb("src/components/ui/Textarea.tsx");
  assert(textarea.includes("createUniqueId()"));
  assert(textarea.includes('aria-invalid={local.error ? "true" : local["aria-invalid"]}'));
  assert(textarea.includes('role="alert"'));

  const toast = readWeb("src/components/common/Toast.tsx");
  assert(toast.includes('aria-live="polite"'));
  assert(toast.includes('aria-live="assertive"'));
  assert(toast.includes("min-w-[44px] min-h-[44px]"));

  const registrySources = readWeb("src/views/connections/RegistrySourcesPanel.tsx");
  assert(
    !/<summary[^>]*\bflex\b/.test(registrySources),
    "RegistrySourcesPanel <summary> must keep display: list-item so native disclosure marker stays visible",
  );
});

test("MarkdownRenderer demotes headings to avoid duplicate <h1> and gives table headers scope=col", () => {
  const md = readWeb("src/views/chat/MarkdownRenderer.tsx");
  assert(md.includes("Math.min(block.level + 1, 6)"));
  assert(md.includes('scope="col"'));
  assert(!md.includes("component={`h${block.level}`}"));
});

test("SharedThreadPage surfaces wrong-password feedback on 401 and localizes share mode and dates", () => {
  const share = readWeb("src/views/share/SharedThreadPage.tsx");
  assert(share.includes('t("invalidPassword")'));
  assert(share.includes('t("sharePasswordLabel")'));
  assert(share.includes('t("sharePublic")'));
  assert(share.includes("i18n.lang"));
  assert(
    !/\{[^}]*\blang\b[^}]*\}\s*=\s*useI18n/.test(share),
    "SharedThreadPage must read i18n.lang reactively",
  );
});

test("AgentModal tabs support arrow navigation and task priority/status badges include dark-mode contrast classes", () => {
  const modal = readWeb("src/views/AgentModal.tsx");
  assert(modal.includes("moveTabFocus("));
  assert(modal.includes("data-tab-id={tab.id}"));
  assert(modal.includes('tabIndex={activeTab() === tab.id ? 0 : -1}'));

  for (const status of ["planned", "in_progress", "blocked", "completed", "cancelled", "failed"] as const) {
    const cls = getStatusClasses(status);
    assert(cls.includes("dark:text-"), `status ${status} must specify dark text class`);
    assert(cls.includes("dark:bg-"), `status ${status} must specify dark bg class`);
  }
  for (const priority of ["low", "medium", "high", "urgent"] as const) {
    const cls = getPriorityClasses(priority);
    assert(cls.includes("dark:text-"), `priority ${priority} must specify dark text class`);
  }
});

test("AgentModal forms associate labels, preserve drafts on create failure, and avoid opacity-killed skill cards", () => {
  const taskForm = readWeb("src/views/agent/work/TaskForm.tsx");
  assert(taskForm.includes("createUniqueId()"));
  assert(taskForm.includes('role="alert"'));

  const skillForm = readWeb("src/views/agent/SkillForm.tsx");
  assert(skillForm.includes("createUniqueId()"));
  assert(skillForm.includes('aria-label={t("goBack")}'));
  assert(skillForm.includes('role="alert"'));

  const skillList = readWeb("src/views/agent/SkillList.tsx");
  assert(!skillList.includes("opacity: skill.enabled ? 1 : 0.5"));
  assert(skillList.includes("aria-pressed={skill.enabled}"));

  const memoryData = readWeb("src/hooks/useMemoryData.ts");
  assert(memoryData.includes("createMemory: (data: CreateMemoryData) => Promise<boolean>"));
  assert(memoryData.includes("createReminder: (data: CreateReminderData) => Promise<boolean>"));

  const agentMemory = readWeb("src/views/agent/MemoryList.tsx");
  assert(agentMemory.includes("if (!created) return;"));
  assert(agentMemory.includes('aria-label={t("memorySearch")}'));

  const agentReminder = readWeb("src/views/agent/ReminderList.tsx");
  assert(agentReminder.includes("if (!created) return;"));
});

test("Sidebar marks active items with aria-current and ProfileMenu supports full ARIA menu keyboard nav", () => {
  const sidebar = readWeb("src/components/navigation/UnifiedSidebar.tsx");
  assert(sidebar.includes('aria-current={isNewChatActive() ? "page" : undefined}'));
  assert(sidebar.includes('aria-current={isMemoryActive() ? "page" : undefined}'));
  assert(sidebar.includes('aria-current={isConnectionsActive() ? "page" : undefined}'));
  assert(sidebar.includes('<img src="/logo.png" alt=""'));

  const profile = readWeb("src/components/navigation/ProfileMenu.tsx");
  assert(profile.includes("handleMenuTriggerKeyDown("));
  assert(profile.includes("handleDropdownMenuKeyDown("));
  assert(profile.includes("shouldCloseOnFocusOut("));
  assert(!profile.includes('"\'s avatar"'));
});

test("StorageTextEditor syncs Monaco theme with app theme, guards Cmd+S for IME, and StoragePage keeps its <h1> mounted while viewing files", () => {
  const editor = readWeb("src/views/storage/StorageTextEditor.tsx");
  assert(editor.includes("useTheme()"));
  assert(editor.includes('theme.resolvedTheme === "dark" ? "vs-dark" : "vs"'));
  assert(!editor.includes("prefers-color-scheme: dark"));
  assert(editor.includes("e.isComposing || e.keyCode === 229"));
  assert(editor.includes('role="alert"'));

  const page = readWeb("src/views/storage/StoragePage.tsx");
  assert(
    page.indexOf('<h1 class="sr-only">{t("storageTitle")}</h1>') <
      page.indexOf("when={!actions.viewingFile()}"),
    "StoragePage must keep its <h1> mounted above the file viewer fallback",
  );

  const shell = readWeb("src/views/storage/StorageViewerShell.tsx");
  assert(shell.includes('aria-haspopup="menu"'));

  const picker = readWeb("src/views/storage/StorageHandlerPicker.tsx");
  assert(picker.includes('aria-label={props.t("back")}'));
  assert(picker.includes('role="menu"'));
  assert(picker.includes('role="menuitem"'));

  const bulk = readWeb("src/views/storage/StorageBulkActions.tsx");
  assert(!bulk.includes("dark:text-red-500"));
});
