import type { Run } from "../types/index.ts";
import { EVENT_DISPATCH, parseEventData } from "./useWsMessageProcessor.ts";
import type {
  UseWsConnectionManagerOptions,
  UseWsConnectionManagerResult,
} from "./useWsConnectionManager.ts";
import { useWsConnectionManager } from "./useWsConnectionManager.ts";
import { useSseConnectionManager } from "./useSseConnectionManager.ts";

type MutableRefObject<T> = { current: T };

/**
 * WS connection timeout before falling back to SSE (ms).
 * Shorter than the 10s timeout in the WS manager itself — we want to
 * detect quickly that WS is unavailable and switch transports.
 */
const WS_FALLBACK_TIMEOUT_MS = 3_000;

type Transport = "ws" | "sse";

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
 * 1. First call to startWebSocket subscribes to the WS manager's explicit
 *    open/error hooks, then opens a WS connection.
 * 2. If WS fails to reach OPEN state within 3 seconds, or the WS manager
 *    reports an error before opening, the manager closes WS and retries via SSE.
 * 3. Once SSE is chosen, all subsequent startWebSocket calls on this
 *    mount go directly to SSE (sticky for the session lifetime).
 * 4. The choice resets if the component remounts.
 *
 * The wrapper observes WS open/error via `onTransportOpenRef` /
 * `onTransportErrorRef` (which the WS manager invokes from its own handlers)
 * rather than reassigning the live socket's `onopen` / `onerror`, so it does
 * not depend on the WS manager's internal handler-assignment timing.
 */
export function useConnectionManagerWithFallback(
  options: UseWsConnectionManagerOptions,
): UseWsConnectionManagerResult {
  const activeTransportRef: MutableRefObject<Transport> = { current: "ws" };
  const fallbackAttemptedRef: MutableRefObject<boolean> = { current: false };

  // Both hooks are always instantiated, but only
  // the active one receives startWebSocket calls.
  const wsConnection = useWsConnectionManager(options);
  const sseConnection = useSseConnectionManager(options);

  // Refs to the underlying start functions — these update every render
  // via the hooks' startWebSocketRef.
  const wsStartRef = wsConnection.startWebSocketRef;
  const sseStartRef = sseConnection.startWebSocketRef;

  const rootRunIdRef: MutableRefObject<string | null> = { current: null };
  const startWebSocketRef: MutableRefObject<(runId: string) => void> = {
    current: () => {},
  };

  const closeWebSocket = (): void => {
    // Close whichever transport is active (closing both is safe).
    wsConnection.closeWebSocket();
    sseConnection.closeWebSocket();
  };

  // Re-assign handleWebSocketEventRef AFTER both sub-hooks have written to it.
  // This ensures the event handler uses the wrapper's closeWebSocket (which
  // closes both transports) rather than a sub-hook's close function.
  // Without this, the SSE hook's version (which only closes EventSource) would
  // be active even when WS is the transport, leaving WS connections dangling
  // on run.failed events.
  const {
    processor,
    currentRunIdRef,
    lastEventIdRef,
    isMountedRef,
    setError,
    t,
  } = options;
  const {
    verifyRunStatus,
    upsertRunMeta,
    handleWebSocketEventRef,
    handleRunCompletedRef,
    setCurrentRun,
    setStreaming,
    setIsLoading,
    resetStreamingState,
    appendTimelineEntry,
  } = processor;

  handleWebSocketEventRef.current = (
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => {
    const payload = parseEventData(data);
    const runId = payload.run?.id || sourceRunId || currentRunIdRef.current ||
      "";
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

  const switchToSse = (runId: string): void => {
    activeTransportRef.current = "sse";
    console.info(
      "[Fallback] WebSocket unavailable, switching to SSE for run",
      runId,
    );
    wsConnection.closeWebSocket();
    sseStartRef.current(runId);
  };

  startWebSocketRef.current = (runId: string) => {
    rootRunIdRef.current = runId;

    // If we've already determined SSE is needed, go straight there.
    if (activeTransportRef.current === "sse") {
      sseStartRef.current(runId);
      return;
    }

    // --- Try WebSocket with a quick fallback timeout ---
    // Subscribe to the WS manager's explicit open/error hooks BEFORE starting,
    // so we observe the socket lifecycle without mutating the live socket's
    // handler properties (the WS manager owns and invokes these).
    let settled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanupSubscription = (): void => {
      if (fallbackTimer !== undefined) {
        clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
      wsConnection.onTransportOpenRef.current = null;
      wsConnection.onTransportErrorRef.current = null;
    };

    wsConnection.onTransportOpenRef.current = () => {
      if (settled) return;
      settled = true;
      cleanupSubscription();
    };

    wsConnection.onTransportErrorRef.current = () => {
      if (settled) return;
      settled = true;
      cleanupSubscription();
      if (!fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        switchToSse(runId);
      }
    };

    // Start the WS connection normally via the WS manager.
    wsStartRef.current(runId);

    // Access the WebSocket instance the WS manager just created.
    const ws = wsConnection.wsRef.current;
    if (!ws) {
      // WS creation itself failed (e.g., WebSocket not available).
      settled = true;
      cleanupSubscription();
      if (!fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        switchToSse(runId);
      }
      return;
    }

    // If WS is already open (unlikely but possible for same-origin fast connects), done.
    if (ws.readyState === WebSocket.OPEN) {
      settled = true;
      cleanupSubscription();
      return;
    }

    // Set a fallback timeout — if WS doesn't open within the window, switch.
    fallbackTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupSubscription();
      if (ws.readyState !== WebSocket.OPEN && !fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        switchToSse(runId);
      }
    }, WS_FALLBACK_TIMEOUT_MS);
  };

  const startWebSocket = (runId: string): void => {
    startWebSocketRef.current(runId);
  };

  return {
    // Return the wsRef from the active transport (WS manager's ref if WS,
    // SSE manager's ref — always null — if SSE). Consumers rarely use this
    // directly, but it maintains interface compatibility.
    wsRef: wsConnection.wsRef,
    rootRunIdRef,
    startWebSocket,
    closeWebSocket,
    startWebSocketRef,
    // Forward the WS manager's transport-failure hooks for interface
    // compatibility; this wrapper drives them internally.
    onTransportOpenRef: wsConnection.onTransportOpenRef,
    onTransportErrorRef: wsConnection.onTransportErrorRef,
  };
}
