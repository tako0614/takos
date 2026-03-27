import { useCallback, useRef } from 'react';
import type { Run } from '../types';
import { parseEventData, EVENT_DISPATCH } from './useWsMessageProcessor';
import type { UseWsConnectionManagerOptions, UseWsConnectionManagerResult } from './useWsConnectionManager';
import { useWsConnectionManager } from './useWsConnectionManager';
import { useSseConnectionManager } from './useSseConnectionManager';

/**
 * WS connection timeout before falling back to SSE (ms).
 * Shorter than the 10s timeout in the WS manager itself — we want to
 * detect quickly that WS is unavailable and switch transports.
 */
const WS_FALLBACK_TIMEOUT_MS = 3_000;

type Transport = 'ws' | 'sse';

/**
 * Connection manager that tries WebSocket first and falls back to SSE
 * when WS is unavailable (e.g., behind HTTP-only proxies, k8s ingress
 * controllers that strip Upgrade headers, etc.).
 *
 * The returned interface is identical to UseWsConnectionManagerResult,
 * so consumers (useWebSocketConnection) don't need to know which
 * transport is active.
 *
 * Fallback logic:
 * 1. First call to startWebSocket opens a WS connection.
 * 2. If WS fails to reach OPEN state within 3 seconds, or fires onerror
 *    before opening, the manager closes WS and retries via SSE.
 * 3. Once SSE is chosen, all subsequent startWebSocket calls on this
 *    mount go directly to SSE (sticky for the session lifetime).
 * 4. The choice resets if the component remounts.
 */
export function useConnectionManagerWithFallback(
  options: UseWsConnectionManagerOptions,
): UseWsConnectionManagerResult {
  const activeTransportRef = useRef<Transport>('ws');
  const fallbackAttemptedRef = useRef(false);

  // Both hooks are always instantiated (Rules of Hooks), but only
  // the active one receives startWebSocket calls.
  const wsConnection = useWsConnectionManager(options);
  const sseConnection = useSseConnectionManager(options);

  // Refs to the underlying start functions — these update every render
  // via the hooks' startWebSocketRef.
  const wsStartRef = wsConnection.startWebSocketRef;
  const sseStartRef = sseConnection.startWebSocketRef;

  const rootRunIdRef = useRef<string | null>(null);
  const startWebSocketRef = useRef<(runId: string) => void>(() => {});

  const closeWebSocket = useCallback((): void => {
    // Close whichever transport is active (closing both is safe).
    wsConnection.closeWebSocket();
    sseConnection.closeWebSocket();
  }, [wsConnection.closeWebSocket, sseConnection.closeWebSocket]);

  // Re-assign handleWebSocketEventRef AFTER both sub-hooks have written to it.
  // This ensures the event handler uses the wrapper's closeWebSocket (which
  // closes both transports) rather than a sub-hook's close function.
  // Without this, the SSE hook's version (which only closes EventSource) would
  // be active even when WS is the transport, leaving WS connections dangling
  // on run.failed events.
  options.handleWebSocketEventRef.current = (
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => {
    const payload = parseEventData(data);
    const runId = payload.run?.id || sourceRunId || options.currentRunIdRef.current || '';
    if (!runId) return;
    const isPrimaryRun = runId === options.currentRunIdRef.current;
    if (payload.run?.id) {
      options.upsertRunMeta(payload.run as Partial<Run> & { id: string });
    }

    const handler = EVENT_DISPATCH[eventType];
    if (handler) {
      handler({
        payload,
        runId,
        eventId,
        eventType,
        isPrimaryRun,
        verifyRunStatus: options.verifyRunStatus,
        isMountedRef: options.isMountedRef,
        currentRunIdRef: options.currentRunIdRef,
        lastEventIdRef: options.lastEventIdRef,
        handleWebSocketEventRef: options.handleWebSocketEventRef,
        handleRunCompletedRef: options.handleRunCompletedRef,
        setCurrentRun: options.setCurrentRun,
        setStreaming: options.setStreaming,
        setIsLoading: options.setIsLoading,
        setError: options.setError,
        closeWebSocket,
        resetStreamingState: options.resetStreamingState,
        appendTimelineEntry: options.appendTimelineEntry,
        t: options.t,
      });
    }
  };

  const switchToSse = useCallback((runId: string): void => {
    activeTransportRef.current = 'sse';
    console.info('[Fallback] WebSocket unavailable, switching to SSE for run', runId);
    wsConnection.closeWebSocket();
    sseStartRef.current(runId);
  }, [wsConnection.closeWebSocket, sseStartRef]);

  startWebSocketRef.current = (runId: string) => {
    rootRunIdRef.current = runId;

    // If we've already determined SSE is needed, go straight there.
    if (activeTransportRef.current === 'sse') {
      sseStartRef.current(runId);
      return;
    }

    // --- Try WebSocket with a quick fallback timeout ---
    // We temporarily intercept the WS instance to detect failure.
    // Start the WS connection normally via the WS manager.
    wsStartRef.current(runId);

    // Access the WebSocket instance the WS manager just created.
    const ws = wsConnection.wsRef.current;
    if (!ws) {
      // WS creation itself failed (e.g., WebSocket not available).
      if (!fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        switchToSse(runId);
      }
      return;
    }

    // If WS is already open (unlikely but possible for same-origin fast connects), done.
    if (ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Set a fallback timeout — if WS doesn't open within the window, switch.
    let settled = false;
    const fallbackTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (ws.readyState !== WebSocket.OPEN) {
        if (!fallbackAttemptedRef.current) {
          fallbackAttemptedRef.current = true;
          switchToSse(runId);
        }
      }
    }, WS_FALLBACK_TIMEOUT_MS);

    // Listen for open/error to cancel the fallback timer.
    const origOnOpen = ws.onopen;
    const origOnError = ws.onerror;

    ws.onopen = (ev: Event) => {
      if (!settled) {
        settled = true;
        clearTimeout(fallbackTimer);
      }
      // Call the original handler from the WS manager.
      if (origOnOpen) {
        (origOnOpen as (ev: Event) => void).call(ws, ev);
      }
    };

    ws.onerror = (ev: Event) => {
      if (!settled && !fallbackAttemptedRef.current) {
        settled = true;
        clearTimeout(fallbackTimer);
        fallbackAttemptedRef.current = true;
        switchToSse(runId);
        return; // Don't call original handler — we're switching transports.
      }
      // If already settled (WS was open and then errored), call original handler.
      if (origOnError) {
        (origOnError as (ev: Event) => void).call(ws, ev);
      }
    };
  };

  const startWebSocket = useCallback((runId: string): void => {
    startWebSocketRef.current(runId);
  }, []);

  return {
    // Return the wsRef from the active transport (WS manager's ref if WS,
    // SSE manager's ref — always null — if SSE). Consumers rarely use this
    // directly, but it maintains interface compatibility.
    wsRef: wsConnection.wsRef,
    rootRunIdRef,
    startWebSocket,
    closeWebSocket,
    startWebSocketRef,
  };
}
