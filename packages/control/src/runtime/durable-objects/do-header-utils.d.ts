/** Shared types and helpers for Durable Object implementations. */
export declare function jsonResponse(data: unknown, status?: number): Response;
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
export declare const RING_BUFFER_SIZE = 100;
/** Idle timeout before a WebSocket is considered stale (5 minutes). */
export declare const CONNECTION_TIMEOUT_MS: number;
/** Hard cap on concurrent WebSocket connections per DO instance. */
export declare const MAX_CONNECTIONS = 10000;
/**
 * Parse a value that may be a numeric event ID.
 * Returns the floored integer when positive and finite, otherwise null.
 */
export declare function parseEventId(value: unknown): number | null;
/**
 * Append an event to a ring buffer and return the assigned event ID.
 * Mutates buffer and advances counter.value as a side-effect.
 */
export declare function addToRingBuffer(buffer: RingBufferEvent[], counter: {
    value: number;
}, type: string, data: unknown, preferredEventId?: number | null): number;
/** Return events with id > lastEventId from the buffer. */
export declare function getEventsAfter(buffer: RingBufferEvent[], lastEventId: number): RingBufferEvent[];
/**
 * Close and remove stale connections that have been idle longer than
 * CONNECTION_TIMEOUT_MS. Returns the number of connections cleaned up.
 */
export declare function cleanupStaleConnections(connections: Map<string, ExtendedWebSocket>): number;
export declare function safeClose(ws: WebSocket, code?: number, reason?: string): void;
/** Close code sent to suggest the client should reconnect. */
export declare const RECONNECT_CLOSE_CODE = 4001;
/** Reason string accompanying the reconnect-suggested close. */
export declare const RECONNECT_CLOSE_REASON = "reconnect-suggested";
/**
 * Send a heartbeat message to all connections and remove any that fail.
 * Returns the number of connections that were removed.
 */
export declare function broadcastHeartbeat(connections: Map<string, ExtendedWebSocket>): number;
/** Schedule a cleanup alarm if one is not already set. */
export declare function scheduleCleanupAlarm(state: DurableObjectState): Promise<void>;
//# sourceMappingURL=do-header-utils.d.ts.map