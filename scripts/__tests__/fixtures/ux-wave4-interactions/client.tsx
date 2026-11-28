import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Modal } from "../../../../web/src/components/ui/Modal.tsx";
import { Select } from "../../../../web/src/components/ui/Select.tsx";
import { Textarea } from "../../../../web/src/components/ui/Textarea.tsx";
import { ToastContainer } from "../../../../web/src/components/common/Toast.tsx";
import { ProfileMenu } from "../../../../web/src/components/navigation/ProfileMenu.tsx";
import {
  SidebarContext,
  type SidebarCallbacks,
} from "../../../../web/src/components/navigation/SidebarContext.tsx";
import { StorageViewerShell } from "../../../../web/src/views/storage/StorageViewerShell.tsx";
import type { ResolvedHandler } from "../../../../web/src/views/storage/storageUtils.tsx";
import type { StorageFile, Toast, User } from "../../../../web/src/types/index.ts";
import { useI18n } from "../../../../web/src/store/i18n.ts";

const noop = () => {};
const sidebarCallbacks: SidebarCallbacks = {
  onNewChat: noop,
  onNavigateStorage: noop,
  onNavigateApps: noop,
  onNavigateConnections: noop,
  onNavigateMemory: noop,
  onNavigateStore: noop,
  onOpenSearch: noop,
  onCreateSpace: noop,
  onEnterSpace: noop,
  onExitSpace: noop,
  onNavigateSpaceChat: noop,
  onNavigateSpaceStorage: noop,
  onNavigateSpaceApps: noop,
  onNavigateSpaceConnections: noop,
  onNavigateSpaceSettings: noop,
  onOpenSpaceSettings: noop,
  onSelectThread: noop,
  onDeleteThread: noop,
  onToggleArchiveThread: noop,
  onOpenAgentModal: noop,
  onOpenSettings: noop,
  onLogout: noop,
};

const sampleFile: StorageFile = {
  id: "file-1",
  space_id: "space-1",
  name: "README.md",
  path: "/README.md",
  type: "file",
  size: 120,
  parent_id: null,
  mime_type: "text/markdown",
  sha256: null,
  uploaded_by: null,
  created_at: "2026-11-28T00:00:00Z",
  updated_at: "2026-11-28T00:00:00Z",
};

const handlers: ResolvedHandler[] = [
  { type: "local", localId: "text-editor" },
  {
    type: "app",
    handler: {
      id: "ext-1",
      name: "Docs Editor",
      open_url: "https://docs.example.test/files/:id",
      mime_types: ["text/markdown"],
      extensions: [".md"],
    },
  },
];

const sampleUser: User = {
  id: "u-1",
  username: "alice",
  name: "Alice",
  email: "alice@example.test",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-11-28T00:00:00Z",
  updated_at: "2026-11-28T00:00:00Z",
};

const host = globalThis as unknown as {
  uxWave4Fixture: {
    selectedEvents: Array<{ kind: string; asDefault: boolean }>;
    setModalOpen: (open: boolean) => void;
    isModalOpen: () => boolean;
    setToasts: (toasts: Toast[]) => void;
    dispose: () => void;
  };
};

const [showHandlerMenu, setShowHandlerMenu] = createSignal(false);
const [modalOpen, setModalOpen] = createSignal(false);
const [selectValue, setSelectValue] = createSignal("semantic");
const [toasts, setToasts] = createSignal<Toast[]>([]);
const selectedEvents: Array<{ kind: string; asDefault: boolean }> = [];

const dispose = render(() => {
  const { t } = useI18n();
  return (
    <div>
      <section id="viewer-section">
        <StorageViewerShell
          file={sampleFile}
          downloadUrl={null}
          allHandlers={handlers}
          activeHandler={handlers[0]}
          showHandlerMenu={showHandlerMenu()}
          setShowHandlerMenu={setShowHandlerMenu}
          onSelectHandler={(h, asDefault) => {
            selectedEvents.push({
              kind: h.type === "local" ? h.localId : h.handler.id,
              asDefault,
            });
            setShowHandlerMenu(false);
          }}
          onClearDefault={() => {
            setShowHandlerMenu(false);
          }}
          onClose={noop}
          t={t}
        >
          <div>Editor Body</div>
        </StorageViewerShell>
      </section>

      <section id="profile-section">
        <SidebarContext.Provider value={sidebarCallbacks}>
          <ProfileMenu user={sampleUser} />
        </SidebarContext.Provider>
      </section>

      <section id="textarea-section">
        <span id="custom-hint">Helpful description</span>
        <Textarea
          id="merged-textarea"
          aria-describedby="custom-hint"
          error="Field is required"
        />
      </section>

      <Modal
        isOpen={modalOpen()}
        onClose={() => setModalOpen(false)}
        title="Test Modal"
      >
        <Select
          id="modal-select"
          value={selectValue()}
          onChange={setSelectValue}
          options={[
            { value: "semantic", label: "Semantic" },
            { value: "episode", label: "Episode" },
          ]}
        />
      </Modal>

      <ToastContainer toasts={toasts()} onDismiss={noop} />
    </div>
  );
}, document.getElementById("root")!);

host.uxWave4Fixture = {
  selectedEvents,
  setModalOpen,
  isModalOpen: modalOpen,
  setToasts,
  dispose,
};
