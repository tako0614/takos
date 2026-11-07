import { type Accessor, createEffect, createSignal } from "solid-js";
import type { Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpcJson } from "../lib/rpc.ts";
import type { Message } from "../types/index.ts";

const ACTIVE_RUN_MESSAGE_POLL_INTERVAL_MS = 5_000;
export type MessageFetchOutcome = "adopted" | "failed" | "retired" | "authentication-required";

interface MessageFetchOptions {
  /** Additional caller ownership for adopting the response. */
  isCurrent?: () => boolean;
  /** Ownership of login navigation and error feedback. */
  isEffectCurrent?: () => boolean;
}

export interface UseMessagePollingOptions {
  threadId: Accessor<string>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export interface UseMessagePollingResult {
  messages: Message[];
  setMessages: Setter<Message[]>;
  messagesCountRef: { current: number };
  isMountedRef: { current: boolean };
  fetchMessages: (
    showError?: boolean,
    options?: MessageFetchOptions,
  ) => Promise<MessageFetchOutcome>;
  startMessagePolling: (currentRunIdRef: { current: string | null }) => void;
  stopMessagePolling: () => void;
  abortPendingFetch: () => void;
  error: string | null;
  errorRevision: number;
  hasMessageReadError: boolean;
  setError: (value: string | null) => void;
}

export function useMessagePolling({
  threadId,
  t,
}: UseMessagePollingOptions): UseMessagePollingResult {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [error, setErrorState] = createSignal<string | null>(null);
  const [hasMessageReadError, setHasMessageReadError] = createSignal(false);
  // A late read must not replace feedback from a newer error or dismissal.
  let errorRevision = 0;
  const setError = (value: string | null) => {
    errorRevision++;
    setHasMessageReadError(false);
    setErrorState(value);
  };
  const messagesCountRef = { current: 0 as number };
  const isMountedRef = { current: true as boolean };
  let messagePollingRef: ReturnType<typeof setInterval> | null = null;
  let messageFetchAbortRef: AbortController | null = null;
  let messageFetchSeqRef = 0;

  // Keep error in a ref so fetchMessages can read the latest value without
  // needing error in its dependency array (avoids re-creating the callback on
  // every error change, which would destabilize all consumers).
  let errorRef: string | null = error();
  createEffect(() => {
    errorRef = error();
  });

  createEffect(() => {
    messagesCountRef.current = messages().length;
  });

  const fetchMessages = async (
    showError = false,
    options: MessageFetchOptions = {},
  ): Promise<MessageFetchOutcome> => {
    const currentThreadId = threadId();
    messageFetchAbortRef?.abort();
    const controller = new AbortController();
    messageFetchAbortRef = controller;
    const requestSeq = ++messageFetchSeqRef;
    const requestErrorRevision = errorRevision;
    const isCurrent = () => !controller.signal.aborted && isMountedRef.current &&
      requestSeq === messageFetchSeqRef && threadId() === currentThreadId &&
      options.isCurrent?.() !== false;
    let responseStatus: number | undefined;

    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(currentThreadId)}/messages`,
        {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      responseStatus = res.status;
      const data = await rpcJson<{ messages: Message[] }>(res, {
        isCurrent: () => isCurrent() && options.isEffectCurrent?.() !== false,
      });

      if (!isCurrent()) return "retired";
      setMessages(data.messages);
      if (hasMessageReadError() && errorRef) setError(null);
      return "adopted";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "retired";
      if (!isCurrent()) return "retired";
      if (responseStatus === 401) return "authentication-required";
      if (showError && options.isEffectCurrent?.() !== false && errorRevision === requestErrorRevision) {
        errorRevision++;
        setErrorState(t("failedToLoadMessages" as TranslationKey));
        setHasMessageReadError(true);
      }
      return "failed";
    } finally {
      if (messageFetchAbortRef === controller) {
        messageFetchAbortRef = null;
      }
    }
  };

  const stopMessagePolling = (): void => {
    if (messagePollingRef) {
      clearInterval(messagePollingRef);
      messagePollingRef = null;
    }
  };

  const startMessagePolling = (
    currentRunIdRef: { current: string | null },
  ): void => {
    stopMessagePolling();
    messagePollingRef = setInterval(() => {
      if (!currentRunIdRef.current) {
        stopMessagePolling();
        return;
      }
      void fetchMessages(false);
    }, ACTIVE_RUN_MESSAGE_POLL_INTERVAL_MS);
  };

  const abortPendingFetch = (): void => {
    messageFetchAbortRef?.abort();
    messageFetchAbortRef = null;
  };

  return {
    get messages() {
      return messages();
    },
    setMessages,
    messagesCountRef,
    isMountedRef,
    fetchMessages,
    startMessagePolling,
    stopMessagePolling,
    abortPendingFetch,
    get error() {
      return error();
    },
    get errorRevision() {
      return errorRevision;
    },
    get hasMessageReadError() {
      return hasMessageReadError();
    },
    setError,
  };
}
