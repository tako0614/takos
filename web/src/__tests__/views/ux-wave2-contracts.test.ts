import { ok as assert, strictEqual as assertEquals } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { en } from "../../i18n/en.ts";
import { ja } from "../../i18n/ja.ts";

const WEB_ROOT = new URL("../../../", import.meta.url);
const readWeb = (relPath: string) =>
  readFileSync(new URL(relPath, WEB_ROOT), "utf8");

test("all primary and secondary dialogs wire shared useFocusTrap", () => {
  const dialogFiles = [
    "src/components/ui/Modal.tsx",
    "src/components/layout/MobileDrawer.tsx",
    "src/views/AgentModal.tsx",
    "src/views/memory/MemoryForm.tsx",
    "src/views/shared/spaces/CreateSpaceModal.tsx",
    "src/views/shared/repos/CreateRepoModal.tsx",
  ];
  for (const file of dialogFiles) {
    const source = readWeb(file);
    assert(
      source.includes("useFocusTrap("),
      `${file} must wire shared useFocusTrap`,
    );
  }
});

test("ChatSearchModal wires combobox/listbox keyboard navigation and ChatView avoids hardcoded macOS shortcut", () => {
  const searchSource = readWeb("src/views/chat/ChatSearchModal.tsx");
  assert(
    searchSource.includes('role="combobox"'),
    "ChatSearchModal input must declare role=combobox",
  );
  assert(
    searchSource.includes('role="listbox"'),
    "ChatSearchModal results must declare role=listbox",
  );
  assert(
    searchSource.includes('role="option"'),
    "ChatSearchModal items must declare role=option",
  );
  assert(
    searchSource.includes("aria-activedescendant"),
    "ChatSearchModal input must wire aria-activedescendant",
  );
  assert(
    searchSource.includes("event.isComposing"),
    "ChatSearchModal keyboard navigation must guard IME composition",
  );

  const chatViewSource = readWeb("src/views/ChatView.tsx");
  assert(
    chatViewSource.includes("getSearchShortcutParts"),
    "ChatView must derive search shortcut dynamically by platform",
  );
  assert(
    !chatViewSource.includes("<span>⌘</span>"),
    "ChatView must not hardcode macOS ⌘ badge",
  );
  assert(
    !chatViewSource.includes("const headerActions = createMemo"),
    "ChatView must not memoize shared headerActions DOM nodes across desktop and mobile headers",
  );
});

test("StorageFileTable enforces fixed layout, accessible controls, and >=40px mobile touch targets", () => {
  const tableSource = readWeb("src/views/storage/StorageFileTable.tsx");
  assert(
    tableSource.includes("table-fixed"),
    "StorageFileTable must use table-fixed to prevent 375px horizontal overflow",
  );
  assert(
    !tableSource.includes("max-w-md"),
    "StorageFileTable filename button must not hardcode max-w-md wider than 375px",
  );
  assert(
    tableSource.includes("min-w-[40px] min-h-[40px]"),
    "StorageFileTable row actions and selection targets must meet >=40px touch target",
  );

  for (const key of ["selectAllItems", "selectItem", "parentFolder"] as const) {
    assertEquals(typeof en[key], "string");
    assertEquals(typeof ja[key], "string");
    assert(en[key].length > 0, `Missing en translation for ${key}`);
    assert(ja[key].length > 0, `Missing ja translation for ${key}`);
  }
});

test("LoginPage preserves reactive language getter instead of destructuring lang", () => {
  const authViewsSource = readWeb("src/views/app/AuthViews.tsx");
  assert(
    !authViewsSource.includes("const { t, lang"),
    "LoginPage must not destructure reactive lang getter from useI18n()",
  );
});
