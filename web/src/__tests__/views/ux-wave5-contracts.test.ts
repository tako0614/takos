import { ok as assert, strictEqual as assertEquals } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { en } from "../../i18n/en.ts";
import { ja } from "../../i18n/ja.ts";
import {
  formatImportanceRating,
  formatImportanceStars,
  formatLocalizedDateTime,
} from "../../lib/memory-format.ts";

const WEB_ROOT = new URL("../../../", import.meta.url);
const readWeb = (relPath: string) =>
  readFileSync(new URL(relPath, WEB_ROOT), "utf8");

test("wave 5 i18n keys and memory-format helpers work across EN and JA", () => {
  assertEquals(en.signIn, "Sign in");
  assertEquals(ja.signIn, "ログイン");

  assertEquals(formatImportanceRating(0.8), 4);
  assertEquals(formatImportanceRating(1.5), 5);
  assertEquals(formatImportanceRating(-1), 0);
  assertEquals(formatImportanceRating(Number.NaN), 0);
  assertEquals(formatImportanceStars(0.6), "\u2605\u2605\u2605\u2606\u2606");

  const enDt = formatLocalizedDateTime("2026-12-15T12:00:00.000Z", "en");
  const jaDt = formatLocalizedDateTime("2026-12-15T12:00:00.000Z", "ja");
  assert(enDt.length > 0 && !enDt.includes("T12:00:00.000Z"));
  assert(jaDt.length > 0 && !jaDt.includes("T12:00:00.000Z"));
  assertEquals(formatLocalizedDateTime("not-a-date", "en"), "not-a-date");
});

test("dark-mode danger button uses dedicated WCAG AA tokens and ChatSearchModal fixes mark and active title contrast", () => {
  const css = readWeb("src/styles.css");
  assert(css.includes("--color-danger-bg: #b91c1c;"));
  assert(css.includes("--color-danger-bg: #dc2626;"));

  const button = readWeb("src/components/ui/Button.tsx");
  assert(button.includes("bg-[var(--color-danger-bg)]"));
  assert(!button.includes("bg-[var(--color-error)] text-white"));

  const search = readWeb("src/views/chat/ChatSearchModal.tsx");
  assert(search.includes("text-zinc-900 dark:bg-yellow-500/35 dark:text-yellow-100"));
  assert(search.includes("min-w-[44px] min-h-[44px]"));
  assert(!search.includes('class="w-7 h-7'));
});

test("dialogs use h2 titles without heading skips and avoid orphan labels or alerts inside labels", () => {
  const confirmDialog = readWeb("src/components/common/ConfirmDialog.tsx");
  assert(confirmDialog.includes("<h2 id={titleId}"));
  assert(!confirmDialog.includes("<h3 id={titleId}"));

  const memoryForm = readWeb("src/views/memory/MemoryForm.tsx");
  assert(!memoryForm.includes("<h3"));
  assert(memoryForm.includes("<h2"));

  const createSpace = readWeb("src/views/shared/spaces/CreateSpaceModal.tsx");
  assert(!createSpace.includes("<h3"));
  assert(createSpace.includes("<h2"));

  const spaceSettings = readWeb("src/views/hub/SpaceSettingsCards.tsx");
  assert(!spaceSettings.includes('<label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">\n              {tOr("spaceSlug"'));
  assert(spaceSettings.includes("spaceSlugLabelId"));
  assert(spaceSettings.includes('role="group"'));
  assert(!spaceSettings.includes("<code\n                aria-labelledby="));
  assert(spaceSettings.includes("text-zinc-600 dark:text-zinc-300"));

  const card = readWeb("src/components/ui/Card.tsx");
  assert(card.includes("hasExplicitColorClass"));

  const mcpModal = readWeb("src/views/hub/CreateMcpServerModal.tsx");
  assert(mcpModal.includes("for={nameId}"));
  assert(mcpModal.includes("for={urlId}"));
  assert(mcpModal.includes("for={scopeId}"));
  assert(mcpModal.includes("min-h-[44px] sm:min-h-[36px]"));

  const connections = readWeb("src/views/connections/ConnectionsPage.tsx");
  assert(connections.includes("for={connectionNameId}"));
  assert(connections.includes("id={connectionNameId}"));
});

test("secondary install, create-repo, export, and share modals wire label associations, async feedback, and localized dates", () => {
  const gitInstall = readWeb("src/views/source/GitUrlInstallModal.tsx");
  assert(gitInstall.includes("for={gitUrlId}"));
  assert(gitInstall.includes("for={refId}"));
  assert(gitInstall.includes("for={modulePathId}"));
  assert(gitInstall.includes("for={approveId}"));
  assert(gitInstall.includes("min-h-[44px] cursor-pointer"));
  assert(gitInstall.includes("createEffect("));

  const createRepo = readWeb("src/views/shared/repos/CreateRepoModal.tsx");
  assert(createRepo.includes("text-zinc-600 dark:text-zinc-300"));
  assert(createRepo.includes("aria-busy={submitting() ? \"true\" : undefined}"));
  assert(createRepo.includes("aria-describedby={error() ? errorId : undefined}"));
  assert(createRepo.includes("if (error()) setError(null)"));
  assert(createRepo.includes('<Icons.X class="w-5 h-5" aria-hidden="true" />'));
  assert(createRepo.includes('role="alert"'));

  const sourcePage = readWeb("src/views/source/SourcePage.tsx");
  assert(sourcePage.includes('t("selectSpaceFirst")'));

  const exportModal = readWeb("src/views/chat/ChatExportModal.tsx");
  assert(exportModal.includes("autofocus"));

  const focusTrap = readWeb("src/hooks/useFocusTrap.ts");
  assert(focusTrap.includes(".autofocus === true"));

  const shareModal = readWeb("src/views/chat/ChatShareModal.tsx");
  assert(shareModal.includes("formatLocalizedDateTime("));
  assert(shareModal.includes("i18n.lang"));
});

test("composers, shared inputs, and forms provide visible focus indicators and >=44px mobile touch targets", () => {
  const welcome = readWeb("src/views/app/space/WelcomeView.tsx");
  assert(welcome.includes("focus-within:ring-2"));
  assert(welcome.includes("min-w-[44px] min-h-[44px] sm:min-w-7 sm:min-h-7"));

  const chatInput = readWeb("src/views/chat/ChatInputBar.tsx");
  assert(chatInput.includes("focus-within:ring-2"));

  const input = readWeb("src/components/ui/Input.tsx");
  assert(input.includes("focus:ring-2"));
  assert(input.includes("min-w-[44px] min-h-[44px]"));

  const textarea = readWeb("src/components/ui/Textarea.tsx");
  assert(textarea.includes("focus:ring-2"));

  const taskForm = readWeb("src/views/agent/work/TaskForm.tsx");
  assert(taskForm.includes("text-base sm:text-sm"));
  assert(taskForm.includes("focus:ring-2"));

  const authViews = readWeb("src/views/app/AuthViews.tsx");
  assert(authViews.includes('useDocumentTitle(() => t("signIn"))'));
  assert(authViews.includes('alt=""'));
  assert(authViews.includes("min-h-[44px] min-w-[44px]"));

  const setup = readWeb("src/views/SetupPage.tsx");
  assert(setup.includes('aria-busy={submitting() ? "true" : undefined}'));
  assert(!setup.includes("disabled:bg-zinc-300"));

  const apps = readWeb("src/views/apps/AppsPage.tsx");
  assert(apps.includes("inline-flex min-h-[44px] sm:min-h-0 max-w-full"));

  const candidate = readWeb("src/views/connections/RegistryCandidateCard.tsx");
  assert(candidate.includes("inline-flex min-h-[44px] sm:min-h-0"));

  const confirmCenter = readWeb("src/components/layout/McpToolConfirmationCenter.tsx");
  assert(confirmCenter.includes('role="alert"'));
  assert(confirmCenter.includes("top-14 md:top-4"));
  assert(confirmCenter.includes("min-h-[44px] sm:min-h-0"));

  const modelSwitcher = readWeb("src/views/chat/ModelSwitcher.tsx");
  assert(modelSwitcher.includes("max-w-full min-w-0 truncate"));
});

test("Storage, Memory, SkillList, and ChatMessageFeed fix contrast, filter recovery, semantics, and keyboard dismissal", () => {
  const storagePage = readWeb("src/views/storage/StoragePage.tsx");
  assert(storagePage.includes('role="status"'));
  assert(storagePage.includes('<p class="text-sm text-zinc-600 dark:text-zinc-400">'));
  assert(!storagePage.includes('<p class="text-sm text-zinc-400 dark:text-zinc-500">'));

  const storageToolbar = readWeb("src/views/storage/StorageToolbar.tsx");
  assert(!storageToolbar.includes('class="text-xs text-zinc-400'));

  const storageTable = readWeb("src/views/storage/StorageFileTable.tsx");
  assert(storageTable.includes('scope="col"'));
  assert(!storageTable.includes("min-h-[40px]"));

  const storageMenu = readWeb("src/views/storage/StorageContextMenu.tsx");
  assert(storageMenu.includes('e.key === "Tab"'));
  assert(storageMenu.includes("onFocusOut={handleFocusOut}"));

  const memoryPage = readWeb("src/views/MemoryPage.tsx");
  assert(!memoryPage.includes("border-l-danger"));
  assert(!memoryPage.includes("border-l-accent"));

  const memoryList = readWeb("src/views/memory/MemoryList.tsx");
  assert(memoryList.includes("min-h-[44px] pl-10"));
  assert(memoryList.includes('t("clearFilters")'));
  assert(memoryList.includes('t("noResults")'));
  assert(memoryList.includes('role="img"'));
  assert(memoryList.includes('aria-label={`${t("memoryImportance")}:'));

  const agentMemoryList = readWeb("src/views/agent/MemoryList.tsx");
  assert(agentMemoryList.includes('t("clearFilters")'));
  assert(agentMemoryList.includes('role="img"'));
  assert(agentMemoryList.includes('aria-label={`${t("memoryImportance")}:'));

  const skillList = readWeb("src/views/agent/SkillList.tsx");
  assert(skillList.includes("{props.skills.length > 0 && ("));

  const feed = readWeb("src/views/chat/ChatMessageFeed.tsx");
  assert(feed.includes("when={props.entries.length > 0}"));
  assert(feed.includes('role={props.live ? "status" : undefined}'));
  assert(feed.includes('aria-live={props.live ? "polite" : undefined}'));

  const createFolder = readWeb("src/views/storage/CreateFolderModal.tsx");
  assert(createFolder.includes("isLoading={creating()}"));

  const renameModal = readWeb("src/views/storage/RenameModal.tsx");
  assert(renameModal.includes("isLoading={props.renaming}"));
});
