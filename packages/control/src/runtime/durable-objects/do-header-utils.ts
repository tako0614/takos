/** Shared types and helpers for Durable Object implementations. */

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface RingBufferEvent {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

export interface ExtendedWebSocket extends WebSocket {
  connectionId?: string;
  lastActivity?: number;
}

/** Default ring buffer capacity for event replay. */
export const RING_BUFFER_SIZE = 100;

/** Idle timeout before a WebSocket is considered stale (5 minutes). */
export const CONNECTION_TIMEOUT_MS = 5 * 60 * 1000;

/** Hard cap on concurrent WebSocket connections per DO instance. */
export const MAX_CONNECTIONS = 10_000;

/**
 * Parse a value that may be a numeric event ID.
 * Returns the floored integer when positive and finite, otherwise null.
 */
export function parseEventId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Append an event to a ring buffer and return the assigned event ID.
 * Mutates buffer and advances counter.value as a side-effect.
 */
export function addToRingBuffer(
  buffer: RingBufferEvent[],
  counter: { value: number },
  type: string,
  data: unknown,
  preferredEventId?: number | null,
): number {
  // Accept preferred ID only if it advances the counter (preserves monotonicity).
  // Stale / out-of-order preferred IDs are ignored to prevent non-monotonic replay.
  const eventId = preferredEventId && preferredEventId > counter.value
    ? preferredEventId
    : counter.value + 1;
  counter.value = eventId;
  buffer.push({ id: eventId, type, data, timestamp: Date.now() });
  if (buffer.length > RING_BUFFER_SIZE) buffer.shift();
  return eventId;
}

/** Return events with id > lastEventId from the buffer. */
export function getEventsAfter(
  buffer: RingBufferEvent[],
  lastEventId: number,
): RingBufferEvent[] {
  return buffer.filter((e) => e.id > lastEventId);
}

/**
 * Close and remove stale connections that have been idle longer than
 * CONNECTION_TIMEOUT_MS. Returns the number of connections cleaned up.
 */
export function cleanupStaleConnections(
  connections: Map<string, ExtendedWebSocket>,
): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, ws] of connections.entries()) {
    if (ws.lastActivity && now - ws.lastActivity > CONNECTION_TIMEOUT_MS) {
      safeClose(ws, 1000, "Connection timeout");
      connections.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}

export function safeClose(ws: WebSocket, code?: number, reason?: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed
  }
}

/** Close code sent to suggest the client should reconnect. */
export const RECONNECT_CLOSE_CODE = 4001;

/** Reason string accompanying the reconnect-suggested close. */
export const RECONNECT_CLOSE_REASON = "reconnect-suggested";

/**
 * Send a heartbeat message to all connections and remove any that fail.
 * Returns the number of connections that were removed.
 */
export function broadcastHeartbeat(
  connections: Map<string, ExtendedWebSocket>,
): number {
  const message = JSON.stringify({ type: "heartbeat", timestamp: Date.now() });
  let removed = 0;
  for (const [id, ws] of connections.entries()) {
    try {
      ws.send(message);
    } catch {
      safeClose(ws, RECONNECT_CLOSE_CODE, RECONNECT_CLOSE_REASON);
      connections.delete(id);
      removed++;
    }
  }
  return removed;
}

const INTERNAL_ONLY_HEADERS = [
  "X-Takos-Internal",
  "X-Takos-Internal-Marker",
  "X-WS-Auth-Validated",
  "X-WS-User-Id",
] as const;

/**
 * Build a sanitized header record for Durable Object requests.
 * Strips internal-only headers and applies trusted overrides.
 */
export function buildSanitizedDOHeaders(
  source: HeadersInit | undefined,
  trustedOverrides: Record<string, string>,
): Record<string, string> {
  const headers = new Headers(source);
  for (const name of INTERNAL_ONLY_HEADERS) headers.delete(name);
  for (const [key, value] of Object.entries(trustedOverrides)) {
    headers.set(key, value);
  }
  const result: Record<string, string> = {};
  headers.forEach((v, k) => {
    result[k] = v;
  });
  return result;
}

/** Schedule a cleanup alarm if one is not already set. */
export async function scheduleCleanupAlarm(
  state: DurableObjectState,
): Promise<void> {
  const currentAlarm = await state.storage.getAlarm();
  if (!currentAlarm) {
    await state.storage.setAlarm(Date.now() + 2 * 60 * 1000);
  }
}
