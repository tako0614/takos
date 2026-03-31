/**
 * Abstract base class for notifier Durable Objects that share the
 * WebSocket hibernation pattern, ring-buffer event replay, connection
 * management, and common HTTP endpoint handling (/emit, /events, /state).
 *
 * Subclasses provide domain-specific identity, persistence shape,
 * auth checks, and any extra endpoints or emit-time side effects.
 */
import { logError, logWarn } from '../../shared/utils/logger.ts';
import {
  jsonResponse,
  type RingBufferEvent,
  type ExtendedWebSocket,
  parseEventId,
  addToRingBuffer,
  getEventsAfter,
  cleanupStaleConnections,
  scheduleCleanupAlarm,
  broadcastHeartbeat,
  safeClose,
  RECONNECT_CLOSE_CODE,
  RECONNECT_CLOSE_REASON,
} from './do-header-utils.ts';

export { jsonResponse, type RingBufferEvent, type ExtendedWebSocket };

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

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

export abstract class NotifierBase implements DurableObject {
  protected state: DurableObjectState;
  protected connections: Map<string, ExtendedWebSocket> = new Map();
  protected eventBuffer: RingBufferEvent[] = [];
  protected eventIdCounter = 0;

  /** Human-readable module name used in log messages. */
  protected abstract readonly moduleName: string;

  /** Maximum concurrent WebSocket connections for this notifier type. */
  protected abstract readonly maxConnections: number;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      try {
        await this.loadPersistedState();
        // Rebuild connections map from hibernated WebSockets
        for (const ws of this.state.getWebSockets()) {
          const ext = ws as ExtendedWebSocket;
          const tags = this.state.getTags(ws);
          const connectionId = tags[0] ?? crypto.randomUUID();
          ext.connectionId = connectionId;
          ext.lastActivity = Date.now();
          this.connections.set(connectionId, ext);
        }
      } catch (e) {
        logError(
          'Failed to load persisted state',
          e instanceof Error ? e.message : String(e),
          { module: this.moduleName },
        );
        this.resetState();
      }
    });
  }

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
  protected resetState(): void {
    this.eventBuffer = [];
    this.eventIdCounter = 0;
  }

  // ---------------------------------------------------------------------------
  // Alarm – heartbeat + stale connection cleanup
  // ---------------------------------------------------------------------------

  async alarm(): Promise<void> {
    cleanupStaleConnections(this.connections);
    broadcastHeartbeat(this.connections);
    if (this.connections.size > 0) {
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch – route to endpoints
  // ---------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }

    if (!this.isAuthorizedHttp(request)) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (path === '/emit' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      return this.handleEmit(body as { type: string; data: unknown; event_id?: number | string; [key: string]: unknown });
    }

    if (path === '/events' && request.method === 'GET') {
      return this.handleEventsEndpoint(url);
    }

    if (path === '/state' && request.method === 'GET') {
      return this.handleStateEndpoint();
    }

    return this.handleExtraRoutes(request, url, path) ?? new Response('Not Found', { status: 404 });
  }

  /**
   * Check whether an HTTP request (non-WebSocket) is authorized.
   * Default: allow if X-WS-Auth-Validated or X-Takos-Internal headers present.
   */
  protected isAuthorizedHttp(request: Request): boolean {
    const wsAuthValidated = request.headers.get('X-WS-Auth-Validated') === 'true';
    const internalCall = request.headers.get('X-Takos-Internal') === '1';
    return wsAuthValidated || internalCall;
  }

  /**
   * Override to add domain-specific HTTP routes.
   * Return null to fall through to 404.
   */
  protected handleExtraRoutes(_request: Request, _url: URL, _path: string): Response | Promise<Response> | null {
    return null;
  }

  // ---------------------------------------------------------------------------
  // /events endpoint
  // ---------------------------------------------------------------------------

  /**
   * Parse the replay cursor from the `after` (or `last_event_id`) query param.
   * Override to add stricter validation. Return null to signal invalid input.
   */
  protected parseReplayAfter(raw: string | null): number | null {
    return parseInt(raw || '0');
  }

  /**
   * Map a ring buffer event to the shape returned by /events.
   * Subclasses can override to add or remove fields.
   */
  protected mapEventForHttp(event: RingBufferEvent): Record<string, unknown> {
    return {
      ...event,
      event_id: String(event.id),
      created_at: new Date(event.timestamp).toISOString(),
    };
  }

  private handleEventsEndpoint(url: URL): Response {
    const after = this.parseReplayAfter(url.searchParams.get('after'));
    if (after === null) {
      return jsonResponse({ error: 'Invalid after cursor' }, 400);
    }
    const events = getEventsAfter(this.eventBuffer, after).map((e) => this.mapEventForHttp(e));
    return jsonResponse({ events, lastEventId: this.eventIdCounter });
  }

  // ---------------------------------------------------------------------------
  // /state endpoint
  // ---------------------------------------------------------------------------

  /** Extra fields merged into the /state response. */
  protected getStateExtra(): Record<string, unknown> {
    return {};
  }

  private handleStateEndpoint(): Response {
    return jsonResponse({
      eventCount: this.eventBuffer.length,
      lastEventId: this.eventIdCounter,
      connectionCount: this.connections.size,
      ...this.getStateExtra(),
    });
  }

  // ---------------------------------------------------------------------------
  // WebSocket handling
  // ---------------------------------------------------------------------------

  /**
   * Perform domain-specific auth and setup before accepting a WebSocket.
   * Return a Response to reject the connection, or null to proceed.
   * Tags returned will be passed to `acceptWebSocket`.
   */
  protected abstract validateWebSocket(request: Request, url: URL): Promise<{ reject?: Response; tags?: string[] }>;

  /**
   * Map a ring buffer event to the shape sent in WebSocket replay messages.
   * Defaults to the same shape as HTTP /events.
   */
  protected mapEventForWs(event: RingBufferEvent): Record<string, unknown> {
    return this.mapEventForHttp(event);
  }

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    const authValidated = request.headers.get('X-WS-Auth-Validated');
    if (authValidated !== 'true') {
      logWarn('WebSocket connection attempted without auth validation', { module: 'security' });
      return new Response('Unauthorized', { status: 401 });
    }

    const validation = await this.validateWebSocket(request, url);
    if (validation.reject) return validation.reject;

    if (this.connections.size >= this.maxConnections) {
      return new Response('Too many connections', { status: 503 });
    }

    const lastEventIdRaw = url.searchParams.get('last_event_id');
    const lastEventId = this.parseWsLastEventId(lastEventIdRaw);
    if (lastEventId === null) {
      return jsonResponse({ error: 'Invalid last_event_id' }, 400);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connectionId = crypto.randomUUID();
    const tags = validation.tags ? [connectionId, ...validation.tags] : [connectionId];
    this.state.acceptWebSocket(server, tags);

    const extendedServer = server as ExtendedWebSocket;
    extendedServer.connectionId = connectionId;
    extendedServer.lastActivity = Date.now();
    this.connections.set(connectionId, extendedServer);

    scheduleCleanupAlarm(this.state).catch((err) => {
      logError('Failed to schedule alarm', err, { module: this.moduleName });
    });

    server.send(JSON.stringify({
      type: 'connected',
      data: { connectionId, lastEventId: this.eventIdCounter },
    }));

    if (lastEventId > 0) {
      const missedEvents = getEventsAfter(this.eventBuffer, lastEventId);
      if (missedEvents.length > 0) {
        server.send(JSON.stringify({
          type: 'replay',
          data: {
            events: missedEvents.map((e) => this.mapEventForWs(e)),
            count: missedEvents.length,
          },
        }));
      }
    }

    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  /**
   * Parse the last_event_id query parameter for WebSocket connections.
   * Return null to reject the connection with a 400 error.
   * Default: parse as integer, defaulting to 0 if absent.
   */
  protected parseWsLastEventId(raw: string | null): number | null {
    return parseInt(raw || '0');
  }

  // ---------------------------------------------------------------------------
  // Hibernation API handlers
  // ---------------------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    extendedWs.lastActivity = Date.now();

    if (message === 'ping') {
      ws.send('pong');
      return;
    }

    if (typeof message === 'string') {
      await this.handleWsMessage(ws, message);
    }
  }

  /**
   * Handle a parsed string WebSocket message beyond ping/pong.
   * Override in subclasses to add domain-specific message handling.
   */
  protected async handleWsMessage(_ws: WebSocket, _message: string): Promise<void> {
    // No-op by default
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    if (extendedWs.connectionId) {
      this.connections.delete(extendedWs.connectionId);
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    if (extendedWs.connectionId) {
      logError(
        `WebSocket error for ${extendedWs.connectionId}`,
        error,
        { module: this.moduleName },
      );
      this.connections.delete(extendedWs.connectionId);
    }
  }

  // ---------------------------------------------------------------------------
  // Emit
  // ---------------------------------------------------------------------------

  /**
   * Core emit logic. Subclasses override `validateEmit` for pre-buffer
   * validation and `processEmit` for domain side effects.
   */
  private async handleEmit(input: { type: string; data: unknown; event_id?: number | string; [key: string]: unknown }): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      if (typeof input.type !== 'string' || input.type.length === 0 || input.type.length > 256) {
        return jsonResponse({ success: false, error: 'Invalid type' }, 400);
      }

      const serializedData = JSON.stringify(input.data);
      if (serializedData.length >= 1_048_576) {
        return jsonResponse({ success: false, error: 'Data too large' }, 400);
      }

      // Domain-specific validation before mutating state
      const rejection = await this.validateEmit(input);
      if (rejection) return rejection;

      const preferredEventId = parseEventId(input.event_id);
      const counter = { value: this.eventIdCounter };
      const eventId = addToRingBuffer(this.eventBuffer, counter, input.type, input.data, preferredEventId);
      this.eventIdCounter = counter.value;

      // Let the subclass perform domain-specific side effects and build the broadcast message
      const result = await this.processEmit(input, eventId);

      await this.persistState();

      const clientCount = this.broadcastMessage(result.broadcastMessage);

      return jsonResponse({
        success: true,
        clients: clientCount,
        eventId,
        ...result.extraResponse,
      });
    });
  }

  /**
   * Domain-specific validation before mutating state.
   * Return a Response to reject, or null/undefined to proceed.
   * Default: no extra validation.
   */
  protected async validateEmit(
    _input: { type: string; data: unknown; event_id?: number | string; [key: string]: unknown },
  ): Promise<Response | null | undefined> {
    return null;
  }

  /**
   * Domain-specific emit processing. Called inside blockConcurrencyWhile
   * after the event has been added to the ring buffer but before persist/broadcast.
   *
   * Return the broadcast message string and optional extra response fields.
   */
  protected abstract processEmit(
    input: { type: string; data: unknown; event_id?: number | string; [key: string]: unknown },
    eventId: number,
  ): Promise<EmitResult>;

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  protected broadcastMessage(message: string): number {
    let sent = 0;
    for (const [id, ws] of this.connections.entries()) {
      try {
        ws.send(message);
        sent++;
      } catch {
        safeClose(ws, RECONNECT_CLOSE_CODE, RECONNECT_CLOSE_REASON);
        this.connections.delete(id);
      }
    }
    return sent;
  }
}
