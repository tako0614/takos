import type {
  DurableObjectStateBinding,
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import { getDb, runs } from "../../infra/db/index.ts";
import { eq, sql } from "drizzle-orm";
import { resolveWorkspaceAuthority } from "../../application/services/platform/capabilities.ts";
import type { PersistedRunEvent } from "../../application/services/offload/run-events.ts";
import { RUN_TERMINAL_EVENT_TYPES } from "../../application/services/run-notifier/index.ts";
import type { RunTerminalEventType } from "../../application/services/run-notifier/run-events-contract.ts";
import {
  buildRunEventSegmentKey,
  RUN_EVENT_SEGMENT_SIZE,
  segmentIndexForEventId,
} from "../../application/services/offload/run-events.ts";
import type { PersistedUsageEvent } from "../../application/services/offload/usage-events.ts";
import {
  USAGE_EVENT_SEGMENT_SIZE,
  usageSegmentKey,
} from "../../application/services/offload/usage-events.ts";
import { gzipCompressString, gzipDecompressToString } from "../../shared/utils/gzip.ts";
import { logWarn } from "../../shared/utils/logger.ts";
import {
  type EmitResult,
  jsonResponse,
  NotifierBase,
  toWsEnvelope,
  type WebSocketLike,
  type RingBufferEvent,
} from "./notifier-base.ts";
import { MAX_CONNECTIONS } from "./do-header-utils.ts";
import {
  assertNotifierSnapshotBudget,
  digestNotifierPayload,
  loadNotifierSnapshot,
  NotifierCapacityError,
  persistNotifierSnapshot,
  readNotifierBlob,
  stageNotifierBlob,
  type NotifierBlobRef,
} from "./notifier-journal.ts";
import {
  parseRunNotifierJournalState,
  type EmitReceipt,
  type RunFlushIntent,
  type RunFlushKind,
  type RunNotifierJournalState,
  type UsageReceipt,
} from "./run-notifier-journal-state.ts";

const MAX_RUN_ID_LENGTH = 64;
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_FLUSH_PLAIN_BYTES = 256 * 1024;
const RECOVERY_ALARM_DELAY_MS = 2_000;
const SNAPSHOT_RESERVE_BYTES = 128 * 1024;
const HEX_ZERO = "0".repeat(64);
const REMOTE_IO_DEADLINE_MS = 5_000;

type EmitInput = {
  type: string;
  data: unknown;
  runId?: string;
  event_id?: number | string;
  [key: string]: unknown;
};

type UsageInput = {
  runId?: string;
  meter_type?: unknown;
  units?: unknown;
  reference_type?: unknown;
  metadata?: unknown;
  request_id?: unknown;
};

function isValidRunId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_RUN_ID_LENGTH && RUN_ID_PATTERN.test(value);
}

async function sha256(value: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withRemoteDeadline<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} deadline exceeded`)),
          REMOTE_IO_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function jsonl(events: PersistedRunEvent[] | PersistedUsageEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function bufferBytes(events: PersistedRunEvent[] | PersistedUsageEvent[]): number {
  return events.length === 0 ? 0 : new TextEncoder().encode(jsonl(events)).length;
}

function prospectiveBlobRef(bytes: number): NotifierBlobRef {
  const chunks = Math.ceil(bytes / (64 * 1024));
  return { bytes, digest: HEX_ZERO, chunks: Array.from({ length: chunks }, () => HEX_ZERO) };
}

export class RunNotifierDO extends NotifierBase {
  protected override readonly journalKind = "run";
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
  // Historical opaque keys remain readable. New receipts retain payload identity.
  private emitDedupKeys = new Map<string, number>();
  private flushIntents: RunFlushIntent[] = [];
  private emitReceipts: EmitReceipt[] = [];
  private usageReceipts: UsageReceipt[] = [];
  private legacyPendingRunCount = 0;
  private legacyPendingUsageCount = 0;
  private needsRecoveryDrain = false;
  private pumpPromise: Promise<void> | null = null;

  constructor(state: DurableObjectStateBinding, env: Env) {
    super(state);
    this.db = env.DB;
    this.offloadBucket = env.TAKOS_OFFLOAD;
  }

  private snapshot(): RunNotifierJournalState & { schemaVersion: 2 } {
    return {
      schemaVersion: 2,
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
      runId: this.runId,
      r2SegmentIndex: this.r2SegmentIndex,
      r2SegmentBuffer: this.r2SegmentBuffer,
      r2LastFlushedSegmentIndex: this.r2LastFlushedSegmentIndex,
      usageSegmentIndex: this.usageSegmentIndex,
      usageSegmentBuffer: this.usageSegmentBuffer,
      usageLastFlushedSegmentIndex: this.usageLastFlushedSegmentIndex,
      emitDedupKeys: Array.from(this.emitDedupKeys.entries()),
      flushIntents: this.flushIntents,
      emitReceipts: this.emitReceipts,
      usageReceipts: this.usageReceipts,
      legacyPendingRunCount: this.legacyPendingRunCount,
      legacyPendingUsageCount: this.legacyPendingUsageCount,
    };
  }

  private liveBlobs(): NotifierBlobRef[] {
    return this.flushIntents.map((intent) => intent.blob);
  }

  protected async loadPersistedState(): Promise<void> {
    const stored = parseRunNotifierJournalState(
      await loadNotifierSnapshot(this.state.storage, "run"),
    );
    // Validate every frozen prefix against the immutable bytes before changing
    // any live field. A corrupt intent must not become a new archive authority.
    if (stored) {
      for (const intent of stored.flushIntents) {
        const pending = intent.kind === "run"
          ? stored.r2SegmentBuffer.slice(0, intent.count)
          : stored.usageSegmentBuffer.slice(0, intent.count);
        const bytes = await readNotifierBlob(this.state.storage, intent.blob);
        const plain = await gzipDecompressToString(bytes, { maxDecompressedBytes: 8 * 1024 * 1024 });
        if (plain !== jsonl(pending)) {
          throw new Error("Invalid persisted run notifier journal: flushIntent.prefix");
        }
      }
    }
    this.eventBuffer = stored?.eventBuffer ?? [];
    this.eventIdCounter = stored?.eventIdCounter ?? 0;
    this.runId = stored?.runId ?? null;
    this.r2SegmentIndex = stored?.r2SegmentIndex ?? 1;
    this.r2SegmentBuffer = stored?.r2SegmentBuffer ?? [];
    this.r2LastFlushedSegmentIndex = stored?.r2LastFlushedSegmentIndex ?? 0;
    this.usageSegmentIndex = stored?.usageSegmentIndex ?? 1;
    this.usageSegmentBuffer = stored?.usageSegmentBuffer ?? [];
    this.usageLastFlushedSegmentIndex = stored?.usageLastFlushedSegmentIndex ?? 0;
    this.emitDedupKeys = new Map(stored?.emitDedupKeys ?? []);
    this.flushIntents = stored?.flushIntents ?? [];
    this.emitReceipts = stored?.emitReceipts ?? [];
    this.usageReceipts = stored?.usageReceipts ?? [];
    this.legacyPendingRunCount = stored?.legacyPendingRunCount ?? 0;
    this.legacyPendingUsageCount = stored?.legacyPendingUsageCount ?? 0;
    this.needsRecoveryDrain = !!stored && this.hasPending();
    if (this.hasPending()) await this.armRecoveryAlarm();
  }

  private hasPending(): boolean {
    return this.flushIntents.length > 0 || this.r2SegmentBuffer.length > 0 ||
      this.usageSegmentBuffer.length > 0;
  }

  private async armRecoveryAlarm(): Promise<void> {
    if (!this.hasPending()) return;
    const when = Date.now() + RECOVERY_ALARM_DELAY_MS;
    const existing = await this.state.storage.getAlarm();
    if (existing === null || existing <= Date.now() || existing > when) {
      await this.state.storage.setAlarm(when);
    }
  }

  protected async persistState(): Promise<void> {
    const snapshot = this.snapshot();
    parseRunNotifierJournalState(snapshot);
    assertNotifierSnapshotBudget(snapshot, this.liveBlobs());
    // An alarm exists before a head can expose pending work, even with no WS.
    await this.armRecoveryAlarm();
    await persistNotifierSnapshot(this.state.storage, "run", snapshot, this.liveBlobs());
  }

  protected override async validateWebSocket(
    request: Request,
    _url: URL,
  ): Promise<{ reject?: Response; tags?: string[] }> {
    const userId = request.headers.get("X-WS-User-Id");
    if (!userId) return { reject: new Response("Unauthorized", { status: 401 }) };
    const requestedRunId = request.headers.get("X-WS-Run-Id");
    if (!isValidRunId(requestedRunId)) {
      return { reject: new Response("Invalid run identity", { status: 400 }) };
    }
    if (this.runId && requestedRunId !== this.runId) {
      return { reject: new Response("Forbidden", { status: 403 }) };
    }
    const db = getDb(this.db);
    const run = await db.select({ accountId: runs.accountId })
      .from(runs).where(eq(runs.id, requestedRunId)).get();
    if (!run) return { reject: new Response("Not Found", { status: 404 }) };
    const authority = await resolveWorkspaceAuthority(this.db, run.accountId, userId);
    if (!authority) return { reject: new Response("Forbidden", { status: 403 }) };
    return this.state.blockConcurrencyWhile(async () => {
      if (this.runId && requestedRunId !== this.runId) {
        return { reject: new Response("Forbidden", { status: 403 }) };
      }
      if (!this.runId) {
        this.runId = requestedRunId;
        try {
          await this.persistState();
        } catch (error) {
          await this.recoverPersistedState(error);
          throw error;
        }
      }
      return {};
    });
  }

  protected override async handleWsMessage(ws: WebSocketLike, message: string): Promise<void> {
    try {
      const raw = JSON.parse(message) as Record<string, unknown>;
      if (raw.type === "subscribe" && typeof raw.runId === "string" && raw.runId) {
        if (this.runId && raw.runId !== this.runId) {
          ws.send(JSON.stringify({ type: "error", data: { message: "runId mismatch" } }));
          return;
        }
        ws.send(JSON.stringify({ type: "subscribed", data: { runId: this.runId ?? raw.runId } }));
      }
    } catch (error) {
      logWarn("Invalid websocket message ignored", {
        module: this.moduleName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  protected override handleExtraRoutes(
    request: Request, _url: URL, path: string,
  ): Response | Promise<Response> | null {
    if (path !== "/usage" || request.method !== "POST") return null;
    return (async () => {
      let body: UsageInput;
      try {
        body = await request.json() as UsageInput;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ error: "Invalid usage" }, 400);
      }
      return this.handleUsage(body);
    })();
  }

  private readDedupKey(input: EmitInput): string | null {
    if (typeof input.dedup_key === "string") return input.dedup_key;
    const preferred = input.event_id;
    const eventId = typeof preferred === "number"
      ? preferred
      : typeof preferred === "string" && /^\d+$/.test(preferred)
      ? Number(preferred)
      : null;
    const runId = input.runId ?? this.runId;
    return Number.isSafeInteger(eventId) && eventId! > 0 && isValidRunId(runId)
      ? `run:${runId}:event:${eventId}` : null;
  }

  private async emitDigest(input: EmitInput): Promise<string> {
    return digestNotifierPayload({
      runId: input.runId ?? this.runId,
      type: input.type,
      data: input.data,
    });
  }

  protected override async validateEmit(input: EmitInput): Promise<Response | null> {
    if (input.dedup_key !== undefined &&
      (typeof input.dedup_key !== "string" || !input.dedup_key ||
        input.dedup_key !== input.dedup_key.trim() || input.dedup_key.length > 512)) {
      return jsonResponse({ success: false, error: "Invalid dedup_key" }, 400);
    }
    if (RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType) &&
      this.usageSegmentBuffer.length > 0 &&
      this.usageSegmentIndex === Number.MAX_SAFE_INTEGER) {
      return jsonResponse({ success: false, error: "Usage sequence exhausted" }, 503);
    }
    if (input.runId !== undefined) {
      if (!isValidRunId(input.runId)) {
        return jsonResponse({ success: false, error: "Invalid runId" }, 400);
      }
      if (this.runId && input.runId !== this.runId) {
        return jsonResponse({ success: false, error: "runId mismatch" }, 409);
      }
    }
    const key = this.readDedupKey(input);
    if (key) {
      const receipt = this.emitReceipts.find((entry) => entry.key === key);
      if (receipt) {
        const digest = await this.emitDigest(input);
        return receipt.digest === digest
          ? jsonResponse({ success: true, duplicate: true, eventId: receipt.eventId })
          : jsonResponse({ success: false, error: "dedup_key payload conflict" }, 409);
      }
      // A v1 key has no payload witness. Honor its original opaque result.
      if (this.emitDedupKeys.has(key)) {
        return jsonResponse({ success: true, duplicate: true });
      }
    }
    return null;
  }

  protected override async validateEmitCapacity(
    input: EmitInput, prospectiveRing: RingBufferEvent[], prospectiveId: number,
  ): Promise<Response | null> {
    const nextRunId = this.runId ?? (isValidRunId(input.runId) ? input.runId : null);
    const pending = this.offloadBucket && nextRunId
      ? [...this.r2SegmentBuffer, {
        event_id: prospectiveId,
        type: input.type,
        data: this.stringifyPersistedData(input.data),
        created_at: new Date().toISOString(),
      }]
      : this.r2SegmentBuffer;
    const key = this.readDedupKey(input);
    const receipts = key
      ? [...this.emitReceipts, { key, digest: await this.emitDigest(input), eventId: prospectiveId }]
      : this.emitReceipts;
    const draft = {
      ...this.snapshot(), eventBuffer: prospectiveRing, eventIdCounter: prospectiveId,
      runId: nextRunId, r2SegmentBuffer: pending, emitReceipts: receipts,
    };
    const refs = [...this.liveBlobs()];
    if (this.offloadBucket && nextRunId) {
      const unfrozen = pending.slice(this.intent("run")?.count ?? 0);
      if (unfrozen.length) {
        const prefix = this.freezePrefix(unfrozen, RUN_EVENT_SEGMENT_SIZE);
        // Budget a future immutable gzip blob before the event ID is assigned.
        refs.push(prospectiveBlobRef(bufferBytes(prefix) + 1024));
      }
      const usageUnfrozen = this.usageSegmentBuffer.slice(this.intent("usage")?.count ?? 0);
      if (usageUnfrozen.length) {
        refs.push(prospectiveBlobRef(bufferBytes(this.freezePrefix(
          usageUnfrozen, USAGE_EVENT_SEGMENT_SIZE,
        )) + 1024));
      }
    }
    try {
      parseRunNotifierJournalState(draft);
      assertNotifierSnapshotBudget(draft, refs, SNAPSHOT_RESERVE_BYTES);
    } catch (error) {
      return jsonResponse({ success: false,
        error: error instanceof NotifierCapacityError ? error.message : "Run journal capacity exhausted" }, 503);
    }
    return null;
  }

  protected override async processEmit(input: EmitInput, eventId: number): Promise<EmitResult> {
    if (!this.runId && isValidRunId(input.runId)) this.runId = input.runId;
    const emittedAt = new Date().toISOString();
    const key = this.readDedupKey(input);
    if (key) this.emitReceipts.push({ key, digest: await this.emitDigest(input), eventId });
    if (this.offloadBucket && this.runId) {
      this.r2SegmentBuffer.push({
        event_id: eventId, type: input.type,
        data: this.stringifyPersistedData(input.data), created_at: emittedAt,
      });
      if (!this.intent("run") &&
        this.shouldFreezeRun(this.r2SegmentBuffer, eventId, input.type)) {
        await this.freeze("run");
      }
    }
    if (this.offloadBucket && this.runId &&
      RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType) &&
      this.usageSegmentBuffer.length > 0 && !this.intent("usage")) {
      await this.freeze("usage");
    }
    return { broadcastMessage: JSON.stringify(toWsEnvelope({
      type: input.type, data: input.data, eventId, createdAt: emittedAt,
    })) };
  }

  protected override async afterPersistedEmit(_input: EmitInput, eventId: number): Promise<void> {
    if (this.isSegmentBoundaryOrTerminal(eventId, _input.type)) {
      await this.persistLastEventId(eventId);
    }
    await this.pumpBestEffort();
    if (RUN_TERMINAL_EVENT_TYPES.has(_input.type as RunTerminalEventType) &&
      this.offloadBucket && this.usageSegmentBuffer.length > 0 && !this.intent("usage")) {
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (!this.intent("usage") && this.usageSegmentBuffer.length > 0) {
          try {
            await this.freeze("usage");
            await this.persistState();
          } catch (error) {
            await this.recoverPersistedState(error);
            throw error;
          }
        }
      });
      await this.pumpBestEffort();
    }
  }

  protected override getStateExtra(): Record<string, unknown> {
    return { runId: this.runId };
  }

  private intent(kind: RunFlushKind): RunFlushIntent | undefined {
    return this.flushIntents.find((entry) => entry.kind === kind);
  }

  private freezePrefix<T>(events: T[], maxEntries: number): T[] {
    const prefix: T[] = [];
    let bytes = 0;
    for (const event of events) {
      const lineBytes = new TextEncoder().encode(JSON.stringify(event) + "\n").length;
      if (prefix.length > 0 && bytes + lineBytes > MAX_FLUSH_PLAIN_BYTES) break;
      prefix.push(event);
      bytes += lineBytes;
      if (prefix.length >= maxEntries) break;
    }
    return prefix;
  }

  private shouldFreezeRun(events: PersistedRunEvent[], eventId: number, type: string): boolean {
    return this.isSegmentBoundaryOrTerminal(eventId, type) ||
      events.length >= RUN_EVENT_SEGMENT_SIZE || bufferBytes(events) >= MAX_FLUSH_PLAIN_BYTES;
  }

  private isSegmentBoundaryOrTerminal(eventId: number, type: string): boolean {
    return eventId > 0 && (eventId % RUN_EVENT_SEGMENT_SIZE === 0 ||
      RUN_TERMINAL_EVENT_TYPES.has(type as RunTerminalEventType));
  }

  private async freeze(kind: RunFlushKind): Promise<void> {
    if (!this.offloadBucket || !this.runId || this.intent(kind)) return;
    const pending = kind === "run" ? this.r2SegmentBuffer : this.usageSegmentBuffer;
    if (pending.length === 0) return;
    const prefix = kind === "run"
      ? this.freezePrefix(this.r2SegmentBuffer, Math.min(RUN_EVENT_SEGMENT_SIZE,
        this.legacyPendingRunCount || RUN_EVENT_SEGMENT_SIZE))
      : this.freezePrefix(this.usageSegmentBuffer, Math.min(USAGE_EVENT_SEGMENT_SIZE,
        this.legacyPendingUsageCount || USAGE_EVENT_SEGMENT_SIZE));
    const segmentIndex = kind === "run"
      ? Math.max(this.r2SegmentIndex, this.r2LastFlushedSegmentIndex + 1,
        segmentIndexForEventId((prefix[0] as PersistedRunEvent).event_id))
      : Math.max(this.usageSegmentIndex, this.usageLastFlushedSegmentIndex + 1);
    if (!Number.isSafeInteger(segmentIndex) || segmentIndex === Number.MAX_SAFE_INTEGER) {
      throw new NotifierCapacityError();
    }
    const key = kind === "run"
      ? buildRunEventSegmentKey(this.runId, segmentIndex)
      : usageSegmentKey(this.runId, segmentIndex);
    const bytes = await gzipCompressString(jsonl(prefix));
    const blob = await stageNotifierBlob(this.state.storage, bytes);
    const origin = (kind === "run" ? this.legacyPendingRunCount : this.legacyPendingUsageCount) > 0
      ? "legacy" : "journal";
    this.flushIntents.push({ kind, origin, segmentIndex, key, count: prefix.length, blob });
  }

  private async persistLastEventId(eventId: number): Promise<void> {
    if (!this.runId) return;
    try {
      const db = getDb(this.db);
      await withRemoteDeadline(db.update(runs).set({
        lastEventId: sql`max(${runs.lastEventId}, ${eventId})`,
      }).where(eq(runs.id, this.runId)), "SQL last_event_id");
    } catch (error) {
      logWarn("Best-effort SQL last_event_id update failed", {
        module: this.moduleName,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async deliverIntent(intent: RunFlushIntent): Promise<void> {
    if (!this.offloadBucket) return;
    const bytes = await readNotifierBlob(this.state.storage, intent.blob);
    const existing = await withRemoteDeadline(this.offloadBucket.get(intent.key), "R2 get");
    if (existing) {
      const current = await withRemoteDeadline(existing.arrayBuffer(), "R2 body read");
      if (current.byteLength !== intent.blob.bytes ||
        await sha256(current) !== intent.blob.digest) {
        // A v2 intent is fenced by exact bytes. Only a marked v1 recovery
        // frontier may adopt a semantically identical legacy gzip object.
        if (intent.origin !== "legacy") {
          throw new Error(`Archive key conflict: ${intent.key}`);
        }
        let matchesLegacy = false;
        try {
          const pending = intent.kind === "run"
            ? this.r2SegmentBuffer.slice(0, intent.count)
            : this.usageSegmentBuffer.slice(0, intent.count);
          matchesLegacy = await gzipDecompressToString(current, {
            maxDecompressedBytes: 8 * 1024 * 1024,
          }) === jsonl(pending);
        } catch {
          // A corrupt or unrelated existing object is never overwritten.
        }
        if (!matchesLegacy) throw new Error(`Archive key conflict: ${intent.key}`);
        await this.state.blockConcurrencyWhile(async () => {
          await this.awaitInitialized();
          const live = this.intent(intent.kind);
          if (!live || live.key !== intent.key || live.blob.digest !== intent.blob.digest) return;
          try {
            // Serialize staging with cleanup as well as head publication, so an
            // alarm cannot reclaim the observed legacy bytes before adoption.
            const adopted = await stageNotifierBlob(this.state.storage, current);
            this.flushIntents = this.flushIntents.map((entry) => entry.kind === intent.kind
              ? { ...entry, origin: "journal", blob: adopted } : entry);
            await this.persistState();
          } catch (error) {
            await this.recoverPersistedState(error);
            throw error;
          }
        });
        // A separate attempt must compare the now-durable adopted raw bytes.
        return;
      }
    } else {
      await withRemoteDeadline(this.offloadBucket.put(intent.key, bytes, {
        onlyIf: new Headers({ "If-None-Match": "*" }),
        httpMetadata: {
          contentType: intent.kind === "run"
            ? "application/x-ndjson; charset=utf-8" : "application/jsonl",
          contentEncoding: "gzip",
        },
        ...(intent.kind === "usage" ? { customMetadata: {
          kind: "usage_events", run_id: this.runId!, segment: String(intent.segmentIndex),
        } } : {}),
      }), "R2 put");
      const readback = await withRemoteDeadline(this.offloadBucket.get(intent.key), "R2 readback");
      const written = readback
        ? await withRemoteDeadline(readback.arrayBuffer(), "R2 readback body") : null;
      if (!written || written.byteLength !== intent.blob.bytes ||
        await sha256(written) !== intent.blob.digest) {
        throw new Error(`Archive write verification failed: ${intent.key}`);
      }
    }
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      const current = this.intent(intent.kind);
      if (!current || current.key !== intent.key ||
        current.blob.digest !== intent.blob.digest) return;
      if (intent.kind === "run") {
        this.r2SegmentBuffer = this.r2SegmentBuffer.slice(intent.count);
        this.legacyPendingRunCount = Math.max(0, this.legacyPendingRunCount - intent.count);
        this.r2LastFlushedSegmentIndex = Math.max(this.r2LastFlushedSegmentIndex, intent.segmentIndex);
        this.r2SegmentIndex = Math.max(this.r2SegmentIndex, intent.segmentIndex + 1);
      } else {
        this.usageSegmentBuffer = this.usageSegmentBuffer.slice(intent.count);
        this.legacyPendingUsageCount = Math.max(0, this.legacyPendingUsageCount - intent.count);
        this.usageLastFlushedSegmentIndex = Math.max(this.usageLastFlushedSegmentIndex, intent.segmentIndex);
        this.usageSegmentIndex = Math.max(this.usageSegmentIndex, intent.segmentIndex + 1);
      }
      this.flushIntents = this.flushIntents.filter((entry) => entry.kind !== intent.kind);
      try {
        await this.persistState();
      } catch (error) {
        await this.recoverPersistedState(error);
        throw error;
      }
    });
  }

  private pump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise;
    const running = (async () => {
      // One bounded pass per call. Alarms and later requests continue backlog.
      for (let step = 0; step < 4; step++) {
        if (!this.flushIntents.length) {
          await this.state.blockConcurrencyWhile(async () => {
            await this.awaitInitialized();
            const last = this.r2SegmentBuffer.at(-1);
            if (last && this.shouldFreezeRun(this.r2SegmentBuffer,
              last.event_id, last.type)) {
              try {
                await this.freeze("run");
                await this.persistState();
              } catch (error) {
                await this.recoverPersistedState(error);
                throw error;
              }
            } else if (this.usageSegmentBuffer.length >= USAGE_EVENT_SEGMENT_SIZE ||
              bufferBytes(this.usageSegmentBuffer) >= MAX_FLUSH_PLAIN_BYTES) {
              try {
                await this.freeze("usage");
                await this.persistState();
              } catch (error) {
                await this.recoverPersistedState(error);
                throw error;
              }
            }
          });
        }
        const intent = this.flushIntents[0];
        if (!intent) return;
        await this.deliverIntent(intent);
      }
    })();
    this.pumpPromise = running.finally(() => { this.pumpPromise = null; });
    return this.pumpPromise;
  }

  private async pumpBestEffort(): Promise<void> {
    if (!this.flushIntents.length) return;
    try {
      await this.pump();
    } catch (error) {
      logWarn("Run notifier archive intent retained for retry", {
        module: this.moduleName,
        detail: error instanceof Error ? error.message : String(error),
      });
      try {
        await this.armRecoveryAlarm();
      } catch (alarmError) {
        logWarn("Run notifier recovery alarm scheduling failed", {
          module: this.moduleName,
          detail: alarmError instanceof Error ? alarmError.message : String(alarmError),
        });
      }
    }
  }

  override async alarm(): Promise<void> {
    await this.awaitInitialized();
    await super.alarm();
    if (this.offloadBucket && this.hasPending()) {
      await this.state.blockConcurrencyWhile(async () => {
        for (const kind of ["run", "usage"] as const) {
          if (!this.intent(kind) && (kind === "run"
            ? this.r2SegmentBuffer.length > 0 : this.usageSegmentBuffer.length > 0)) {
            try {
              await this.freeze(kind);
              await this.persistState();
            } catch (error) {
              await this.recoverPersistedState(error);
              throw error;
            }
          }
        }
      });
      await this.pumpBestEffort();
      await this.persistLastEventId(this.eventIdCounter);
      await this.armRecoveryAlarm();
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const response = await super.fetch(request);
    if (!this.hasPending()) this.needsRecoveryDrain = false;
    const path = new URL(request.url).pathname;
    if (request.method !== "GET" || !response.ok ||
      (path !== "/state" && path !== "/events")) return response;
    // A cold replacement performs no network I/O in its constructor. Its next
    // fetch drains recovered work, including a legacy prefix with no intent.
    const recovery = (async () => {
      if (this.needsRecoveryDrain && this.offloadBucket && this.hasPending()) {
        try {
          await this.state.blockConcurrencyWhile(async () => {
            await this.awaitInitialized();
            for (const kind of ["run", "usage"] as const) {
              if (!this.intent(kind) && (kind === "run"
                ? this.r2SegmentBuffer.length > 0 : this.usageSegmentBuffer.length > 0)) {
                await this.freeze(kind);
                await this.persistState();
              }
            }
          });
          this.needsRecoveryDrain = false;
        } catch (error) {
          try {
            await this.recoverPersistedState(error);
          } catch {
            // awaitInitialized will reject future requests on a failed reload.
          }
          logWarn("Run notifier recovered prefix preparation deferred", {
            module: this.moduleName,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (this.flushIntents.length) await this.pumpBestEffort();
    })();
    if (this.state.waitUntil) this.state.waitUntil(recovery);
    else await recovery;
    return response;
  }

  stringifyPersistedData(value: unknown): string {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private async handleUsage(input: UsageInput): Promise<Response> {
    await this.awaitInitialized();
    return this.state.blockConcurrencyWhile(async () => {
      if (input.runId !== undefined) {
        if (!isValidRunId(input.runId)) {
          return jsonResponse({ success: false, error: "Invalid runId" }, 400);
        }
        if (this.runId && input.runId !== this.runId) {
          return jsonResponse({ success: false, error: "runId mismatch" }, 409);
        }
      }
      const meterType = typeof input.meter_type === "string" ? input.meter_type.trim() : "";
      const units = typeof input.units === "number" ? input.units : parseFloat(String(input.units ?? ""));
      if (!meterType) return jsonResponse({ success: false, error: "meter_type is required" }, 400);
      if (!Number.isFinite(units) || units <= 0) {
        return jsonResponse({ success: false, error: "units must be positive" }, 400);
      }
      if (input.request_id !== undefined &&
        (typeof input.request_id !== "string" || !input.request_id.trim() ||
          input.request_id !== input.request_id.trim() || input.request_id.length > 512)) {
        return jsonResponse({ success: false, error: "Invalid request_id" }, 400);
      }
      const requestId = input.request_id as string | undefined;
      const effectiveRunId = this.runId ?? input.runId ?? null;
      if (!effectiveRunId) {
        return jsonResponse({ success: false, error: "Usage offload unavailable" }, 503);
      }
      const referenceType = typeof input.reference_type === "string" ? input.reference_type : null;
      const metadata = input.metadata === undefined ? null : this.stringifyPersistedData(input.metadata);
      const digest = await digestNotifierPayload({
        runId: effectiveRunId, meterType, units, referenceType, metadata: input.metadata ?? null,
      });
      if (requestId) {
        const receipt = this.usageReceipts.find((entry) => entry.requestId === requestId);
        if (receipt) {
          return receipt.digest === digest
            ? jsonResponse({ success: true, duplicate: true })
            : jsonResponse({ success: false, error: "request_id payload conflict" }, 409);
        }
      }
      if (!this.offloadBucket) {
        return jsonResponse({ success: false, error: "Usage offload unavailable" }, 503);
      }
      if (this.usageSegmentIndex === Number.MAX_SAFE_INTEGER) {
        return jsonResponse({ success: false, error: "Usage sequence exhausted" }, 503);
      }
      const event: PersistedUsageEvent = {
        meter_type: meterType, units, reference_type: referenceType,
        metadata, created_at: new Date().toISOString(),
      };
      const pending = [...this.usageSegmentBuffer, event];
      const receipts: UsageReceipt[] = requestId
        ? [...this.usageReceipts, { requestId, digest }] : this.usageReceipts;
      const refs = [...this.liveBlobs()];
      const unfrozen = pending.slice(this.intent("usage")?.count ?? 0);
      if (unfrozen.length) {
        const prefix = this.freezePrefix(unfrozen, USAGE_EVENT_SEGMENT_SIZE);
        refs.push(prospectiveBlobRef(bufferBytes(prefix) + 1024));
      }
      const runUnfrozen = this.r2SegmentBuffer.slice(this.intent("run")?.count ?? 0);
      if (runUnfrozen.length) {
        refs.push(prospectiveBlobRef(bufferBytes(this.freezePrefix(
          runUnfrozen, RUN_EVENT_SEGMENT_SIZE,
        )) + 1024));
      }
      try {
        const draft = { ...this.snapshot(), runId: effectiveRunId,
          usageSegmentBuffer: pending, usageReceipts: receipts };
        parseRunNotifierJournalState(draft);
        assertNotifierSnapshotBudget(draft, refs, SNAPSHOT_RESERVE_BYTES);
      } catch (error) {
        return jsonResponse({ success: false,
          error: error instanceof NotifierCapacityError ? error.message : "Usage journal capacity exhausted" }, 503);
      }
      this.runId = effectiveRunId;
      this.usageSegmentBuffer = pending;
      this.usageReceipts = receipts;
      try {
        if (!this.intent("usage") &&
          (pending.length >= USAGE_EVENT_SEGMENT_SIZE || bufferBytes(pending) >= MAX_FLUSH_PLAIN_BYTES)) {
          await this.freeze("usage");
        }
        await this.persistState();
      } catch (error) {
        await this.recoverPersistedState(error);
        throw error;
      }
      return jsonResponse({ success: true });
    }).then(async (response) => {
      if (response.ok) {
        const pump = this.pumpBestEffort();
        if (this.state.waitUntil) this.state.waitUntil(pump);
        else await pump;
      }
      return response;
    });
  }
}
