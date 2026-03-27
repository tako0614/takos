import { useCallback, useRef } from 'react';
import type { TranslationKey } from '../store/i18n';
import { rpc, rpcJson } from '../lib/rpc';
import type { Run } from '../types';
import { parseTimelineEventId } from '../views/chat/timeline';
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  type EventHandlerContext,
  type WebSocketEventPayload,
  EVENT_DISPATCH,
  parseEventData,
} from './useWsMessageProcessor';

const MAX_WS_RECONNECT_ATTEMPTS = 8;

export interface UseWsConnectionManagerOptions {
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

export interface UseWsConnectionManagerResult {
  wsRef: React.MutableRefObject<WebSocket | null>;
  rootRunIdRef: React.MutableRefObject<string | null>;
  startWebSocket: (runId: string) => void;
  closeWebSocket: () => void;
  startWebSocketRef: React.MutableRefObject<(runId: string) => void>;
}

export function useWsConnectionManager({
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
}: UseWsConnectionManagerOptions): UseWsConnectionManagerResult {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef<number>(Date.now());
  const wsReconnectAttemptsRef = useRef<number>(0);
  const rootRunIdRef = useRef<string | null>(null);
  const startWebSocketRef = useRef<(runId: string) => void>(() => {});

  const closeWebSocket = useCallback((): void => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    stopMessagePolling();
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch (cleanupErr) {
        console.debug('WebSocket cleanup error (expected):', cleanupErr);
      }
      wsRef.current = null;
    }
    wsReconnectAttemptsRef.current = 0;
  }, [stopMessagePolling]);

  // Assign event handler implementations to the refs on every render.
  // handleWebSocketEventRef is assigned here because it depends on connection manager state.
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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsParams = new URLSearchParams();
    if (lastEventIdRef.current > 0) {
      wsParams.set('last_event_id', String(lastEventIdRef.current));
    }
    const wsQuery = wsParams.toString();
    const wsUrl = `${protocol}//${window.location.host}/api/runs/${runId}/ws${wsQuery ? `?${wsQuery}` : ''}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Connection timeout -- if WebSocket doesn't open within 10s, force close.
      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('[WS] Connection timeout, closing');
          ws.close();
        }
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        ws.send(JSON.stringify({ type: 'subscribe', runId }));
        lastPongRef.current = Date.now();
        wsReconnectAttemptsRef.current = 0;

        startMessagePolling(currentRunIdRef);

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const timeSinceLastPong = Date.now() - lastPongRef.current;
            if (timeSinceLastPong > 45000) {
              ws.close();
              return;
            }
            ws.send('ping');
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') {
          lastPongRef.current = Date.now();
          return;
        }

        try {
          const message = JSON.parse(event.data) as {
            type: string;
            data?: unknown;
            eventId?: number;
            event_id?: string;
          };

          // Server-side JSON heartbeats also count as liveness signal.
          if (message.type === 'heartbeat') {
            lastPongRef.current = Date.now();
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
            // Detect event ID gaps -- large gaps indicate possible event loss
            const gap = parsedEventId - lastEventIdRef.current;
            if (gap > 5 && lastEventIdRef.current > 0) {
              console.warn(`[WS] Event ID gap detected: ${lastEventIdRef.current} → ${parsedEventId} (gap=${gap})`);
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
          console.debug('Invalid WebSocket message:', parseErr);
        }
      };

      ws.onerror = (event) => {
        console.warn('WebSocket error event:', event);
      };

      ws.onclose = async () => {
        wsRef.current = null;
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        if (!isMountedRef.current) return;

        const savedRunId = currentRunIdRef.current;
        if (!savedRunId) return;

        const attemptReconnect = () => {
          wsReconnectAttemptsRef.current++;
          if (wsReconnectAttemptsRef.current <= MAX_WS_RECONNECT_ATTEMPTS && isMountedRef.current) {
            const delay = Math.min(1000 * Math.pow(2, wsReconnectAttemptsRef.current - 1), 30000);
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
          console.error('Failed to check run status after WebSocket close:', statusErr);
          attemptReconnect();
        }
      };
    } catch (wsErr) {
      console.error('WebSocket creation failed:', wsErr);
    }
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
