import {
  type ConnectionManagerOptions,
  type ConnectionManagerResult,
  type TransportSetupContext,
  useConnectionManagerBase,
} from "./useConnectionManagerBase.ts";

type MutableRefObject<T> = { current: T };

export type UseWsConnectionManagerOptions = ConnectionManagerOptions;

/**
 * WS manager result plus explicit transport-failure subscription hooks.
 *
 * `onTransportOpenRef` / `onTransportErrorRef` let the fallback wrapper observe
 * the socket opening / erroring without reaching into and mutating the live
 * socket's `onopen` / `onerror` properties. The WS manager owns the socket and
 * invokes these refs from inside its own handlers, so the wrapper stays
 * decoupled from the manager's handler-assignment timing.
 */
export interface UseWsConnectionManagerResult extends ConnectionManagerResult {
  onTransportOpenRef: MutableRefObject<(() => void) | null>;
  onTransportErrorRef: MutableRefObject<(() => void) | null>;
}

export function useWsConnectionManager(
  options: UseWsConnectionManagerOptions,
): UseWsConnectionManagerResult {
  const wsRef: MutableRefObject<WebSocket | null> = { current: null };
  const heartbeatRef: MutableRefObject<ReturnType<typeof setInterval> | null> =
    { current: null };
  const lastPongRef: MutableRefObject<number> = { current: Date.now() };
  const onTransportOpenRef: MutableRefObject<(() => void) | null> = {
    current: null,
  };
  const onTransportErrorRef: MutableRefObject<(() => void) | null> = {
    current: null,
  };

  const cleanupTransport = (): void => {
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
        console.debug("WebSocket cleanup error (expected):", cleanupErr);
      }
      wsRef.current = null;
    }
  };

  const setupTransport = (ctx: TransportSetupContext): void => {
    const { runId, lastEventId, onMessage, onClose, onOpen } = ctx;

    const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
    const wsParams = new URLSearchParams();
    if (lastEventId > 0) {
      wsParams.set("last_event_id", String(lastEventId));
    }
    const wsQuery = wsParams.toString();
    const wsUrl =
      `${protocol}//${globalThis.location.host}/api/runs/${runId}/ws${
        wsQuery ? `?${wsQuery}` : ""
      }`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      // Also expose via the base hook's wsRef for interface compat
      ctx.wsRef.current = ws;

      // Connection timeout -- if WebSocket doesn't open within 10s, force close.
      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn("[WS] Connection timeout, closing");
          ws.close();
        }
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        // Notify any transport-failure subscriber (e.g. the SSE fallback
        // wrapper) that the socket reached OPEN, so it can cancel its timer.
        onTransportOpenRef.current?.();
        ws.send(JSON.stringify({ type: "subscribe", runId }));
        lastPongRef.current = Date.now();
        onOpen();

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const timeSinceLastPong = Date.now() - lastPongRef.current;
            if (timeSinceLastPong > 45000) {
              ws.close();
              return;
            }
            ws.send("ping");
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (event.data === "pong") {
          lastPongRef.current = Date.now();
          return;
        }

        // WS heartbeats also update the pong timestamp
        try {
          const peek = JSON.parse(event.data);
          if (peek?.type === "heartbeat") {
            lastPongRef.current = Date.now();
          }
        } catch {
          // Not JSON -- will be handled below
        }

        onMessage(event.data);
      };

      ws.onerror = (event) => {
        console.warn("WebSocket error event:", event);
        // Notify any transport-failure subscriber so it can switch transports.
        onTransportErrorRef.current?.();
      };

      ws.onclose = () => {
        wsRef.current = null;
        ctx.wsRef.current = null;
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        onClose();
      };
    } catch (wsErr) {
      console.error("WebSocket creation failed:", wsErr);
    }
  };

  const result = useConnectionManagerBase(
    options,
    setupTransport,
    cleanupTransport,
  );

  // Expose the local wsRef so the fallback manager can inspect readyState,
  // plus the transport-failure subscription hooks.
  return { ...result, wsRef, onTransportOpenRef, onTransportErrorRef };
}
