import {
  type ConnectionManagerOptions,
  type ConnectionManagerResult,
  type TransportSetupContext,
  useConnectionManagerBase,
} from "./useConnectionManagerBase.ts";
import { EVENT_DISPATCH } from "./useWsMessageProcessor.ts";

type MutableRefObject<T> = { current: T };

type SseListenerEntry = {
  eventType: string;
  handler: EventListener;
};

const SSE_MESSAGE_EVENT_TYPE = "message";
export const SSE_RUN_EVENT_TYPES = Object.keys(EVENT_DISPATCH).filter((
  eventType,
) => eventType !== SSE_MESSAGE_EVENT_TYPE);

function parseLastEventId(lastEventId: string): {
  eventId?: number;
  event_id?: string;
} {
  if (!lastEventId) {
    return {};
  }

  const parsedEventId = Number.parseInt(lastEventId, 10);
  if (Number.isFinite(parsedEventId)) {
    return { eventId: parsedEventId, event_id: lastEventId };
  }

  return { event_id: lastEventId };
}

export function looksLikeWrappedConnectionMessage(rawData: string): boolean {
  if (!rawData) return false;

  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    return typeof parsed.type === "string" &&
      ("data" in parsed || "eventId" in parsed || "event_id" in parsed);
  } catch {
    return false;
  }
}

export function wrapSseMessage(
  eventType: string,
  rawData: string,
  lastEventId: string,
): string {
  if (
    eventType === SSE_MESSAGE_EVENT_TYPE &&
    looksLikeWrappedConnectionMessage(rawData)
  ) {
    return rawData;
  }

  return JSON.stringify({
    type: eventType,
    data: rawData,
    ...parseLastEventId(lastEventId),
  });
}

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
  const eventSourceRef: MutableRefObject<EventSource | null> = {
    current: null,
  };
  const sseListenerRef: MutableRefObject<SseListenerEntry[]> = {
    current: [],
  };

  const cleanupTransport = (): void => {
    if (eventSourceRef.current) {
      try {
        for (const { eventType, handler } of sseListenerRef.current) {
          eventSourceRef.current.removeEventListener(eventType, handler);
        }
        sseListenerRef.current = [];
        eventSourceRef.current.onopen = null;
        eventSourceRef.current.onmessage = null;
        eventSourceRef.current.onerror = null;
        eventSourceRef.current.close();
      } catch (cleanupErr) {
        console.debug("SSE cleanup error (expected):", cleanupErr);
      }
      eventSourceRef.current = null;
    }
  };

  const setupTransport = (ctx: TransportSetupContext): void => {
    const { runId, lastEventId, onMessage, onClose, onOpen } = ctx;

    const sseParams = new URLSearchParams();
    if (lastEventId > 0) {
      sseParams.set("last_event_id", String(lastEventId));
    }
    const sseQuery = sseParams.toString();
    const sseUrl = `/api/runs/${runId}/sse${sseQuery ? `?${sseQuery}` : ""}`;

    try {
      console.debug("[SSE] Connecting to", sseUrl);
      const es = new EventSource(sseUrl, { withCredentials: true });
      eventSourceRef.current = es;
      sseListenerRef.current = [];

      const registerListener = (
        eventType: string,
        handler: EventListener,
      ): void => {
        es.addEventListener(eventType, handler);
        sseListenerRef.current.push({ eventType, handler });
      };

      // Connection timeout -- if SSE doesn't open within 10s, force close.
      const connectTimeout = setTimeout(() => {
        if (es.readyState !== EventSource.OPEN) {
          console.warn("[SSE] Connection timeout, closing");
          es.close();
          onClose();
        }
      }, 10_000);

      es.onopen = () => {
        clearTimeout(connectTimeout);
        console.debug("[SSE] Connection established for run", runId);
        onOpen();
      };

      es.onmessage = (event: MessageEvent) => {
        onMessage(
          wrapSseMessage("message", String(event.data), event.lastEventId),
        );
      };

      for (const eventType of SSE_RUN_EVENT_TYPES) {
        const handler = (event: Event): void => {
          const messageEvent = event as MessageEvent;
          onMessage(
            wrapSseMessage(
              eventType,
              String(messageEvent.data),
              messageEvent.lastEventId,
            ),
          );
        };
        registerListener(eventType, handler);
      }

      es.onerror = () => {
        clearTimeout(connectTimeout);
        // EventSource auto-reconnects for transient errors.
        // If the connection is closed (readyState === CLOSED), EventSource
        // has given up and we need to handle reconnection ourselves.
        if (es.readyState === EventSource.CLOSED) {
          console.warn(
            "[SSE] Connection closed, will attempt manual reconnect",
          );
          eventSourceRef.current = null;
          onClose();
        } else {
          // CONNECTING state -- EventSource is auto-reconnecting.
          console.debug("[SSE] Reconnecting automatically...");
        }
      };
    } catch (sseErr) {
      console.error("SSE creation failed:", sseErr);
    }
  };

  return useConnectionManagerBase(
    options,
    setupTransport,
    cleanupTransport,
    [],
  );
}
