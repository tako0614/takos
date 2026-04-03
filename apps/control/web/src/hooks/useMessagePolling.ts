import { type Accessor, createEffect, createSignal } from "solid-js";
import type { Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpcJson } from "../lib/rpc.ts";
import type { Message } from "../types/index.ts";

export interface UseMessagePollingOptions {
  threadId: Accessor<string>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export interface UseMessagePollingResult {
  messages: Message[];
  setMessages: Setter<Message[]>;
  messagesCountRef: { current: number };
  isMountedRef: { current: boolean };
  fetchMessages: (showError?: boolean) => Promise<void>;
  startMessagePolling: (currentRunIdRef: { current: string | null }) => void;
  stopMessagePolling: () => void;
  abortPendingFetch: () => void;
  error: string | null;
  setError: (value: string | null) => void;
}

export function useMessagePolling({
  threadId,
  t,
}: UseMessagePollingOptions): UseMessagePollingResult {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [error, setError] = createSignal<string | null>(null);
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

  const fetchMessages = async (showError = false): Promise<void> => {
    const currentThreadId = threadId();
    messageFetchAbortRef?.abort();
    const controller = new AbortController();
    messageFetchAbortRef = controller;
    const requestSeq = ++messageFetchSeqRef;

    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(currentThreadId)}/messages`,
        {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const data = await rpcJson<{ messages: Message[] }>(res);

      if (controller.signal.aborted) return;
      if (!isMountedRef.current) return;
      if (requestSeq !== messageFetchSeqRef) return;
      if (threadId() !== currentThreadId) return;
      setMessages(data.messages);
      if (errorRef) setError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (threadId() !== currentThreadId) return;
      if (showError) {
        setError(
          t("failedToLoadMessages" as TranslationKey) ||
            "Failed to load messages",
        );
      }
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

  // No-op: message polling is disabled in favour of WebSocket events +
  // explicit fetchMessages() calls (run completed, verify run status, etc.).
  const startMessagePolling = (
    _currentRunIdRef: { current: string | null },
  ): void => {
    stopMessagePolling();
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
    setError,
  };
}
