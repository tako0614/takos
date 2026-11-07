import { createContext, createEffect, createMemo, createSignal, onCleanup, type ParentProps, useContext } from "solid-js";
import type { Run } from "../types/index.ts";
import type { AuthState } from "../store/auth.ts";

export interface ChatSendRecovery {
  kind: "unsent" | "message-unknown" | "reply-rejected" | "reply-unknown" | "reply-known";
  threadId: string;
  text: string;
  files: File[];
  model: string;
  messageId?: string;
  run?: Run;
  checked?: boolean;
  pending?: boolean;
}

export function createChatSendRecoveryStore() {
  const [receipts, setReceipts] = createSignal(new Map<string, ChatSendRecovery>());
  const [epoch, setEpoch] = createSignal(0);
  const [verified, setVerified] = createSignal(true);
  let principal: string | null | undefined;
  let closed = false;
  return {
    get: (threadId: string) => verified() ? receipts().get(threadId) ?? null : null,
    owns: (threadId: string, expected: ChatSendRecovery) => !closed && receipts().get(threadId) === expected,
    epoch,
    verified,
    replace(threadId: string, expected: ChatSendRecovery | null, next: ChatSendRecovery | null) {
      if (closed || (receipts().get(threadId) ?? null) !== expected) return false;
      if (!verified() && expected === null) return false;
      // Never evict an unresolved outcome to make room for another send.
      if (next && !expected && receipts().size >= 32) return false;
      setReceipts((previous) => {
        const result = new Map(previous);
        if (next) result.set(threadId, next); else result.delete(threadId);
        return result;
      });
      return true;
    },
    identify(next: string | null | undefined) {
      if (next === undefined) {
        if (verified()) setEpoch((value) => value + 1);
        setVerified(false); return;
      }
      if (next === null || principal !== next) {
        principal = next;
        setEpoch((value) => value + 1); setReceipts(new Map());
      } else if (!verified()) setEpoch((value) => value + 1);
      setVerified(next !== null);
    },
    dispose() { closed = true; setReceipts(new Map()); },
  };
}

const Context = createContext<ReturnType<typeof createChatSendRecoveryStore>>();

export function ChatSendRecoveryProvider(props: ParentProps<{ principal: () => string | null; authState?: () => AuthState }>) {
  const store = createChatSendRecoveryStore();
  const principal = createMemo(() => {
    const state = props.authState?.() ?? "authenticated";
    return state === "loading" ? undefined : state === "login" ? null : props.principal() ?? undefined;
  });
  createEffect(() => { store.identify(principal()); });
  onCleanup(() => store.dispose());
  return <Context.Provider value={store}>{props.children}</Context.Provider>;
}

export function useChatSendRecoveryStore() {
  const shared = useContext(Context);
  if (shared) return shared;
  const local = createChatSendRecoveryStore();
  onCleanup(() => local.dispose());
  return local;
}
