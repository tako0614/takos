import type { D1Database, R2Bucket } from '../../shared/types/bindings.ts';
import type { Env } from '../../shared/types/index.ts';
import { getDb, runs } from '../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import type { PersistedRunEvent } from '../../application/services/offload/run-events.ts';
import { RUN_TERMINAL_EVENT_TYPES } from '../../application/services/run-notifier/index.ts';
import type { RunTerminalEventType } from '../../application/services/run-notifier/run-events-contract.ts';
import { RUN_EVENT_SEGMENT_SIZE, segmentIndexForEventId, writeRunEventSegmentToR2 } from '../../application/services/offload/run-events.ts';
import type { PersistedUsageEvent } from '../../application/services/offload/usage-events.ts';
import { USAGE_EVENT_SEGMENT_SIZE, writeUsageEventSegmentToR2 } from '../../application/services/offload/usage-events.ts';
import { logWarn } from '../../shared/utils/logger.ts';
import { NotifierBase, jsonResponse, type EmitResult, type RingBufferEvent } from './notifier-base.ts';
import { MAX_CONNECTIONS } from './do-header-utils.ts';

export class RunNotifierDO extends NotifierBase {
  protected readonly moduleName = 'runnotifierdo';
  protected readonly maxConnections = MAX_CONNECTIONS;

  private db: D1Database;
  private offloadBucket: R2Bucket | undefined;
  private runId: string | null = null;

  private r2SegmentIndex = 1;
  private r2SegmentBuffer: PersistedRunEvent[] = [];
  private r2LastFlushedSegmentIndex = 0;

  private usageSegmentIndex = 1;
  private usageSegmentBuffer: PersistedUsageEvent[] = [];
  private usageLastFlushedSegmentIndex = 0;

  /**
   * Hard cap on segment buffer sizes to prevent unbounded growth
   * if R2 writes consistently fail. When the cap is reached, oldest
   * entries are dropped and a warning is logged.
   */
  private static readonly MAX_SEGMENT_BUFFER_SIZE = 10_000;

  constructor(state: DurableObjectState, env: Env) {
    super(state);
    this.db = env.DB;
    this.offloadBucket = env.TAKOS_OFFLOAD;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  protected async loadPersistedState(): Promise<void> {
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
  }

  protected async persistState(): Promise<void> {
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

  // ---------------------------------------------------------------------------
  // WebSocket – domain-specific auth & subscribe message
  // ---------------------------------------------------------------------------

  protected override async validateWebSocket(_request: Request, _url: URL): Promise<{ reject?: Response; tags?: string[] }> {
    // RunNotifier does not perform extra validation beyond the base auth check
    return {};
  }

  protected override async handleWsMessage(ws: WebSocket, message: string): Promise<void> {
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

  // ---------------------------------------------------------------------------
  // Extra routes (/usage)
  // ---------------------------------------------------------------------------

  protected override handleExtraRoutes(request: Request, _url: URL, path: string): Response | Promise<Response> | null {
    if (path === '/usage' && request.method === 'POST') {
      return (async () => {
        let body;
        try {
          body = await request.json() as Parameters<typeof this.handleUsage>[0];
        } catch {
          return jsonResponse({ error: 'Invalid JSON' }, 400);
        }
        return this.handleUsage(body);
      })();
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Emit – validation, R2 offload, D1 last_event_id
  // ---------------------------------------------------------------------------

  protected override async validateEmit(
    input: { type: string; data: unknown; runId?: string; [key: string]: unknown },
  ): Promise<Response | null> {
    if (input.runId !== undefined) {
      if (typeof input.runId !== 'string' || input.runId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(input.runId)) {
        return jsonResponse({ success: false, error: 'Invalid runId' }, 400);
      }
    }
    return null;
  }

  protected override async processEmit(
    input: { type: string; data: unknown; runId?: string; [key: string]: unknown },
    eventId: number,
  ): Promise<EmitResult> {
    if (!this.runId && typeof input.runId === 'string' && input.runId.trim()) {
      this.runId = input.runId.trim();
    }

    const emittedAt = new Date().toISOString();

    // R2 offload
    if (this.offloadBucket) {
      await this.handleR2Offload(eventId, input.type, input.data, emittedAt);
    }

    // D1 last_event_id at segment boundaries or terminal events
    if (this.isSegmentBoundaryOrTerminal(eventId, input.type)) {
      this.persistLastEventId(eventId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn('Best-effort D1 last_event_id update failed', { module: 'runnotifierdo', detail: msg });
      });
    }

    // Flush usage buffer on terminal events
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

    const broadcastMessage = JSON.stringify({
      type: input.type,
      data: input.data,
      eventId,
      event_id: String(eventId),
      created_at: emittedAt,
    });

    return { broadcastMessage };
  }

  // ---------------------------------------------------------------------------
  // /state extra
  // ---------------------------------------------------------------------------

  protected override getStateExtra(): Record<string, unknown> {
    return { runId: this.runId };
  }

  // ---------------------------------------------------------------------------
  // R2 offload helpers
  // ---------------------------------------------------------------------------

  private async handleR2Offload(eventId: number, type: string, data: unknown, emittedAt: string): Promise<void> {
    const newEntry: PersistedRunEvent = {
      event_id: eventId,
      type,
      data: this.stringifyPersistedData(data),
      created_at: emittedAt,
    };

    const segmentIndex = segmentIndexForEventId(eventId);
    if (segmentIndex !== this.r2SegmentIndex) {
      const prevBuffer = this.r2SegmentBuffer;
      const prevIndex = this.r2SegmentIndex;
      try {
        await this.flushR2Segment(prevIndex, prevBuffer);
        this.r2SegmentBuffer = [];
      } catch (err) {
        logWarn('R2 segment flush failed, keeping buffer for retry', { module: 'runnotifierdo', detail: err });
        this.r2SegmentBuffer = this.enforceSegmentBufferCap(this.r2SegmentBuffer, 'r2SegmentBuffer');
      }
      this.r2SegmentIndex = segmentIndex;
    }

    this.r2SegmentBuffer.push(newEntry);

    if (this.isSegmentBoundaryOrTerminal(eventId, type)) {
      try {
        await this.flushR2Segment(this.r2SegmentIndex, this.r2SegmentBuffer);
        this.r2SegmentBuffer = [];
        this.r2SegmentIndex = segmentIndexForEventId(eventId + 1);
      } catch (err) {
        logWarn('R2 boundary/terminal flush failed', { module: 'runnotifierdo', detail: err });
        this.r2SegmentBuffer = this.enforceSegmentBufferCap(this.r2SegmentBuffer, 'r2SegmentBuffer');
      }
    }

    this.r2SegmentBuffer = this.enforceSegmentBufferCap(this.r2SegmentBuffer, 'r2SegmentBuffer');
  }

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

  // ---------------------------------------------------------------------------
  // /usage endpoint
  // ---------------------------------------------------------------------------

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
          logWarn('Usage segment flush failed', { module: 'runnotifierdo', detail: err });
          this.usageSegmentBuffer = this.enforceSegmentBufferCap(this.usageSegmentBuffer, 'usageSegmentBuffer');
        }
      }

      await this.persistState();

      return jsonResponse({ success: true });
    });
  }
}
