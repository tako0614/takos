import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { useChatSession, type UseChatSessionResult } from "../../../../web/src/hooks/useChatSession.ts";
import { ChatInputBar } from "../../../../web/src/views/chat/ChatInputBar.tsx";
import { ChatErrorBanner } from "../../../../web/src/views/chat/ChatErrorBanner.tsx";
import { ChatSendRecovery } from "../../../../web/src/views/chat/ChatSendRecovery.tsx";
import { ConfirmDialogRenderer } from "../../../../web/src/components/common/ConfirmDialog.tsx";
import { useConfirmDialogActions } from "../../../../web/src/store/confirm-dialog.ts";
import { ChatSendRecoveryProvider } from "../../../../web/src/hooks/chat-send-recovery.tsx";
import { AuthProvider, useAuth } from "../../../../web/src/hooks/useAuth.tsx";

const [thread, setThread] = createSignal("thread-a");
const [focus, setFocus] = createSignal<number | null>(null);
const [principal, setPrincipal] = createSignal({ id: "synthetic-owner" });
const [mounted, setMounted] = createSignal(true);
let session!: UseChatSessionResult;
let refetchIdentity: (() => Promise<void>) | undefined;
const dialogs = useConfirmDialogActions();
const pending = new Set<Promise<void>>();
const track = (promise: Promise<void>) => {
  const result = promise.finally(() => pending.delete(result)); pending.add(result); return result;
};
function Conversation() {
  session = useChatSession({ threadId: thread, spaceId: () => "space-a", focusSequence: focus, onUpdateTitle: () => {} });
  return <>
    <ul aria-label="Messages"><For each={session.messages()}>{(message) => <li>{message.content}</li>}</For></ul>
    <Show when={session.error()}>{(error) => <ChatErrorBanner error={error()} onDismiss={() => session.setError(null)} />}</Show>
    <ChatSendRecovery recovery={session.sendRecovery()} busy={session.isLoading() || session.recoveryBusy()}
      canRestore={!session.input() && session.attachedFiles().length === 0}
      onRetry={(...args) => track(session.retryReply(...args))} onCheck={(receipt) => track(session.checkSendStatus(receipt))} onRestore={session.restoreSendDraft} onDismiss={session.dismissSendRecovery} />
    <ChatInputBar input={session.input()} onInputChange={session.setInput}
      attachedFiles={session.attachedFiles()} onFileSelect={session.handleFileSelect} onRemoveFile={session.removeAttachedFile}
      onSend={() => track(session.sendMessage())} isLoading={session.isLoading()}
      onCancel={config?.cancel ? () => track(session.handleCancel()) : undefined}
      isCancelling={config?.cancel ? session.isCancelling() : false}
      sendBlocked={session.sendBlocked()}
      attachLabel="Attach file" placeholder="Message" inputHint="Send a message" />
    <ConfirmDialogRenderer />
  </>;
}
function AuthenticatedConversation() {
  const auth = useAuth();
  refetchIdentity = auth.fetchUser;
  const identity = { principal: () => auth.user?.username ?? null, authState: () => auth.authState };
  return <ChatSendRecoveryProvider {...identity}>
    <Show when={auth.authState === "authenticated"}><Conversation /></Show>
  </ChatSendRecoveryProvider>;
}
const config = (globalThis as typeof globalThis & { chatSendTestConfig?: { auth: boolean; cancel?: boolean } }).chatSendTestConfig;
const dispose = render(() => config?.auth
  ? <AuthProvider><AuthenticatedConversation /></AuthProvider>
  : <ChatSendRecoveryProvider principal={() => principal().id}>
    <Show when={mounted()}><Conversation /></Show>
  </ChatSendRecoveryProvider>, document.getElementById("root")!);

Object.assign(globalThis, { chatSendFixture: {
  state: () => ({ input: session.input(), messages: session.messages(), error: session.error(), loading: session.isLoading(), cancelling: session.isCancelling(), model: session.selectedModel(), files: session.attachedFiles().map((file) => file.name) }),
  idle: async () => { while (pending.size) await Promise.all(pending); },
  pendingCount: () => pending.size,
  refetchIdentity: () => { if (!refetchIdentity) throw new Error("No AuthProvider in this fixture"); return refetchIdentity(); },
  setThread: (id: string) => {
    globalThis.location.pathname = `/chat/space-a/${id}`;
    globalThis.location.href = `${globalThis.location.origin}${globalThis.location.pathname}`;
    setThread(id);
  },
  setPrincipal: (id: string) => setPrincipal({ id }), setMounted, setFocus, setModel: (model: string) => session.setSelectedModel(model),
  dispose() { dialogs.handleCancel(); dispose(); },
} });
