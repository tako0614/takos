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

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export const MAX_RECONNECT_ATTEMPTS = 8;

export interface ConnectionManagerOptions {
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

export interface ConnectionManagerResult {
  wsRef: React.MutableRefObject<WebSocket | null>;
  rootRunIdRef: React.MutableRefObject<string | null>;
  startWebSocket: (runId: string) => void;
  closeWebSocket: () => void;
  startWebSocketRef: React.MutableRefObject<(runId: string) => void>;
}

// ---------------------------------------------------------------------------
// Shared helpers (message processing & reconnection)
// ---------------------------------------------------------------------------

/**
 * Parse an incoming message JSON string, deduplicate by event ID,
 * detect event ID gaps, and dispatch to the event handler.
 *
 * `logPrefix` is used only for console messages (e.g. "[WS]" or "[SSE]").
 */
export function processIncomingMessage(
  rawData: string,
  runId: string,
  logPrefix: string,
  deps: {
    lastEventIdRef: React.MutableRefObject<number>;
    currentRunIdRef: React.MutableRefObject<string | null>;
    verifyRunStatus: (runId: string, refreshMessages?: boolean) => Promise<boolean>;
    handleWebSocketEventRef: React.MutableRefObject<(
      eventType: string,
      data: unknown,
      eventId?: number,
      sourceRunId?: string,
    ) => void>;
  },
): void {
  try {
    const message = JSON.parse(rawData) as {
      type: string;
      data?: unknown;
      eventId?: number;
      event_id?: string;
    };

    // Server-side heartbeats -- just a liveness signal.
    if (message.type === 'heartbeat') {
      return;
    }

    const parsedEventId = parseTimelineEventId({
      id: message.eventId,
      event_id: message.event_id,
    });

    if (typeof parsedEventId === 'number') {
      if (parsedEventId <= deps.lastEventIdRef.current) {
        return;
      }
      // Detect event ID gaps -- large gaps indicate possible event loss
      const gap = parsedEventId - deps.lastEventIdRef.current;
      if (gap > 5 && deps.lastEventIdRef.current > 0) {
        console.warn(`${logPrefix} Event ID gap detected: ${deps.lastEventIdRef.current} → ${parsedEventId} (gap=${gap})`);
        if (deps.currentRunIdRef.current) {
          deps.verifyRunStatus(deps.currentRunIdRef.current);
        }
      }
      deps.lastEventIdRef.current = parsedEventId;
    }

    deps.handleWebSocketEventRef.current(
      message.type,
      message.data,
      parsedEventId,
      runId,
    );
  } catch (parseErr) {
    console.debug(`Invalid ${logPrefix} message:`, parseErr);
  }
}

/**
 * Handle a transport close event: check the run status and either call
 * handleRunCompleted or attempt reconnection with exponential backoff.
 *
 * `logPrefix` is used only for console messages (e.g. "WebSocket" or "SSE").
 */
export function handleTransportClose(
  savedRunId: string,
  logPrefix: string,
  deps: {
    isMountedRef: React.MutableRefObject<boolean>;
    currentRunIdRef: React.MutableRefObject<string | null>;
    reconnectAttemptsRef: React.MutableRefObject<number>;
    startWebSocketRef: React.MutableRefObject<(runId: string) => void>;
    handleRunCompletedRef: React.MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
    setError: (value: string | null) => void;
    t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  },
): void {
  if (!deps.isMountedRef.current) return;
  if (!savedRunId || deps.currentRunIdRef.current !== savedRunId) return;

  const attemptReconnect = () => {
    deps.reconnectAttemptsRef.current++;
    if (deps.reconnectAttemptsRef.current <= MAX_RECONNECT_ATTEMPTS && deps.isMountedRef.current) {
      const delay = Math.min(1000 * Math.pow(2, deps.reconnectAttemptsRef.current - 1), 30000);
      setTimeout(() => {
        if (deps.isMountedRef.current && deps.currentRunIdRef.current === savedRunId) {
          deps.startWebSocketRef.current(savedRunId);
        }
      }, delay);
    } else if (deps.isMountedRef.current) {
      deps.setIsLoading(false);
      deps.setCurrentRun(null);
      deps.setError(deps.t('networkError'));
    }
  };

  (async () => {
    try {
      const res = await rpc.runs[':id'].$get({ param: { id: savedRunId } });
      const data = await rpcJson<{ run: Run }>(res);
      const status = data.run?.status;

      if (status && TERMINAL_RUN_STATUSES.has(status)) {
        deps.handleRunCompletedRef.current(data.run, data.run?.session_id ?? undefined);
      } else if (status && ACTIVE_RUN_STATUSES.has(status)) {
        attemptReconnect();
      }
    } catch (statusErr) {
      console.error(`Failed to check run status after ${logPrefix} close:`, statusErr);
      attemptReconnect();
    }
  })();
}

// ---------------------------------------------------------------------------
// Base hook
// ---------------------------------------------------------------------------

/**
 * Shared base hook for both WS and SSE connection managers.
 *
 * The `setupTransport` callback receives the runId, a close function for the
 * current transport, and shared refs/helpers. It must open the transport
 * connection and return a cleanup function that closes the raw transport
 * (EventSource or WebSocket).
 */
export function useConnectionManagerBase(
  options: ConnectionManagerOptions,
  setupTransport: (ctx: TransportSetupContext) => void,
  cleanupTransport: () => void,
  transportDeps: unknown[], // extra deps for the cleanup useCallback
): ConnectionManagerResult {
  const {
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
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const rootRunIdRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const startWebSocketRef = useRef<(runId: string) => void>(() => {});

  const closeWebSocket = useCallback((): void => {
    stopMessagePolling();
    cleanupTransport();
    reconnectAttemptsRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopMessagePolling, ...transportDeps]);

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
        closeWebSocket,
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

    closeWebSocket();
    currentRunIdRef.current = runId;

    setupTransport({
      runId,
      wsRef,
      reconnectAttemptsRef,
      startWebSocketRef,
      startMessagePolling,
      currentRunIdRef,
      lastEventIdRef,
      verifyRunStatus,
      handleWebSocketEventRef,
      isMountedRef,
      handleRunCompletedRef,
      setIsLoading,
      setCurrentRun,
      setError,
      t,
    });
  };

  // Stable wrapper that delegates to the ref
  const startWebSocket = useCallback((runId: string): void => {
    startWebSocketRef.current(runId);
  }, []);

  return {
    wsRef,
    rootRunIdRef,
    startWebSocket,
    closeWebSocket,
    startWebSocketRef,
  };
}

/**
 * Context passed to the transport-specific `setupTransport` callback.
 * Contains everything the transport needs to wire up its connection.
 */
export interface TransportSetupContext {
  runId: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  reconnectAttemptsRef: React.MutableRefObject<number>;
  startWebSocketRef: React.MutableRefObject<(runId: string) => void>;
  startMessagePolling: (currentRunIdRef: React.MutableRefObject<string | null>) => void;
  currentRunIdRef: React.MutableRefObject<string | null>;
  lastEventIdRef: React.MutableRefObject<number>;
  verifyRunStatus: (runId: string, refreshMessages?: boolean) => Promise<boolean>;
  handleWebSocketEventRef: React.MutableRefObject<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>;
  isMountedRef: React.MutableRefObject<boolean>;
  handleRunCompletedRef: React.MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  setError: (value: string | null) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}
