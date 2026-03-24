import type { D1Database, R2Bucket } from '../../shared/types/bindings.ts';
import type { Env } from '../../shared/types';
import { getDb, runs } from '../../infra/db';
import { eq } from 'drizzle-orm';
import type { PersistedRunEvent } from '../../application/services/offload/run-events';
import { RUN_TERMINAL_EVENT_TYPES } from '../../application/services/run-notifier';
import type { RunTerminalEventType } from '../../application/services/run-notifier/run-events-contract';
import { RUN_EVENT_SEGMENT_SIZE, segmentIndexForEventId, writeRunEventSegmentToR2 } from '../../application/services/offload/run-events';
import type { PersistedUsageEvent } from '../../application/services/offload/usage-events';
import { USAGE_EVENT_SEGMENT_SIZE, writeUsageEventSegmentToR2 } from '../../application/services/offload/usage-events';
import { logError, logWarn } from '../../shared/utils/logger';
import {
  jsonResponse,
  type RingBufferEvent,
  type ExtendedWebSocket,
  MAX_CONNECTIONS,
  parseEventId,
  addToRingBuffer,
  getEventsAfter,
  safeClose,
  RECONNECT_CLOSE_CODE,
  RECONNECT_CLOSE_REASON,
} from './shared';

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
const CONNECTION_TIMEOUT_MS = 5 * 60 * 1000;

export class RunNotifierDO implements DurableObject {
  private state: DurableObjectState;
  private db: D1Database;
  private offloadBucket: R2Bucket | undefined;
  private connections: Map<string, ExtendedWebSocket> = new Map();
  private runId: string | null = null;
  private eventBuffer: RingBufferEvent[] = [];
  private eventIdCounter: number = 0;

  private r2SegmentIndex: number = 1;
  private r2SegmentBuffer: PersistedRunEvent[] = [];
  private r2LastFlushedSegmentIndex: number = 0;

  private usageSegmentIndex: number = 1;
  private usageSegmentBuffer: PersistedUsageEvent[] = [];
  private usageLastFlushedSegmentIndex: number = 0;

  /**
   * Hard cap on segment buffer sizes to prevent unbounded growth
   * if R2 writes consistently fail. When the cap is reached, oldest
   * entries are dropped and a warning is logged.
   */
  private static readonly MAX_SEGMENT_BUFFER_SIZE = 10_000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.db = env.DB;
    this.offloadBucket = env.TAKOS_OFFLOAD;
    this.state.blockConcurrencyWhile(async () => {
      try {
        const stored = await this.state.storage.get<{
          eventBuffer: RingBufferEvent[];
          eventIdCounter: number;
          runId: string | null;
          r2SegmentIndex?: number;
          r2SegmentBuffer?: PersistedRunEvent[];
          r2LastFlushedSegmentIndex?: number;
          usageSegmentIndex?: number;
          usageSegmentBuffer?: PersistedUsageEvent[];
          usageLastFlushedSegmentIndex?: number;
        }>('bufferState');
        if (stored) {
          this.eventBuffer = stored.eventBuffer;
          this.eventIdCounter = stored.eventIdCounter;
          this.runId = stored.runId;
          this.r2SegmentIndex = stored.r2SegmentIndex ?? this.r2SegmentIndex;
          this.r2SegmentBuffer = stored.r2SegmentBuffer ?? this.r2SegmentBuffer;
          this.r2LastFlushedSegmentIndex = stored.r2LastFlushedSegmentIndex ?? this.r2LastFlushedSegmentIndex;
          this.usageSegmentIndex = stored.usageSegmentIndex ?? this.usageSegmentIndex;
          this.usageSegmentBuffer = stored.usageSegmentBuffer ?? this.usageSegmentBuffer;
          this.usageLastFlushedSegmentIndex = stored.usageLastFlushedSegmentIndex ?? this.usageLastFlushedSegmentIndex;
        }
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
        logError('Failed to load persisted state', e instanceof Error ? e.message : String(e), { module: 'run-notifier' });
      }
    });
  }

  async alarm(): Promise<void> {
    this.cleanupStaleConnections();
    // Heartbeat: JSON heartbeat message to keep connections alive
    this.broadcastHeartbeat();

    if (this.connections.size > 0) {
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    }
  }

  // Post-connection access revocation relies on the 5-minute idle timeout rather
  // than periodic alarm-based re-auth checks, which would consume excessive DO
  // resources for marginal security benefit.
  private cleanupStaleConnections(): void {
    const now = Date.now();
    for (const [id, ws] of this.connections.entries()) {
      if (ws.lastActivity && now - ws.lastActivity > CONNECTION_TIMEOUT_MS) {
        safeClose(ws, 1000, 'Connection timeout');
        this.connections.delete(id);
      }
    }
  }

  private broadcastHeartbeat(): void {
    const message = JSON.stringify({ type: 'heartbeat', timestamp: Date.now() });
    for (const [id, ws] of this.connections.entries()) {
      try {
        ws.send(message);
      } catch {
        safeClose(ws, RECONNECT_CLOSE_CODE, RECONNECT_CLOSE_REASON);
        this.connections.delete(id);
      }
    }
  }

  private broadcastMessage(message: string): number {
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

  private async scheduleAlarm(): Promise<void> {
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm) {
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    }
  }

  private async persistState(): Promise<void> {
    await this.state.storage.put('bufferState', {
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
      runId: this.runId,
      r2SegmentIndex: this.r2SegmentIndex,
      r2SegmentBuffer: this.r2SegmentBuffer,
      r2LastFlushedSegmentIndex: this.r2LastFlushedSegmentIndex,
      usageSegmentIndex: this.usageSegmentIndex,
      usageSegmentBuffer: this.usageSegmentBuffer,
      usageLastFlushedSegmentIndex: this.usageLastFlushedSegmentIndex,
    });
  }

  /**
   * Enforce the hard cap on a segment buffer. If the buffer exceeds
   * MAX_SEGMENT_BUFFER_SIZE, the oldest entries are dropped to make room.
   * This prevents unbounded memory growth when R2 writes repeatedly fail.
   */
  private enforceSegmentBufferCap<T>(buffer: T[], label: string): T[] {
    if (buffer.length <= RunNotifierDO.MAX_SEGMENT_BUFFER_SIZE) return buffer;
    const excess = buffer.length - RunNotifierDO.MAX_SEGMENT_BUFFER_SIZE;
    logWarn(`${label} exceeded max size (${buffer.length}), dropping ${excess} oldest entries`, { module: 'runnotifierdo' });
    return buffer.slice(excess);
  }

  private stringifyPersistedData(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private isSegmentBoundaryOrTerminal(eventId: number, type: string): boolean {
    if (!Number.isFinite(eventId) || eventId <= 0) return false;
    if (eventId % RUN_EVENT_SEGMENT_SIZE === 0) return true;
    return RUN_TERMINAL_EVENT_TYPES.has(type as RunTerminalEventType);
  }

  private async flushR2Segment(segmentIndex: number, events: PersistedRunEvent[]): Promise<void> {
    if (!this.offloadBucket) return;
    if (!this.runId) return;
    if (events.length === 0) return;
    if (segmentIndex <= this.r2LastFlushedSegmentIndex) return;

    await writeRunEventSegmentToR2(this.offloadBucket, this.runId, segmentIndex, events);
    this.r2LastFlushedSegmentIndex = Math.max(this.r2LastFlushedSegmentIndex, segmentIndex);
  }

  private async flushUsageSegment(segmentIndex: number, events: PersistedUsageEvent[]): Promise<void> {
    if (!this.offloadBucket) return;
    if (!this.runId) return;
    if (events.length === 0) return;
    if (segmentIndex <= this.usageLastFlushedSegmentIndex) return;

    await writeUsageEventSegmentToR2(this.offloadBucket, this.runId, segmentIndex, events);
    this.usageLastFlushedSegmentIndex = Math.max(this.usageLastFlushedSegmentIndex, segmentIndex);
  }

  private async persistLastEventId(eventId: number): Promise<void> {
    if (!this.runId) return;
    try {
      const db = getDb(this.db);
      await db.update(runs).set({ lastEventId: eventId })
        .where(eq(runs.id, this.runId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn('Failed to persist last_event_id', { module: 'runnotifierdo', detail: message });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }

    // Internal HTTP endpoints require either WebSocket auth or internal service header
    const wsAuthValidated = request.headers.get('X-WS-Auth-Validated') === 'true';
    const internalCall = request.headers.get('X-Takos-Internal') === '1';
    if (!wsAuthValidated && !internalCall) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (path === '/emit' && request.method === 'POST') {
      let body;
      try { body = await request.json() as Parameters<typeof this.handleEmit>[0]; } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
      return this.handleEmit(body);
    }

    if (path === '/usage' && request.method === 'POST') {
      let body;
      try { body = await request.json() as Parameters<typeof this.handleUsage>[0]; } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
      return this.handleUsage(body);
    }

    if (path === '/events' && request.method === 'GET') {
      const lastEventId = parseInt(url.searchParams.get('after') || '0');
      const events = getEventsAfter(this.eventBuffer, lastEventId).map((event) => ({
        ...event,
        event_id: String(event.id),
        created_at: new Date(event.timestamp).toISOString(),
      }));
      return jsonResponse({ events, lastEventId: this.eventIdCounter });
    }

    if (path === '/state' && request.method === 'GET') {
      return jsonResponse({
        runId: this.runId,
        eventCount: this.eventBuffer.length,
        lastEventId: this.eventIdCounter,
        connectionCount: this.connections.size,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  private handleWebSocket(request: Request, url: URL): Response {
    const authValidated = request.headers.get('X-WS-Auth-Validated');
    if (authValidated !== 'true') {
      logWarn('WebSocket connection attempted without auth validation', { module: 'security' });
      return new Response('Unauthorized', { status: 401 });
    }

    if (this.connections.size >= MAX_CONNECTIONS) {
      return new Response('Too many connections', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connectionId = crypto.randomUUID();

    // Use Hibernation API — acceptWebSocket with tag for connection tracking.
    // This allows the DO to be unloaded when idle, reducing costs.
    this.state.acceptWebSocket(server, [connectionId]);

    const extendedServer = server as ExtendedWebSocket;
    extendedServer.connectionId = connectionId;
    extendedServer.lastActivity = Date.now();
    this.connections.set(connectionId, extendedServer);

    this.scheduleAlarm().catch(err => {
      logError('Failed to schedule alarm', err, { module: 'runnotifierdo' });
    });

    const lastEventId = parseInt(url.searchParams.get('last_event_id') || '0');

    server.send(JSON.stringify({
      type: 'connected',
      data: {
        connectionId,
        lastEventId: this.eventIdCounter,
      },
    }));

    if (lastEventId > 0) {
      const missedEvents = getEventsAfter(this.eventBuffer, lastEventId);
      if (missedEvents.length > 0) {
        server.send(JSON.stringify({
          type: 'replay',
          data: {
            events: missedEvents.map((event) => ({
              ...event,
              event_id: String(event.id),
              created_at: new Date(event.timestamp).toISOString(),
            })),
            count: missedEvents.length,
          },
        }));
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // Hibernation API handler: incoming WebSocket messages
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    extendedWs.lastActivity = Date.now();

    if (message === 'ping') {
      ws.send('pong');
      return;
    }

    if (typeof message !== 'string') return;

    try {
      const raw = JSON.parse(message) as Record<string, unknown>;
      if (raw.type === 'subscribe' && typeof raw.runId === 'string' && raw.runId) {
        // runId can only be set via /emit (internal service call), not from client subscribe
        if (this.runId && raw.runId !== this.runId) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'runId mismatch' },
          }));
          return;
        }
        ws.send(JSON.stringify({
          type: 'subscribed',
          data: { runId: this.runId ?? raw.runId },
        }));
      }
    } catch {
      // ignore parse errors
    }
  }

  // Hibernation API handler: WebSocket close
  async webSocketClose(ws: WebSocket): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    if (extendedWs.connectionId) {
      this.connections.delete(extendedWs.connectionId);
    }
  }

  // Hibernation API handler: WebSocket error
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const extendedWs = ws as ExtendedWebSocket;
    if (extendedWs.connectionId) {
      logError(`WebSocket error for ${extendedWs.connectionId}`, error, { module: 'runnotifierdo' });
      this.connections.delete(extendedWs.connectionId);
    }
  }

  private async handleEmit(input: { type: string; data: unknown; runId?: string; event_id?: number | string }): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      if (input.runId !== undefined) {
        if (typeof input.runId !== 'string' || input.runId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(input.runId)) {
          return jsonResponse({ success: false, error: 'Invalid runId' }, 400);
        }
      }

      if (typeof input.type !== 'string' || input.type.length === 0 || input.type.length > 256) {
        return jsonResponse({ success: false, error: 'Invalid type' }, 400);
      }

      const serializedData = JSON.stringify(input.data);
      if (serializedData.length >= 1_048_576) {
        return jsonResponse({ success: false, error: 'Data too large' }, 400);
      }

      if (!this.runId && typeof input.runId === 'string' && input.runId.trim()) {
        this.runId = input.runId.trim();
      }

      const preferredEventId = parseEventId(input.event_id);
      const counter = { value: this.eventIdCounter };
      const eventId = addToRingBuffer(this.eventBuffer, counter, input.type, input.data, preferredEventId);
      this.eventIdCounter = counter.value;
      const emittedAt = new Date().toISOString();

      // Only buffer for R2 when offload is configured -- without a bucket the
      // buffer would grow unboundedly and waste DO storage.
      if (this.offloadBucket) {
        const newEntry: PersistedRunEvent = {
          event_id: eventId,
          type: input.type,
          data: this.stringifyPersistedData(input.data),
          created_at: emittedAt,
        };

        // Flush the previous segment to R2 when the segment index changes.
        // On flush failure, keep the buffer so it can be retried on next emit;
        // only clear the buffer after a successful write.
        const segmentIndex = segmentIndexForEventId(eventId);
        if (segmentIndex !== this.r2SegmentIndex) {
          const prevBuffer = this.r2SegmentBuffer;
          const prevIndex = this.r2SegmentIndex;
          try {
            await this.flushR2Segment(prevIndex, prevBuffer);
            // Flush succeeded -- clear the old segment buffer and advance.
            this.r2SegmentBuffer = [];
          } catch (err) {
            // Flush failed -- keep the buffer contents so they can be
            // retried. Enforce the cap to prevent unbounded growth.
            logWarn('R2 segment flush failed, keeping buffer for retry', { module: 'runnotifierdo', detail: err });
            this.r2SegmentBuffer = this.enforceSegmentBufferCap(this.r2SegmentBuffer, 'r2SegmentBuffer');
          }
          this.r2SegmentIndex = segmentIndex;
        }

        this.r2SegmentBuffer.push(newEntry);

        if (this.isSegmentBoundaryOrTerminal(eventId, input.type)) {
          try {
            await this.flushR2Segment(this.r2SegmentIndex, this.r2SegmentBuffer);
            this.r2SegmentBuffer = [];
            this.r2SegmentIndex = segmentIndexForEventId(eventId + 1);
          } catch (err) {
            logWarn('R2 boundary/terminal flush failed', { module: 'runnotifierdo', detail: err });
            this.r2SegmentBuffer = this.enforceSegmentBufferCap(this.r2SegmentBuffer, 'r2SegmentBuffer');
          }
        }

        // Enforce cap on r2SegmentBuffer in case flushes keep failing.
        this.r2SegmentBuffer = this.enforceSegmentBufferCap(this.r2SegmentBuffer, 'r2SegmentBuffer');
      }

      if (this.isSegmentBoundaryOrTerminal(eventId, input.type)) {
        this.persistLastEventId(eventId).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logWarn('Best-effort D1 last_event_id update failed', { module: 'runnotifierdo', detail: msg });
        });
      }

      if (RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType)) {
        if (this.usageSegmentBuffer.length > 0) {
          try {
            await this.flushUsageSegment(this.usageSegmentIndex, this.usageSegmentBuffer);
            this.usageSegmentBuffer = [];
            this.usageSegmentIndex = this.usageSegmentIndex + 1;
          } catch (err) {
            logWarn('Usage segment flush on terminal event failed', { module: 'runnotifierdo', detail: err });
            this.usageSegmentBuffer = this.enforceSegmentBufferCap(this.usageSegmentBuffer, 'usageSegmentBuffer');
          }
        }
      }

      // Persist in-memory state to DO storage
      await this.persistState();

      // Broadcast to all connected WebSocket clients
      const messageWithId = JSON.stringify({
        type: input.type,
        data: input.data,
        eventId,
        event_id: String(eventId),
        created_at: emittedAt,
      });

      const clientCount = this.broadcastMessage(messageWithId);

      return jsonResponse({
        success: true,
        clients: clientCount,
        eventId,
      });
    });
  }

  private async handleUsage(input: {
    runId?: string;
    meter_type?: unknown;
    units?: unknown;
    reference_type?: unknown;
    metadata?: unknown;
  }): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      if (!this.runId && typeof input.runId === 'string' && input.runId.trim()) {
        this.runId = input.runId.trim();
      }

      const meterType = typeof input.meter_type === 'string' ? input.meter_type.trim() : '';
      const units = typeof input.units === 'number' ? input.units : parseFloat(String(input.units ?? ''));

      if (!meterType) {
        return jsonResponse({ success: false, error: 'meter_type is required' });
      }

      if (!Number.isFinite(units) || units <= 0) {
        return jsonResponse({ success: false, error: 'units must be positive' });
      }

      const metadataStr = input.metadata === undefined
        ? null
        : this.stringifyPersistedData(input.metadata);

      this.usageSegmentBuffer.push({
        meter_type: meterType,
        units,
        reference_type: typeof input.reference_type === 'string' ? input.reference_type : null,
        metadata: metadataStr,
        created_at: new Date().toISOString(),
      });

      if (this.usageSegmentBuffer.length >= USAGE_EVENT_SEGMENT_SIZE) {
        try {
          await this.flushUsageSegment(this.usageSegmentIndex, this.usageSegmentBuffer);
          this.usageSegmentBuffer = [];
          this.usageSegmentIndex = this.usageSegmentIndex + 1;
        } catch (err) {
          // Flush failed -- keep buffer for retry but enforce the cap
          // to prevent unbounded memory growth.
          logWarn('Usage segment flush failed', { module: 'runnotifierdo', detail: err });
          this.usageSegmentBuffer = this.enforceSegmentBufferCap(this.usageSegmentBuffer, 'usageSegmentBuffer');
        }
      }

      // Persist state first, then flush to R2 (clear buffer only on success).
      await this.persistState();

      return jsonResponse({ success: true });
    });
  }
}
