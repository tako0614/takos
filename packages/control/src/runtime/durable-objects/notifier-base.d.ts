import { jsonResponse, type RingBufferEvent, type ExtendedWebSocket } from './do-header-utils';
export { jsonResponse, type RingBufferEvent, type ExtendedWebSocket };
/**
 * Result returned by the subclass after processing a validated emit.
 * The base class handles broadcasting and returning the HTTP response.
 */
export interface EmitResult {
    /** The message JSON string to broadcast to all connected clients. */
    broadcastMessage: string;
    /** Extra fields merged into the success response body. */
    extraResponse?: Record<string, unknown>;
}
export declare abstract class NotifierBase implements DurableObject {
    protected state: DurableObjectState;
    protected connections: Map<string, ExtendedWebSocket>;
    protected eventBuffer: RingBufferEvent[];
    protected eventIdCounter: number;
    /** Human-readable module name used in log messages. */
    protected abstract readonly moduleName: string;
    /** Maximum concurrent WebSocket connections for this notifier type. */
    protected abstract readonly maxConnections: number;
    constructor(state: DurableObjectState);
    /**
     * Load domain-specific persisted state from DO storage.
     * The base fields (eventBuffer, eventIdCounter) must be restored here.
     */
    protected abstract loadPersistedState(): Promise<void>;
    /** Persist the full in-memory state to DO storage. */
    protected abstract persistState(): Promise<void>;
    /**
     * Reset state to defaults when storage load fails.
     * Subclasses should reset their own fields and call super.
     */
    protected resetState(): void;
    alarm(): Promise<void>;
    fetch(request: Request): Promise<Response>;
    /**
     * Check whether an HTTP request (non-WebSocket) is authorized.
     * Default: allow if X-WS-Auth-Validated or X-Takos-Internal headers present.
     */
    protected isAuthorizedHttp(request: Request): boolean;
    /**
     * Override to add domain-specific HTTP routes.
     * Return null to fall through to 404.
     */
    protected handleExtraRoutes(_request: Request, _url: URL, _path: string): Response | Promise<Response> | null;
    /**
     * Parse the replay cursor from the `after` (or `last_event_id`) query param.
     * Override to add stricter validation. Return null to signal invalid input.
     */
    protected parseReplayAfter(raw: string | null): number | null;
    /**
     * Map a ring buffer event to the shape returned by /events.
     * Subclasses can override to add or remove fields.
     */
    protected mapEventForHttp(event: RingBufferEvent): Record<string, unknown>;
    private handleEventsEndpoint;
    /** Extra fields merged into the /state response. */
    protected getStateExtra(): Record<string, unknown>;
    private handleStateEndpoint;
    /**
     * Perform domain-specific auth and setup before accepting a WebSocket.
     * Return a Response to reject the connection, or null to proceed.
     * Tags returned will be passed to `acceptWebSocket`.
     */
    protected abstract validateWebSocket(request: Request, url: URL): Promise<{
        reject?: Response;
        tags?: string[];
    }>;
    /**
     * Map a ring buffer event to the shape sent in WebSocket replay messages.
     * Defaults to the same shape as HTTP /events.
     */
    protected mapEventForWs(event: RingBufferEvent): Record<string, unknown>;
    private handleWebSocket;
    /**
     * Parse the last_event_id query parameter for WebSocket connections.
     * Return null to reject the connection with a 400 error.
     * Default: parse as integer, defaulting to 0 if absent.
     */
    protected parseWsLastEventId(raw: string | null): number | null;
    webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>;
    /**
     * Handle a parsed string WebSocket message beyond ping/pong.
     * Override in subclasses to add domain-specific message handling.
     */
    protected handleWsMessage(_ws: WebSocket, _message: string): Promise<void>;
    webSocketClose(ws: WebSocket): Promise<void>;
    webSocketError(ws: WebSocket, error: unknown): Promise<void>;
    /**
     * Core emit logic. Subclasses override `processEmit` for domain side effects.
     */
    private handleEmit;
    /**
     * Domain-specific emit processing. Called inside blockConcurrencyWhile
     * after the event has been added to the ring buffer but before persist/broadcast.
     *
     * Return the broadcast message string and optional extra response fields.
     */
    protected abstract processEmit(input: {
        type: string;
        data: unknown;
        event_id?: number | string;
        [key: string]: unknown;
    }, eventId: number): Promise<EmitResult>;
    protected broadcastMessage(message: string): number;
}
//# sourceMappingURL=notifier-base.d.ts.map