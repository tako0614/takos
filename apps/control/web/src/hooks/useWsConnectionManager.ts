import { useCallback, useRef } from 'react';
import {
  useConnectionManagerBase,
  processIncomingMessage,
  handleTransportClose,
  type ConnectionManagerOptions,
  type ConnectionManagerResult,
  type TransportSetupContext,
} from './useConnectionManagerBase';

export type UseWsConnectionManagerOptions = ConnectionManagerOptions;
export type UseWsConnectionManagerResult = ConnectionManagerResult;

export function useWsConnectionManager(
  options: UseWsConnectionManagerOptions,
): UseWsConnectionManagerResult {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef<number>(Date.now());

  const cleanupTransport = useCallback((): void => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
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
      // Also expose via the base hook's wsRef for interface compat
      ctx.wsRef.current = ws;

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
        reconnectAttemptsRef.current = 0;

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

        // WS heartbeats also update the pong timestamp
        try {
          const peek = JSON.parse(event.data);
          if (peek?.type === 'heartbeat') {
            lastPongRef.current = Date.now();
          }
        } catch {
          // Not JSON -- will be handled below
        }

        processIncomingMessage(event.data, runId, '[WS]', {
          lastEventIdRef,
          currentRunIdRef,
          verifyRunStatus,
          handleWebSocketEventRef,
        });
      };

      ws.onerror = (event) => {
        console.warn('WebSocket error event:', event);
      };

      ws.onclose = () => {
        wsRef.current = null;
        ctx.wsRef.current = null;
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        handleTransportClose(currentRunIdRef.current || '', 'WebSocket', {
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
      };
    } catch (wsErr) {
      console.error('WebSocket creation failed:', wsErr);
    }
  }, []);

  const result = useConnectionManagerBase(
    options,
    setupTransport,
    cleanupTransport,
    [],
  );

  // Expose the local wsRef so the fallback manager can inspect readyState
  return { ...result, wsRef };
}
