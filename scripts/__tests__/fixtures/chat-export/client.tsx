import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { useChatSharing } from "../../../../web/src/hooks/useChatSharing.ts";
import { useToast } from "../../../../web/src/store/toast.ts";
import { ChatExportModal } from "../../../../web/src/views/chat/ChatExportModal.tsx";
import { ToastRenderer } from "../../../../web/src/components/common/Toast.tsx";

const host = globalThis as unknown as {
  takosExportThread: string;
  takosExportFixture: {
    setThread: (id: string) => void;
    open: () => void;
    pending: () => Promise<void>;
    messages: () => Array<{ type: string; message: string }>;
    notify: (message: string) => void;
    clear: () => void;
    dispose: () => void;
  };
};
const [threadId, setThread] = createSignal(host.takosExportThread);
const store = useToast();
const clear = () => { for (const toast of store.toasts) store.dismissToast(toast.id); };
let open!: () => void;
let pending = Promise.resolve();
const dispose = render(() => {
  const sharing = useChatSharing(threadId);
  open = () => sharing.setShowExportModal(true);
  return <>
    <ChatExportModal
      isOpen={sharing.showExportModal()}
      onClose={() => sharing.setShowExportModal(false)}
      onExport={format => { pending = sharing.downloadExport(format); }}
    />
    <ToastRenderer />
  </>;
}, document.getElementById("root")!);

host.takosExportFixture = {
  setThread, open, pending: () => pending,
  messages: () => store.toasts.map(({ type, message }) => ({ type, message })),
  notify: message => { store.showToast("info", message); }, clear,
  dispose() { dispose(); clear(); },
};
