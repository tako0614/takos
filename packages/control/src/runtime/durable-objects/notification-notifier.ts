import { logError, logWarn } from '../../shared/utils/logger';
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
} from './shared';

/** User-scoped notification streaming (WebSocket + ring buffer replay). */
export class NotificationNotifierDO implements DurableObject {
  private state: DurableObjectState;
  private connections: Map<string, ExtendedWebSocket> = new Map();
  private userId: string | null = null;
  private eventBuffer: RingBufferEvent[] = [];
  private eventIdCounter = 0;

  /**
   * Hard cap on WebSocket connections per DO instance.
   * If alarm-based cleanup fails and connections accumulate,
   * new connections are rejected once this limit is reached.
   */
  private static readonly HARD_CONNECTION_CAP = 1000;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      try {
        const stored = await this.state.storage.get<{
          eventBuffer: RingBufferEvent[];
          eventIdCounter: number;
          userId: string | null;
        }>('bufferState');
        if (stored) {
          this.eventBuffer = stored.eventBuffer;
          this.eventIdCounter = stored.eventIdCounter;
          this.userId = stored.userId;
        }
        await scheduleCleanupAlarm(this.state);
      } catch (e) {
        // If storage load fails, start with empty/default state
        // rather than leaving the DO in an undefined state.
        logError('Storage load failed, using default state', e instanceof Error ? e.message : String(e), { module: 'notificationnotifierdo' });
        this.eventBuffer = [];
        this.eventIdCounter = 0;
        this.userId = null;
      }
    });
  }

  async alarm(): Promise<void> {
    cleanupStaleConnections(this.connections);
    broadcastHeartbeat(this.connections);
    if (this.connections.size > 0) {
      await this.state.storage.setAlarm(Date.now() + 2 * 60 * 1000);
    }
  }

  private async persistState(): Promise<void> {
    await this.state.storage.put('bufferState', {
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
      userId: this.userId,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }

    // Internal HTTP endpoints require the internal service header
    const internalCall = request.headers.get('X-Takos-Internal') === '1';
    if (!internalCall) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (path === '/emit' && request.method === 'POST') {
      return this.handleEmit(await request.json());
    }

    if (path === '/events' && request.method === 'GET') {
      const after = parseReplayCursor(url.searchParams.get('after'));
      if (after === null) {
        return jsonResponse({ error: 'Invalid after cursor' }, 400);
      }
      const events = getEventsAfter(this.eventBuffer, after).map((event) => ({
        ...event,
        event_id: String(event.id),
      }));
      return jsonResponse({ events, lastEventId: this.eventIdCounter });
    }

    if (path === '/state' && request.method === 'GET') {
      return jsonResponse({
        userId: this.userId,
        eventCount: this.eventBuffer.length,
        lastEventId: this.eventIdCounter,
        connectionCount: this.connections.size,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    const authValidated = request.headers.get('X-WS-Auth-Validated');
    if (authValidated !== 'true') {
      logWarn('Notification WebSocket attempted without auth validation', { module: 'security' });
      return new Response('Unauthorized', { status: 401 });
    }

    const headerUserId = request.headers.get('X-WS-User-Id');
    if (!headerUserId) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (this.userId && this.userId !== headerUserId) {
      logWarn('NotificationNotifierDO user mismatch', { module: 'security' });
      return new Response('Forbidden', { status: 403 });
    }
    if (!this.userId) {
      this.userId = headerUserId;
      try {
        await this.persistState();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError('persist failed (userId init)', msg, { module: 'notification-notifier' });
        this.userId = null;
        return new Response('Failed to initialize notifier', { status: 500 });
      }
    }

    // Use the tighter HARD_CONNECTION_CAP (not the global MAX_CONNECTIONS)
    // to reject new connections before memory is exhausted, especially
    // when alarm-based cleanup fails to evict stale connections.
    if (this.connections.size >= NotificationNotifierDO.HARD_CONNECTION_CAP) {
      return new Response('Too many connections', { status: 503 });
    }

    const lastEventId = parseReplayCursor(url.searchParams.get('last_event_id'));
    if (lastEventId === null) {
      return jsonResponse({ error: 'Invalid last_event_id' }, 400);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);

    const connectionId = crypto.randomUUID();
    const extendedServer = server as ExtendedWebSocket;
    extendedServer.connectionId = connectionId;
    extendedServer.lastActivity = Date.now();
    this.connections.set(connectionId, extendedServer);

    scheduleCleanupAlarm(this.state).catch((err) => {
      logError('Failed to schedule cleanup alarm', err, { module: 'notificationnotifierdo' });
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
            events: missedEvents.map((event) => ({ ...event, event_id: String(event.id) })),
            count: missedEvents.length,
          },
        }));
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Emit handler wrapped in blockConcurrencyWhile to serialize
   * mutations to eventBuffer, eventIdCounter, and connections map.
   * Without serialization, concurrent emits could assign duplicate
   * event IDs or corrupt the ring buffer.
   */
  private async handleEmit(data: { type: string; data: unknown; event_id?: number | string }): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const preferredEventId = parseEventId(data.event_id);
      const counter = { value: this.eventIdCounter };
      const eventId = addToRingBuffer(this.eventBuffer, counter, data.type, data.data, preferredEventId);
      this.eventIdCounter = counter.value;
      await this.persistState();

      const message = JSON.stringify({
        type: data.type,
        data: data.data,
        eventId,
        event_id: String(eventId),
      });

      for (const [id, ws] of this.connections.entries()) {
        try {
          ws.send(message);
        } catch (e) {
          logError('ws.send failed, dropping connection', id, { module: 'notification-notifier', extra: [':', e instanceof Error ? e.message : String(e)] });
          safeClose(ws, RECONNECT_CLOSE_CODE, RECONNECT_CLOSE_REASON);
          this.connections.delete(id);
        }
      }

      return jsonResponse({ success: true, clients: this.connections.size, eventId });
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    extendedWs.lastActivity = Date.now();

    if (message === 'ping') {
      ws.send('pong');
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    if (extendedWs.connectionId) this.connections.delete(extendedWs.connectionId);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    if (extendedWs.connectionId) {
      logError(`WebSocket error for ${extendedWs.connectionId}`, error, { module: 'durable-objects/notification-notifier' });
      this.connections.delete(extendedWs.connectionId);
    }
  }

}

function parseReplayCursor(value: string | null): number | null {
  if (value === null || value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
