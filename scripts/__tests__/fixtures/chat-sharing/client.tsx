import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { useChatSharing, type UseChatSharingReturn } from "../../../../web/src/hooks/useChatSharing.ts";
import { ChatShareModal } from "../../../../web/src/views/chat/ChatShareModal.tsx";
import { useToast } from "../../../../web/src/store/toast.ts";

const host = globalThis as unknown as {
  takosInitialThread: string;
  takosSharingFixture: {
    sharing: UseChatSharingReturn;
    setThread: (id: string) => void;
    dispose: () => void;
    toastCount: () => number;
    toastMessages: () => Array<{ type: string; message: string }>;
    clearToasts: () => void;
  };
};
const [threadId, setThread] = createSignal(host.takosInitialThread);
let sharing!: UseChatSharingReturn;
const dispose = render(() => {
  sharing = useChatSharing(threadId);
  return <ChatShareModal
    isOpen={sharing.showShareModal()}
    onClose={() => sharing.setShowShareModal(false)}
    sharesLoading={sharing.sharesLoading()}
    shares={sharing.shares()}
    shareMode={sharing.shareMode()}
    onShareModeChange={sharing.setShareMode}
    sharePassword={sharing.sharePassword()}
    onSharePasswordChange={sharing.setSharePassword}
    shareExpiresInDays={sharing.shareExpiresInDays()}
    onShareExpiresInDaysChange={sharing.setShareExpiresInDays}
    shareError={sharing.shareError()}
    creatingShare={sharing.creatingShare()}
    onFetchShares={sharing.fetchShares}
    onCreateShare={sharing.createShare}
    onRevokeShare={sharing.revokeShare}
  />;
}, document.getElementById("root")!);

const store = useToast();
const clearToasts = () => {
  for (const toast of store.toasts) store.dismissToast(toast.id);
};
host.takosSharingFixture = {
  sharing, setThread,
  toastCount: () => store.toasts.length,
  toastMessages: () => store.toasts.map(({ type, message }) => ({ type, message })),
  clearToasts,
  dispose() {
    dispose();
    clearToasts();
  },
};
