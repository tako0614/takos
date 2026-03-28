import { useCallback, useRef } from 'react';
import {
  useConnectionManagerBase,
  processIncomingMessage,
  handleTransportClose,
  type ConnectionManagerOptions,
  type ConnectionManagerResult,
  type TransportSetupContext,
} from './useConnectionManagerBase';

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
 * - SSE is unidirectional (server -> client), so no subscribe/ping messages
 * - Authentication via `withCredentials: true` (sends cookies)
 */

export type UseSseConnectionManagerOptions = ConnectionManagerOptions;

/** Same shape as ConnectionManagerResult for interchangeability. */
export type UseSseConnectionManagerResult = ConnectionManagerResult;

export function useSseConnectionManager(
  options: UseSseConnectionManagerOptions,
): UseSseConnectionManagerResult {
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanupTransport = useCallback((): void => {
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
  }, []);

  const setupTransport = useCallback((ctx: TransportSetupContext): void => {
    const {
      runId,
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
    } = ctx;

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
          handleTransportClose(runId, 'SSE', {
            isMountedRef,
            currentRunIdRef,
            reconnectAttemptsRef,
            startWebSocketRef,
            handleRunCompletedRef,
            setIsLoading,
            setCurrentRun,
            setError,
            t,
          });
        }
      }, 10_000);

      es.onopen = () => {
        clearTimeout(connectTimeout);
        console.debug('[SSE] Connection established for run', runId);
        reconnectAttemptsRef.current = 0;
        startMessagePolling(currentRunIdRef);
      };

      es.onmessage = (event: MessageEvent) => {
        processIncomingMessage(event.data, runId, '[SSE]', {
          lastEventIdRef,
          currentRunIdRef,
          verifyRunStatus,
          handleWebSocketEventRef,
        });
      };

      es.onerror = () => {
        clearTimeout(connectTimeout);
        // EventSource auto-reconnects for transient errors.
        // If the connection is closed (readyState === CLOSED), EventSource
        // has given up and we need to handle reconnection ourselves.
        if (es.readyState === EventSource.CLOSED) {
          console.warn('[SSE] Connection closed, will attempt manual reconnect');
          eventSourceRef.current = null;
          handleTransportClose(runId, 'SSE', {
            isMountedRef,
            currentRunIdRef,
            reconnectAttemptsRef,
            startWebSocketRef,
            handleRunCompletedRef,
            setIsLoading,
            setCurrentRun,
            setError,
            t,
          });
        } else {
          // CONNECTING state -- EventSource is auto-reconnecting.
          console.debug('[SSE] Reconnecting automatically...');
        }
      };
    } catch (sseErr) {
      console.error('SSE creation failed:', sseErr);
    }
  }, []);

  return useConnectionManagerBase(
    options,
    setupTransport,
    cleanupTransport,
    [],
  );
}
