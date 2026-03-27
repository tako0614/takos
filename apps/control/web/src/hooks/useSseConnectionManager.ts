import { useCallback, useRef } from 'react';
import type { TranslationKey } from '../store/i18n';
import { rpc, rpcJson } from '../lib/rpc';
import type { Run } from '../types';
import { parseTimelineEventId } from '../views/chat/timeline';
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  type WebSocketEventPayload,
  EVENT_DISPATCH,
  parseEventData,
} from './useWsMessageProcessor';

const MAX_SSE_RECONNECT_ATTEMPTS = 8;

/**
 * SSE-based connection manager that exposes the same interface as
 * useWsConnectionManager. Used as a fallback when WebSocket connections
 * are unavailable (e.g. Node.js/k8s environments behind HTTP-only proxies).
 *
 * Key differences from the WS version:
 * - Uses browser-native EventSource API instead of WebSocket
 * - No client-side heartbeat needed (server sends `: heartbeat` comments
 *   which EventSource handles internally)
 * - EventSource auto-reconnects and sends `Last-Event-ID` header automatically
 * - SSE is unidirectional (server → client), so no subscribe/ping messages
 * - Authentication via `withCredentials: true` (sends cookies)
 */

export interface UseSseConnectionManagerOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isMountedRef: React.MutableRefObject<boolean>;
  startMessagePolling: (currentRunIdRef: React.MutableRefObject<string | null>) => void;
  stopMessagePolling: () => void;
  setError: (value: string | null) => void;
  // From message processor
  currentRunIdRef: React.MutableRefObject<string | null>;
  lastEventIdRef: React.MutableRefObject<number>;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setStreaming: React.Dispatch<React.SetStateAction<import('../views/chat/types').ChatStreamingState>>;
  resetStreamingState: () => void;
  appendTimelineEntry: (
    runId: string,
    eventType: string,
    payload: WebSocketEventPayload,
    eventId?: number,
    createdAt?: number,
  ) => void;
  verifyRunStatus: (runId: string, refreshMessages?: boolean) => Promise<boolean>;
  upsertRunMeta: (run: Partial<Run> & { id: string }) => void;
  handleRunCompletedRef: React.MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>;
  handleWebSocketEventRef: React.MutableRefObject<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>;
}

/** Same shape as UseWsConnectionManagerResult for interchangeability. */
export interface UseSseConnectionManagerResult {
  /** Always null for SSE — kept for interface compatibility with WS manager. */
  wsRef: React.MutableRefObject<WebSocket | null>;
  rootRunIdRef: React.MutableRefObject<string | null>;
  startWebSocket: (runId: string) => void;
  closeWebSocket: () => void;
  startWebSocketRef: React.MutableRefObject<(runId: string) => void>;
}

export function useSseConnectionManager({
  t,
  isMountedRef,
  startMessagePolling,
  stopMessagePolling,
  setError,
  currentRunIdRef,
  lastEventIdRef,
  setCurrentRun,
  setIsLoading,
  setStreaming,
  resetStreamingState,
  appendTimelineEntry,
  verifyRunStatus,
  upsertRunMeta,
  handleRunCompletedRef,
  handleWebSocketEventRef,
}: UseSseConnectionManagerOptions): UseSseConnectionManagerResult {
  // wsRef is kept as null for interface compat — consumers should not rely on it for SSE.
  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const rootRunIdRef = useRef<string | null>(null);
  const sseReconnectAttemptsRef = useRef<number>(0);
  const startWebSocketRef = useRef<(runId: string) => void>(() => {});

  const closeSse = useCallback((): void => {
    stopMessagePolling();
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.onopen = null;
        eventSourceRef.current.onmessage = null;
        eventSourceRef.current.onerror = null;
        eventSourceRef.current.close();
      } catch (cleanupErr) {
        console.debug('SSE cleanup error (expected):', cleanupErr);
      }
      eventSourceRef.current = null;
    }
    sseReconnectAttemptsRef.current = 0;
  }, [stopMessagePolling]);

  // Assign event handler implementations to the refs on every render.
  handleWebSocketEventRef.current = (
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => {
    const payload = parseEventData(data);
    const runId = payload.run?.id || sourceRunId || currentRunIdRef.current || '';
    if (!runId) return;
    const isPrimaryRun = runId === currentRunIdRef.current;
    if (payload.run?.id) {
      upsertRunMeta(payload.run as Partial<Run> & { id: string });
    }

    const handler = EVENT_DISPATCH[eventType];
    if (handler) {
      handler({
        payload,
        runId,
        eventId,
        eventType,
        isPrimaryRun,
        verifyRunStatus,
        isMountedRef,
        currentRunIdRef,
        lastEventIdRef,
        handleWebSocketEventRef,
        handleRunCompletedRef,
        setCurrentRun,
        setStreaming,
        setIsLoading,
        setError,
        closeWebSocket: closeSse,
        resetStreamingState,
        appendTimelineEntry,
        t,
      });
    }
  };

  startWebSocketRef.current = (runId: string) => {
    const previousRunId = currentRunIdRef.current;
    if (previousRunId !== runId) {
      lastEventIdRef.current = 0;
      rootRunIdRef.current = runId;
    }

    closeSse();
    currentRunIdRef.current = runId;

    const sseParams = new URLSearchParams();
    if (lastEventIdRef.current > 0) {
      sseParams.set('last_event_id', String(lastEventIdRef.current));
    }
    const sseQuery = sseParams.toString();
    const sseUrl = `/api/runs/${runId}/sse${sseQuery ? `?${sseQuery}` : ''}`;

    try {
      console.debug('[SSE] Connecting to', sseUrl);
      const es = new EventSource(sseUrl, { withCredentials: true });
      eventSourceRef.current = es;

      // Connection timeout -- if SSE doesn't open within 10s, force close.
      const connectTimeout = setTimeout(() => {
        if (es.readyState !== EventSource.OPEN) {
          console.warn('[SSE] Connection timeout, closing');
          es.close();
          handleSseClose(runId);
        }
      }, 10_000);

      es.onopen = () => {
        clearTimeout(connectTimeout);
        console.debug('[SSE] Connection established for run', runId);
        sseReconnectAttemptsRef.current = 0;
        startMessagePolling(currentRunIdRef);
      };

      es.onmessage = (event: MessageEvent) => {
        processMessage(event.data, runId);
      };

      es.onerror = () => {
        clearTimeout(connectTimeout);
        // EventSource auto-reconnects for transient errors.
        // If the connection is closed (readyState === CLOSED), EventSource
        // has given up and we need to handle reconnection ourselves.
        if (es.readyState === EventSource.CLOSED) {
          console.warn('[SSE] Connection closed, will attempt manual reconnect');
          eventSourceRef.current = null;
          handleSseClose(runId);
        } else {
          // CONNECTING state — EventSource is auto-reconnecting.
          console.debug('[SSE] Reconnecting automatically...');
        }
      };
    } catch (sseErr) {
      console.error('SSE creation failed:', sseErr);
    }
  };

  function processMessage(rawData: string, runId: string): void {
    try {
      const message = JSON.parse(rawData) as {
        type: string;
        data?: unknown;
        eventId?: number;
        event_id?: string;
      };

      // Server-side heartbeats — just a liveness signal.
      if (message.type === 'heartbeat') {
        return;
      }

      const parsedEventId = parseTimelineEventId({
        id: message.eventId,
        event_id: message.event_id,
      });

      if (typeof parsedEventId === 'number') {
        if (parsedEventId <= lastEventIdRef.current) {
          return;
        }
        // Detect event ID gaps — large gaps indicate possible event loss
        const gap = parsedEventId - lastEventIdRef.current;
        if (gap > 5 && lastEventIdRef.current > 0) {
          console.warn(`[SSE] Event ID gap detected: ${lastEventIdRef.current} → ${parsedEventId} (gap=${gap})`);
          if (currentRunIdRef.current) {
            verifyRunStatus(currentRunIdRef.current);
          }
        }
        lastEventIdRef.current = parsedEventId;
      }

      handleWebSocketEventRef.current(
        message.type,
        message.data,
        parsedEventId,
        runId,
      );
    } catch (parseErr) {
      console.debug('Invalid SSE message:', parseErr);
    }
  }

  function handleSseClose(savedRunId: string): void {
    if (!isMountedRef.current) return;
    if (!savedRunId || currentRunIdRef.current !== savedRunId) return;

    const attemptReconnect = () => {
      sseReconnectAttemptsRef.current++;
      if (sseReconnectAttemptsRef.current <= MAX_SSE_RECONNECT_ATTEMPTS && isMountedRef.current) {
        const delay = Math.min(1000 * Math.pow(2, sseReconnectAttemptsRef.current - 1), 30000);
        setTimeout(() => {
          if (isMountedRef.current && currentRunIdRef.current === savedRunId) {
            startWebSocketRef.current(savedRunId);
          }
        }, delay);
      } else if (isMountedRef.current) {
        setIsLoading(false);
        setCurrentRun(null);
        setError(t('networkError'));
      }
    };

    (async () => {
      try {
        const res = await rpc.runs[':id'].$get({ param: { id: savedRunId } });
        const data = await rpcJson<{ run: Run }>(res);
        const status = data.run?.status;

        if (status && TERMINAL_RUN_STATUSES.has(status)) {
          handleRunCompletedRef.current(data.run, data.run?.session_id ?? undefined);
        } else if (status && ACTIVE_RUN_STATUSES.has(status)) {
          attemptReconnect();
        }
      } catch (statusErr) {
        console.error('Failed to check run status after SSE close:', statusErr);
        attemptReconnect();
      }
    })();
  }

  // Stable wrapper that delegates to the ref
  const startWebSocket = useCallback((runId: string): void => {
    startWebSocketRef.current(runId);
  }, []);

  return {
    wsRef,
    rootRunIdRef,
    startWebSocket,
    closeWebSocket: closeSse,
    startWebSocketRef,
  };
}
