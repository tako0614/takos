import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Card, CardTitle } from "../../../../web/src/components/ui/Card.tsx";
import { Input } from "../../../../web/src/components/ui/Input.tsx";
import { ConfirmDialog } from "../../../../web/src/components/common/ConfirmDialog.tsx";
import { CreateMcpServerModal } from "../../../../web/src/views/hub/CreateMcpServerModal.tsx";
import { GitUrlInstallModal } from "../../../../web/src/views/source/GitUrlInstallModal.tsx";
import { CreateRepoModal } from "../../../../web/src/views/shared/repos/CreateRepoModal.tsx";
import { ChatExportModal } from "../../../../web/src/views/chat/ChatExportModal.tsx";
import { MemoryList } from "../../../../web/src/views/memory/MemoryList.tsx";
import { StorageContextMenu } from "../../../../web/src/views/storage/StorageContextMenu.tsx";
import type { Memory, StorageFile } from "../../../../web/src/types/index.ts";

const noop = () => {};

const sampleMemories: Memory[] = [
  {
    id: "m-1",
    space_id: "sp-1",
    content: "Keep contrast above WCAG AA",
    type: "semantic",
    category: "qa",
    importance: 0.8,
    access_count: 3,
    source: "user",
    created_at: "2026-11-28T00:00:00.000Z",
    updated_at: "2026-11-28T00:00:00.000Z",
  },
];

const sampleFile: StorageFile = {
  id: "f-1",
  space_id: "sp-1",
  name: "spec.md",
  path: "/spec.md",
  type: "file",
  size: 1024,
  parent_id: null,
  mime_type: "text/markdown",
  sha256: null,
  uploaded_by: null,
  created_at: "2026-11-28T00:00:00.000Z",
  updated_at: "2026-11-28T00:00:00.000Z",
};

const [showMcpModal, setShowMcpModal] = createSignal(false);
const [showGitModal, setShowGitModal] = createSignal(false);
const [gitInitial, setGitInitial] = createSignal<{
  url?: string;
  ref?: string;
  modulePath?: string;
}>({ url: "https://github.com/example/one.git", ref: "v1.0.0", modulePath: "." });
const [showRepoModal, setShowRepoModal] = createSignal(false);
const [showExportModal, setShowExportModal] = createSignal(false);
const [showConfirm, setShowConfirm] = createSignal(false);
const [showCtxMenu, setShowCtxMenu] = createSignal(false);

let repoCreateHandler: (
  name: string,
  description: string,
  visibility: "public" | "private",
) => Promise<void> = async () => {};
const exportedFormats: string[] = [];

const dispose = render(() => {
  return (
    <div>
      <section id="card-title-section">
        <Card>
          <CardTitle id="default-card-title" as="h2">Default</CardTitle>
          <CardTitle id="danger-card-title" as="h2" class="text-red-600 dark:text-red-400">
            Danger Zone
          </CardTitle>
        </Card>
      </section>

      <section id="input-section">
        <span id="input-hint">Hint</span>
        <Input id="merged-input" aria-describedby="input-hint" error="Invalid input" />
      </section>

      <section id="memory-section">
        <MemoryList
          memories={sampleMemories}
          reminders={[]}
          loading={false}
          error={null}
          showReminders={false}
          onShowRemindersChange={noop}
          onDeleteMemory={noop}
          onDeleteReminder={noop}
          getTypeIcon={() => "M"}
          getTypeLabel={(t) => t}
          getTriggerIcon={() => "T"}
          getPriorityClasses={() => ""}
        />
      </section>

      <section id="ctx-section">
        <button id="ctx-trigger" type="button">Trigger</button>
        <button id="ctx-outside" type="button">Outside</button>
        <Show when={showCtxMenu()}>
          <StorageContextMenu
            state={{ file: sampleFile, x: 20, y: 20 }}
            onClose={() => setShowCtxMenu(false)}
            onOpen={noop}
            onDownload={noop}
            onRename={noop}
            onDelete={noop}
          />
        </Show>
      </section>

      <Show when={showMcpModal()}>
        <CreateMcpServerModal
          onClose={() => setShowMcpModal(false)}
          onCreate={async () => {}}
        />
      </Show>

      <GitUrlInstallModal
        isOpen={showGitModal()}
        spaceId="sp-1"
        initialGitUrl={gitInitial().url}
        initialRef={gitInitial().ref}
        initialModulePath={gitInitial().modulePath}
        onClose={() => setShowGitModal(false)}
      />

      <Show when={showRepoModal()}>
        <CreateRepoModal
          onClose={() => setShowRepoModal(false)}
          onCreate={(name, description, visibility) =>
            repoCreateHandler(name, description, visibility)}
        />
      </Show>

      <ChatExportModal
        isOpen={showExportModal()}
        onClose={() => setShowExportModal(false)}
        onExport={(fmt) => exportedFormats.push(fmt)}
      />

      <ConfirmDialog
        isOpen={showConfirm()}
        title="Delete workspace"
        message="This cannot be undone."
        danger
        onConfirm={() => setShowConfirm(false)}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}, document.getElementById("root")!);

const host = globalThis as unknown as {
  uxWave5Fixture: {
    setShowMcpModal: (open: boolean) => void;
    setShowGitModal: (open: boolean) => void;
    setGitInitial: (v: { url?: string; ref?: string; modulePath?: string }) => void;
    setShowRepoModal: (open: boolean) => void;
    setRepoCreateHandler: (fn: typeof repoCreateHandler) => void;
    setShowExportModal: (open: boolean) => void;
    exportedFormats: string[];
    setShowConfirm: (open: boolean) => void;
    setShowCtxMenu: (open: boolean) => void;
    isCtxMenuOpen: () => boolean;
    dispose: () => void;
  };
};

host.uxWave5Fixture = {
  setShowMcpModal,
  setShowGitModal,
  setGitInitial,
  setShowRepoModal,
  setRepoCreateHandler: (fn) => {
    repoCreateHandler = fn;
  },
  setShowExportModal,
  exportedFormats,
  setShowConfirm,
  setShowCtxMenu,
  isCtxMenuOpen: showCtxMenu,
  dispose,
};
