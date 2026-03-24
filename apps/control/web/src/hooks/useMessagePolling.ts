import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslationKey } from '../providers/I18nProvider';
import { rpcJson } from '../lib/rpc';
import type { Message } from '../types';

export interface UseMessagePollingOptions {
  threadId: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export interface UseMessagePollingResult {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  messagesCountRef: React.MutableRefObject<number>;
  isMountedRef: React.MutableRefObject<boolean>;
  fetchMessages: (showError?: boolean) => Promise<void>;
  startMessagePolling: (currentRunIdRef: React.MutableRefObject<string | null>) => void;
  stopMessagePolling: () => void;
  abortPendingFetch: () => void;
  error: string | null;
  setError: (value: string | null) => void;
}

export function useMessagePolling({
  threadId,
  t,
}: UseMessagePollingOptions): UseMessagePollingResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const messagePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageFetchAbortRef = useRef<AbortController | null>(null);
  const messageFetchSeqRef = useRef<number>(0);

  // Keep error in a ref so fetchMessages can read the latest value without
  // needing error in its dependency array (avoids re-creating the callback on
  // every error change, which would destabilize all consumers).
  const errorRef = useRef<string | null>(error);
  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useEffect(() => {
    messagesCountRef.current = messages.length;
  }, [messages]);

  const fetchMessages = useCallback(async (showError = false): Promise<void> => {
    messageFetchAbortRef.current?.abort();
    const controller = new AbortController();
    messageFetchAbortRef.current = controller;
    const requestSeq = ++messageFetchSeqRef.current;

    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const data = await rpcJson<{ messages: Message[] }>(res);

      if (controller.signal.aborted) return;
      if (!isMountedRef.current) return;
      if (requestSeq !== messageFetchSeqRef.current) return;
      setMessages(data.messages);
      if (errorRef.current) setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (showError) {
        setError(t('failedToLoadMessages' as TranslationKey) || 'Failed to load messages');
      }
      console.error('Failed to fetch messages:', err);
    } finally {
      if (messageFetchAbortRef.current === controller) {
        messageFetchAbortRef.current = null;
      }
    }
  }, [threadId, t]);

  const stopMessagePolling = useCallback((): void => {
    if (messagePollingRef.current) {
      clearInterval(messagePollingRef.current);
      messagePollingRef.current = null;
    }
  }, []);

  // No-op: message polling is disabled in favour of WebSocket events +
  // explicit fetchMessages() calls (run completed, verify run status, etc.).
  const startMessagePolling = useCallback((_currentRunIdRef: React.MutableRefObject<string | null>): void => {
    stopMessagePolling();
  }, [stopMessagePolling]);

  const abortPendingFetch = useCallback((): void => {
    messageFetchAbortRef.current?.abort();
    messageFetchAbortRef.current = null;
  }, []);

  return {
    messages,
    setMessages,
    messagesCountRef,
    isMountedRef,
    fetchMessages,
    startMessagePolling,
    stopMessagePolling,
    abortPendingFetch,
    error,
    setError,
  };
}
