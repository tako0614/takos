import type {
  DurableObjectStateBinding,
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import { getDb, runs } from "../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { checkSpaceAccess } from "../../application/services/identity/space-access.ts";
import type { PersistedRunEvent } from "../../application/services/offload/run-events.ts";
import { RUN_TERMINAL_EVENT_TYPES } from "../../application/services/run-notifier/index.ts";
import type { RunTerminalEventType } from "../../application/services/run-notifier/run-events-contract.ts";
import {
  RUN_EVENT_TRUNCATED_DATA,
  RUN_EVENT_SEGMENT_SIZE,
  segmentIndexForEventId,
  serializeRunEventData,
  writeRunEventSegmentToR2,
} from "../../application/services/offload/run-events.ts";
import type { PersistedUsageEvent } from "../../application/services/offload/usage-events.ts";
import {
  MAX_USAGE_EVENT_METADATA_BYTES,
  USAGE_EVENT_SEGMENT_SIZE,
  writeUsageEventArchiveManifestToR2,
  writeUsageEventSegmentToR2,
} from "../../application/services/offload/usage-events.ts";
import { logWarn } from "../../shared/utils/logger.ts";
import {
  type EmitResult,
  jsonResponse,
  NotifierBase,
  type RingBufferEvent,
  toWsEnvelope,
  type WebSocketLike,
} from "./notifier-base.ts";
import { MAX_CONNECTIONS } from "./do-header-utils.ts";

export class RunNotifierDO extends NotifierBase {
  protected readonly moduleName = "runnotifierdo";
  protected readonly maxConnections = MAX_CONNECTIONS;

  private db: SqlDatabaseBinding;
  private offloadBucket: ObjectStoreBinding | undefined;
  private runId: string | null = null;

  private r2SegmentIndex = 1;
  private r2SegmentBuffer: PersistedRunEvent[] = [];
  private r2LastFlushedSegmentIndex = 0;

  private usageSegmentIndex = 1;
  private usageSegmentBuffer: PersistedUsageEvent[] = [];
  private usageLastFlushedSegmentIndex = 0;
  private usageEventCount = 0;
  private usageArchiveCompleted = false;
  private runTerminalObserved = false;
  private emitDedupKeys = new Map<string, number>();

  /**
   * Hard cap on segment buffer sizes to prevent unbounded growth
   * if object store writes consistently fail. When the cap is reached, oldest
   * entries are dropped and a warning is logged.
   */
  private static readonly MAX_SEGMENT_BUFFER_SIZE = 10_000;
  private static readonly EMIT_DEDUP_TTL_MS = 60 * 60 * 1000;
  private static readonly MAX_EMIT_DEDUP_KEYS = 10_000;

  constructor(state: DurableObjectStateBinding, env: Env) {
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
      usageEventCount?: number;
      usageArchiveCompleted?: boolean;
      runTerminalObserved?: boolean;
      emitDedupKeys?: Array<[string, number]>;
    }>("bufferState");
    if (stored) {
      this.eventBuffer = stored.eventBuffer;
      this.eventIdCounter = stored.eventIdCounter;
      this.runId = stored.runId;
      this.r2SegmentIndex = stored.r2SegmentIndex ?? this.r2SegmentIndex;
      this.r2SegmentBuffer = stored.r2SegmentBuffer ?? this.r2SegmentBuffer;
      this.r2LastFlushedSegmentIndex = stored.r2LastFlushedSegmentIndex ??
        this.r2LastFlushedSegmentIndex;
      this.usageSegmentIndex = stored.usageSegmentIndex ??
        this.usageSegmentIndex;
      this.usageSegmentBuffer = stored.usageSegmentBuffer ??
        this.usageSegmentBuffer;
      this.usageLastFlushedSegmentIndex = stored.usageLastFlushedSegmentIndex ??
        this.usageLastFlushedSegmentIndex;
      this.usageEventCount = stored.usageEventCount ??
        Math.max(
          0,
          (this.usageSegmentIndex - 1) * USAGE_EVENT_SEGMENT_SIZE +
            this.usageSegmentBuffer.length,
        );
      this.usageArchiveCompleted = stored.usageArchiveCompleted ?? false;
      this.runTerminalObserved = stored.runTerminalObserved ?? false;
      this.usageSegmentIndex = Math.max(
        this.usageSegmentIndex,
        this.usageLastFlushedSegmentIndex + 1,
      );
      this.emitDedupKeys = new Map(stored.emitDedupKeys ?? []);
    }
  }

  protected async persistState(): Promise<void> {
    await this.state.storage.put("bufferState", {
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
      runId: this.runId,
      r2SegmentIndex: this.r2SegmentIndex,
      r2SegmentBuffer: this.r2SegmentBuffer,
      r2LastFlushedSegmentIndex: this.r2LastFlushedSegmentIndex,
      usageSegmentIndex: this.usageSegmentIndex,
      usageSegmentBuffer: this.usageSegmentBuffer,
      usageLastFlushedSegmentIndex: this.usageLastFlushedSegmentIndex,
      usageEventCount: this.usageEventCount,
      usageArchiveCompleted: this.usageArchiveCompleted,
      runTerminalObserved: this.runTerminalObserved,
      emitDedupKeys: Array.from(this.emitDedupKeys.entries()),
    });
  }

  // ---------------------------------------------------------------------------
  // WebSocket – domain-specific auth & subscribe message
  // ---------------------------------------------------------------------------

  protected override async validateWebSocket(
    request: Request,
    _url: URL,
  ): Promise<{ reject?: Response; tags?: string[] }> {
    // Defense-in-depth: verify the connecting user owns the run's space.
    // The route layer already checks access before forwarding, but we verify
    // here in case the DO is somehow reached without the route gatekeeper.
    const userId = request.headers.get("X-WS-User-Id");
    if (!userId) {
      return { reject: new Response("Unauthorized", { status: 401 }) };
    }

    if (this.runId) {
      const db = getDb(this.db);
      const run = await db.select({ accountId: runs.accountId })
        .from(runs)
        .where(eq(runs.id, this.runId))
        .get();
      if (!run) {
        return { reject: new Response("Not Found", { status: 404 }) };
      }
      const access = await checkSpaceAccess(this.db, run.accountId, userId);
      if (!access) {
        return { reject: new Response("Forbidden", { status: 403 }) };
      }
    }

    return {};
  }

  protected override async handleWsMessage(
    ws: WebSocketLike,
    message: string,
  ): Promise<void> {
    try {
      const raw = JSON.parse(message) as Record<string, unknown>;
      if (
        raw.type === "subscribe" && typeof raw.runId === "string" && raw.runId
      ) {
        // runId can only be set via /emit (internal service call), not from client subscribe
        if (this.runId && raw.runId !== this.runId) {
          ws.send(JSON.stringify({
            type: "error",
            data: { message: "runId mismatch" },
          }));
          return;
        }
        ws.send(JSON.stringify({
          type: "subscribed",
          data: { runId: this.runId ?? raw.runId },
        }));
      }
    } catch (error) {
      logWarn("Invalid websocket message ignored", {
        module: this.moduleName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Extra routes (/usage)
  // ---------------------------------------------------------------------------

  protected override handleExtraRoutes(
    request: Request,
    _url: URL,
    path: string,
  ): Response | Promise<Response> | null {
    if (path === "/usage" && request.method === "POST") {
      return (async () => {
        let body;
        try {
          body = await request.json() as Parameters<typeof this.handleUsage>[0];
        } catch {
          return jsonResponse({ error: "Invalid JSON" }, 400);
        }
        return this.handleUsage(body);
      })();
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Emit – validation, object store offload, SQL store last_event_id
  // ---------------------------------------------------------------------------

  protected override async validateEmit(
    input: {
      type: string;
      data: unknown;
      runId?: string;
      [key: string]: unknown;
    },
  ): Promise<Response | null> {
    if (input.runId !== undefined) {
      if (
        typeof input.runId !== "string" || input.runId.length > 64 ||
        !/^[a-zA-Z0-9_-]+$/.test(input.runId)
      ) {
        return jsonResponse({ success: false, error: "Invalid runId" }, 400);
      }
    }
    // Intermediate RPC events are already capped at 64 KiB, but terminal and
    // complete-run notification paths can carry larger message/output data.
    // Keep the realtime ring and archive finite by replacing only the opaque
    // event payload; the canonical Message/Run rows retain the full result.
    if (serializeRunEventData(input.data).truncated) {
      input.data = JSON.parse(RUN_EVENT_TRUNCATED_DATA);
    }
    this.cleanupEmitDedupKeys(Date.now());
    const dedupKey = this.readDedupKey(input);
    if (dedupKey && this.emitDedupKeys.has(dedupKey)) {
      if (
        RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType) &&
        this.runTerminalObserved && !this.usageArchiveCompleted
      ) {
        try {
          await this.finalizeUsageArchive(new Date().toISOString());
          await this.persistState();
        } catch (error) {
          logWarn("Usage archive retry failed", {
            module: "runnotifierdo",
            detail: error,
          });
          return jsonResponse(
            { success: false, error: "Usage archive incomplete" },
            503,
          );
        }
      }
      return jsonResponse({ success: true, duplicate: true });
    }
    return null;
  }

  protected override async processEmit(
    input: {
      type: string;
      data: unknown;
      runId?: string;
      [key: string]: unknown;
    },
    eventId: number,
  ): Promise<EmitResult> {
    if (!this.runId && typeof input.runId === "string" && input.runId.trim()) {
      this.runId = input.runId.trim();
    }

    const emittedAt = new Date().toISOString();
    const dedupKey = this.readDedupKey(input);
    if (dedupKey) {
      this.emitDedupKeys.set(dedupKey, Date.now());
      this.cleanupEmitDedupKeys(Date.now());
    }

    // object store offload
    if (this.offloadBucket) {
      await this.handleR2Offload(eventId, input.type, input.data, emittedAt);
    }

    // SQL store last_event_id at segment boundaries or terminal events
    if (this.isSegmentBoundaryOrTerminal(eventId, input.type)) {
      this.persistLastEventId(eventId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn("Best-effort SQL last_event_id update failed", {
          module: "runnotifierdo",
          detail: msg,
        });
      });
    }

    // Flush every bounded usage segment, then publish the manifest last. The
    // billing reader accepts auxiliary meters only when this manifest proves
    // the complete archive cardinality.
    if (RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType)) {
      this.runTerminalObserved = true;
      try {
        await this.finalizeUsageArchive(emittedAt);
      } catch (err) {
        logWarn("Usage archive finalization failed", {
          module: "runnotifierdo",
          detail: err,
        });
        this.usageArchiveCompleted = false;
        throw err;
      }
    }

    const broadcastMessage = JSON.stringify(
      toWsEnvelope({
        type: input.type,
        data: input.data,
        eventId,
        createdAt: emittedAt,
      }),
    );

    return { broadcastMessage };
  }

  // ---------------------------------------------------------------------------
  // /state extra
  // ---------------------------------------------------------------------------

  protected override getStateExtra(): Record<string, unknown> {
    return { runId: this.runId };
  }

  // ---------------------------------------------------------------------------
  // object store offload helpers
  // ---------------------------------------------------------------------------

  private async handleR2Offload(
    eventId: number,
    type: string,
    data: unknown,
    emittedAt: string,
  ): Promise<void> {
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
        logWarn("Object-store segment flush failed, keeping buffer for retry", {
          module: "runnotifierdo",
          detail: err,
        });
        this.r2SegmentBuffer = this.enforceSegmentBufferCap(
          this.r2SegmentBuffer,
          "r2SegmentBuffer",
        );
      }
      this.r2SegmentIndex = segmentIndex;
    }

    this.r2SegmentBuffer.push(newEntry);

    if (this.isSegmentBoundaryOrTerminal(eventId, type)) {
      try {
        await this.flushR2Segment(this.r2SegmentIndex, this.r2SegmentBuffer);
        this.r2SegmentBuffer = [];
        // Advance the live segment index past the segment we just flushed so
        // post-terminal events are not trapped in an already-flushed segment.
        // A terminal event can land mid-segment (e.g. event 150 in segment 2),
        // in which case segmentIndexForEventId(eventId + 1) still resolves to
        // the same segment. Reusing that index would route later events into a
        // buffer whose flushR2Segment is permanently skipped by the
        // `segmentIndex <= r2LastFlushedSegmentIndex` guard, silently dropping
        // them from the archive. Always move at least one segment past the
        // last flushed index.
        this.r2SegmentIndex = Math.max(
          segmentIndexForEventId(eventId + 1),
          this.r2LastFlushedSegmentIndex + 1,
        );
      } catch (err) {
        logWarn("Object-store boundary/terminal flush failed", {
          module: "runnotifierdo",
          detail: err,
        });
        this.r2SegmentBuffer = this.enforceSegmentBufferCap(
          this.r2SegmentBuffer,
          "r2SegmentBuffer",
        );
      }
    }

    this.r2SegmentBuffer = this.enforceSegmentBufferCap(
      this.r2SegmentBuffer,
      "r2SegmentBuffer",
    );
  }

  /**
   * Drop oldest entries when the segment buffer exceeds
   * `MAX_SEGMENT_BUFFER_SIZE`. Public so tests can verify the cap behavior
   * without reaching into a private method via type laundering; production
   * callers stay inside the persistence path that owns the buffer.
   */
  enforceSegmentBufferCap<T>(buffer: T[], label: string): T[] {
    if (buffer.length <= RunNotifierDO.MAX_SEGMENT_BUFFER_SIZE) return buffer;
    const excess = buffer.length - RunNotifierDO.MAX_SEGMENT_BUFFER_SIZE;
    logWarn(
      `${label} exceeded max size (${buffer.length}), dropping ${excess} oldest entries`,
      { module: "runnotifierdo" },
    );
    return buffer.slice(excess);
  }

  private readDedupKey(input: { [key: string]: unknown }): string | null {
    const dedupKey = input.dedup_key;
    if (typeof dedupKey !== "string") return null;
    const trimmed = dedupKey.trim();
    if (!trimmed || trimmed.length > 512) return null;
    return trimmed;
  }

  private cleanupEmitDedupKeys(nowMs: number): void {
    for (const [key, seenAt] of this.emitDedupKeys) {
      if (nowMs - seenAt > RunNotifierDO.EMIT_DEDUP_TTL_MS) {
        this.emitDedupKeys.delete(key);
      }
    }
    if (this.emitDedupKeys.size <= RunNotifierDO.MAX_EMIT_DEDUP_KEYS) {
      return;
    }
    const overflow = this.emitDedupKeys.size -
      RunNotifierDO.MAX_EMIT_DEDUP_KEYS;
    let removed = 0;
    for (const key of this.emitDedupKeys.keys()) {
      this.emitDedupKeys.delete(key);
      removed++;
      if (removed >= overflow) break;
    }
  }

  /**
   * Serialize a payload before persisting to storage. Public so tests can
   * verify the circular-reference fallback path without reaching into a
   * private method via type laundering.
   */
  stringifyPersistedData(value: unknown): string {
    return serializeRunEventData(value).data;
  }

  private isSegmentBoundaryOrTerminal(eventId: number, type: string): boolean {
    if (!Number.isFinite(eventId) || eventId <= 0) return false;
    if (eventId % RUN_EVENT_SEGMENT_SIZE === 0) return true;
    return RUN_TERMINAL_EVENT_TYPES.has(type as RunTerminalEventType);
  }

  private async flushR2Segment(
    segmentIndex: number,
    events: PersistedRunEvent[],
  ): Promise<void> {
    if (!this.offloadBucket) return;
    if (!this.runId) return;
    if (events.length === 0) return;
    if (segmentIndex <= this.r2LastFlushedSegmentIndex) return;

    await writeRunEventSegmentToR2(
      this.offloadBucket,
      this.runId,
      segmentIndex,
      events,
    );
    this.r2LastFlushedSegmentIndex = Math.max(
      this.r2LastFlushedSegmentIndex,
      segmentIndex,
    );
  }

  private async flushUsageSegment(
    segmentIndex: number,
    events: PersistedUsageEvent[],
  ): Promise<void> {
    if (!this.offloadBucket) return;
    if (!this.runId) return;
    if (events.length === 0) return;
    if (segmentIndex <= this.usageLastFlushedSegmentIndex) return;

    await writeUsageEventSegmentToR2(
      this.offloadBucket,
      this.runId,
      segmentIndex,
      events,
    );
    this.usageLastFlushedSegmentIndex = Math.max(
      this.usageLastFlushedSegmentIndex,
      segmentIndex,
    );
  }

  private async flushPendingUsageSegments(flushPartial: boolean): Promise<void> {
    while (
      this.usageSegmentBuffer.length >= USAGE_EVENT_SEGMENT_SIZE ||
      (flushPartial && this.usageSegmentBuffer.length > 0)
    ) {
      const segment = this.usageSegmentBuffer.slice(
        0,
        USAGE_EVENT_SEGMENT_SIZE,
      );
      await this.flushUsageSegment(this.usageSegmentIndex, segment);
      this.usageSegmentBuffer = this.usageSegmentBuffer.slice(segment.length);
      this.usageSegmentIndex += 1;
    }
  }

  private async finalizeUsageArchive(completedAt: string): Promise<void> {
    if (!this.offloadBucket || !this.runId) return;
    await this.flushPendingUsageSegments(true);
    await writeUsageEventArchiveManifestToR2(
      this.offloadBucket,
      this.runId,
      {
        segmentCount: this.usageLastFlushedSegmentIndex,
        eventCount: this.usageEventCount,
        completedAt,
      },
    );
    this.usageArchiveCompleted = true;
  }

  private async persistLastEventId(eventId: number): Promise<void> {
    if (!this.runId) return;
    try {
      const db = getDb(this.db);
      await db.update(runs).set({ lastEventId: eventId })
        .where(eq(runs.id, this.runId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn("Failed to persist last_event_id", {
        module: "runnotifierdo",
        detail: message,
      });
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
      if (!this.offloadBucket) {
        return jsonResponse(
          { success: false, error: "Usage archive unavailable" },
          503,
        );
      }
      const inputRunId = typeof input.runId === "string"
        ? input.runId.trim()
        : "";
      if (
        !inputRunId || inputRunId.length > 64 ||
        !/^[A-Za-z0-9_-]+$/u.test(inputRunId) ||
        (this.runId !== null && this.runId !== inputRunId)
      ) {
        return jsonResponse({ success: false, error: "Invalid runId" }, 400);
      }
      if (this.runTerminalObserved || this.usageArchiveCompleted) {
        return jsonResponse(
          { success: false, error: "Usage archive already completed" },
          409,
        );
      }

      // A full segment that could not be offloaded was already acknowledged
      // and persisted by the preceding request. Retry that bounded segment
      // before accepting another event so an R2 outage cannot grow DO state
      // without limit or make a failed response ambiguous for the new event.
      if (this.usageSegmentBuffer.length >= USAGE_EVENT_SEGMENT_SIZE) {
        try {
          await this.flushPendingUsageSegments(false);
        } catch (err) {
          logWarn("Usage segment backpressure", {
            module: "runnotifierdo",
            detail: err,
          });
          return jsonResponse(
            { success: false, error: "Usage archive unavailable" },
            503,
          );
        }
      }

      const meterType = typeof input.meter_type === "string"
        ? input.meter_type.trim()
        : "";
      const units = input.units;

      if (!meterType || new TextEncoder().encode(meterType).byteLength > 128) {
        return jsonResponse({
          success: false,
          error: "meter_type is required",
        }, 400);
      }

      if (
        typeof units !== "number" || !Number.isFinite(units) || units <= 0 ||
        units > Number.MAX_SAFE_INTEGER
      ) {
        return jsonResponse({
          success: false,
          error: "units must be positive",
        }, 400);
      }

      const referenceType = input.reference_type === undefined
        ? null
        : typeof input.reference_type === "string"
          ? input.reference_type.trim()
          : null;
      if (
        input.reference_type !== undefined &&
        (!referenceType ||
          new TextEncoder().encode(referenceType).byteLength > 128)
      ) {
        return jsonResponse({
          success: false,
          error: "reference_type is invalid",
        }, 400);
      }
      let metadataStr: string | null = null;
      if (input.metadata !== undefined) {
        if (
          !input.metadata || typeof input.metadata !== "object" ||
          Array.isArray(input.metadata)
        ) {
          return jsonResponse(
            { success: false, error: "metadata is invalid" },
            400,
          );
        }
        try {
          metadataStr = JSON.stringify(input.metadata);
        } catch {
          return jsonResponse(
            { success: false, error: "metadata is invalid" },
            400,
          );
        }
        if (
          new TextEncoder().encode(metadataStr).byteLength >
            MAX_USAGE_EVENT_METADATA_BYTES
        ) {
          return jsonResponse(
            { success: false, error: "metadata is too large" },
            413,
          );
        }
      }

      // Bind the DO identity only after the complete event is valid. A bad
      // internal request must not poison an otherwise unused notifier.
      if (!this.runId) this.runId = inputRunId;

      this.usageSegmentBuffer.push({
        meter_type: meterType,
        units,
        reference_type: referenceType,
        metadata: metadataStr,
        created_at: new Date().toISOString(),
      });
      this.usageEventCount += 1;

      if (this.usageSegmentBuffer.length >= USAGE_EVENT_SEGMENT_SIZE) {
        try {
          await this.flushPendingUsageSegments(false);
        } catch (err) {
          logWarn("Usage segment flush failed", {
            module: "runnotifierdo",
            detail: err,
          });
          this.usageSegmentBuffer = this.enforceSegmentBufferCap(
            this.usageSegmentBuffer,
            "usageSegmentBuffer",
          );
        }
      }

      await this.persistState();

      return jsonResponse({ success: true });
    });
  }
}
