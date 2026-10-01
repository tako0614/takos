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
import { projectRunUsageSnapshot } from "../../application/services/app-usage/usage-recorder.ts";
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
import { inspectRunArchiveSegment, readArchiveObjectBytes, RunArchiveIntegrityError } from "../../application/services/offload/indexed-run-events.ts";
import {
  prepareArchiveInsert, queryArchive, stageArchiveInsert, hashArchiveJSON,
} from "./run-archive-index.ts";
import {
  collectRunArchiveGarbage, newRunArchiveState, prepareArchiveStage,
  stageArchiveRetirement, type RunArchiveState,
} from "./run-archive-maintenance.ts";
import {
  addUsageEvents, decodeUsageSegment, newUsageLedgerBuild,
  repairUsageLedger, usageSegmentIndex, UsageLedgerIntegrityError,
  type UsageLedgerState,
} from "./run-usage-ledger.ts";

const MAX_RUN_ID_LENGTH = 64;
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_FLUSH_PLAIN_BYTES = 256 * 1024;
const RECOVERY_ALARM_DELAY_MS = 2_000;
// At most33 node strings of32KiB, including their JSON escaping, plus bounded
// plan/retirement metadata. Reserve the worst case before acknowledging input.
const SNAPSHOT_RESERVE_BYTES = 3 * 1024 * 1024;
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
  private archive: RunArchiveState | null = null;
  private archiveWorkPromise: Promise<void> | null = null;
  private usageLedger: UsageLedgerState | null = null;
  private baselinePromise: Promise<Response | null> | null = null;
  private baselineFenceRequested = false;
  private projectionPromise: Promise<void> | null = null;

  constructor(state: DurableObjectStateBinding, env: Env) {
    super(state);
    this.db = env.DB;
    this.offloadBucket = env.TAKOS_OFFLOAD;
  }

  private snapshot(): RunNotifierJournalState & { schemaVersion: 4 } {
    return {
      schemaVersion: 4,
      archive: this.archive,
      usageLedger: this.usageLedger,
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
    } as RunNotifierJournalState & { schemaVersion: 4 };
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
        const plain = await gzipDecompressToString(bytes, {
          maxDecompressedBytes: 8 * 1024 * 1024, fatalUtf8: true,
        });
        if (plain !== jsonl(pending)) {
          throw new Error("Invalid persisted run notifier journal: flushIntent.prefix");
        }
      }
      if (stored.archive?.stage) {
        const stage = stored.archive.stage;
        const expected = await prepareArchiveInsert(this.state.storage,
          stage.plan.previousRoot, stage.plan.descriptor);
        if (JSON.stringify(expected) !== JSON.stringify(stage.plan) ||
          stage.gc && await hashArchiveJSON(stage.gc.json) !== stage.gc.hash) {
          throw new Error("Invalid persisted run archive insertion plan");
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
    this.archive = stored?.archive ?? null;
    this.usageLedger = stored?.usageLedger ?? null;
    this.needsRecoveryDrain = !!stored && this.hasPending();
    if (this.hasPending() || this.hasArchiveWork() || this.hasLedgerWork()) await this.armRecoveryAlarm();
  }

  private hasPending(): boolean {
    return this.flushIntents.length > 0 || this.r2SegmentBuffer.length > 0 ||
      this.usageSegmentBuffer.length > 0;
  }

  private hasArchiveWork(): boolean {
    return !!this.archive && (this.archive.phase === "building" ||
      this.archive.stage !== null || this.archive.gcTopHash !== null ||
      this.archive.gcCleanupHash !== null);
  }

  private archiveNeedsRepair(): boolean {
    return this.archive?.phase === "repair";
  }

  private hasLedgerWork(): boolean {
    return this.usageLedger?.phase === "building" ||
      this.usageLedger?.phase === "ready" &&
      this.usageLedger.projectedRevision < this.usageLedger.revision;
  }

  private async armRecoveryAlarm(): Promise<void> {
    if (this.archiveNeedsRepair() && !this.hasLedgerWork()) return;
    if (!this.hasPending() && !this.hasArchiveWork() && !this.hasLedgerWork()) return;
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
    request: Request, url: URL, path: string,
  ): Response | Promise<Response> | null {
    if (path === "/archive" && request.method === "GET") {
      return this.handleArchiveQuery(url);
    }
    if (path === "/usage-snapshot" && request.method === "GET") {
      return this.handleUsageSnapshot(url);
    }
    if (path === "/usage-project" && request.method === "POST") {
      return this.handleUsageProject(url);
    }
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

  private async handleUsageSnapshot(url: URL): Promise<Response> {
    const runId = url.searchParams.get("runId");
    if (!isValidRunId(runId)) return jsonResponse({ error: "Invalid runId" }, 400);
    await this.awaitInitialized();
    if (this.runId && this.runId !== runId) return jsonResponse({ error: "runId mismatch" }, 409);
    const unavailable = await this.ensureUsageLedger(runId);
    if (unavailable) return unavailable;
    return this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.runId !== runId || this.usageLedger?.phase !== "ready") return this.usageUnavailable();
      return jsonResponse({ success: true, runId,
        totals: this.usageLedger.totals, revision: this.usageLedger.revision });
    });
  }

  private async handleUsageProject(url: URL): Promise<Response> {
    const runId = url.searchParams.get("runId");
    if (!isValidRunId(runId)) return jsonResponse({ error: "Invalid runId" }, 400);
    await this.awaitInitialized();
    if (this.runId && this.runId !== runId) return jsonResponse({ error: "runId mismatch" }, 409);
    const unavailable = await this.ensureUsageLedger(runId);
    if (unavailable) return unavailable;
    // SQL token usage can change while accepted-event totals stay fixed.
    // Force a new projection witness before taking the SQL snapshot.
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.runId !== runId || this.usageLedger?.phase !== "ready") return;
      if (this.usageLedger.revision === Number.MAX_SAFE_INTEGER) {
        throw new UsageLedgerIntegrityError("Usage revision exhausted");
      }
      this.usageLedger = { ...this.usageLedger, revision: this.usageLedger.revision + 1 };
      try { await this.persistState(); }
      catch (error) { await this.recoverPersistedState(error); throw error; }
    });
    try {
      if (this.projectionPromise) await this.projectionPromise;
      await this.projectUsage();
    } catch (error) {
      return jsonResponse({ success: false,
        error: error instanceof Error ? error.message : String(error) }, 503);
    }
    return this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.runId !== runId || this.usageLedger?.phase !== "ready") return this.usageUnavailable();
      if (this.usageLedger.projectedRevision < this.usageLedger.revision) {
        return jsonResponse({ success: false, error: "Usage projection remains dirty" }, 503);
      }
      return jsonResponse({ success: true, revision: this.usageLedger.projectedRevision });
    });
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
    return this.validateRunEmit(input, true);
  }

  private async validateRunEmit(input: EmitInput, requireReady: boolean): Promise<Response | null> {
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
    if (requireReady && this.offloadBucket && this.archive && this.archive.phase !== "ready") {
      return jsonResponse({ success: false, error: "Run archive is unavailable for writes" }, 503);
    }
    if (requireReady && RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType) &&
      this.offloadBucket && this.usageLedger?.phase !== "ready") {
      return this.usageUnavailable();
    }
    return null;
  }

  protected override async prepareEmit(input: EmitInput): Promise<Response | null> {
    if (!this.offloadBucket) return null;
    const runId = this.runId ?? input.runId;
    if (input.runId !== undefined && this.runId && input.runId !== this.runId) {
      return jsonResponse({ success: false, error: "runId mismatch" }, 409);
    }
    if (!isValidRunId(runId)) {
      return jsonResponse({ success: false, error: "Invalid run identity" }, 400);
    }
    // Do not bind an invalid request or change an already deduplicated result.
    const rejection = await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (input.dedup_key !== undefined && (typeof input.dedup_key !== "string" ||
        !input.dedup_key || input.dedup_key !== input.dedup_key.trim() || input.dedup_key.length > 512)) {
        return jsonResponse({ success: false, error: "Invalid dedup_key" }, 400);
      }
      if (this.runId && this.runId !== runId) return jsonResponse({ error: "runId mismatch" }, 409);
      // Validate receipts and exhausted sequences before bootstrap writes. A
      // building archive may progress, but a rejected request must not bind it.
      const validation = await this.validateRunEmit(input, false);
      if (validation) return validation;
      if (this.eventIdCounter === Number.MAX_SAFE_INTEGER) {
        return jsonResponse({ success: false, error: "Event sequence exhausted" }, 503);
      }
      return null;
    });
    if (rejection) return rejection;
    const archive = await this.ensureArchive(runId);
    if (archive) return archive;
    return RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType)
      ? this.ensureUsageLedger(runId) : null;
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
    const terminal = RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType);
    const ledger = this.usageLedger?.phase === "ready" && terminal
      ? { ...this.usageLedger, revision: this.usageLedger.revision + 1 } : this.usageLedger;
    if (terminal && (!ledger || ledger.phase !== "ready" ||
      !Number.isSafeInteger(ledger.revision))) return this.usageUnavailable();
    const draft = {
      ...this.snapshot(), eventBuffer: prospectiveRing, eventIdCounter: prospectiveId,
      runId: nextRunId, r2SegmentBuffer: pending, emitReceipts: receipts,
      usageLedger: ledger,
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
      // Reserve both bytes and rounded chunk descriptors for a future plan.
      // Counting only bytes could acknowledge data whose later plan exceeds
      // the128-reference head bound even while its total bytes still fit.
      refs.push(prospectiveBlobRef(this.offloadBucket && nextRunId
        ? SNAPSHOT_RESERVE_BYTES : 128 * 1024));
      assertNotifierSnapshotBudget(draft, refs);
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
    if (RUN_TERMINAL_EVENT_TYPES.has(input.type as RunTerminalEventType) &&
      this.usageLedger?.phase === "ready") {
      this.usageLedger = { ...this.usageLedger, revision: this.usageLedger.revision + 1 };
    }
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
      this.usageLedger?.phase === "ready" &&
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
    if (RUN_TERMINAL_EVENT_TYPES.has(_input.type as RunTerminalEventType)) {
      const projection = this.projectUsageBestEffort();
      if (this.state.waitUntil) this.state.waitUntil(projection);
      else await projection;
    }
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

  private async commitArchive(next: RunArchiveState): Promise<void> {
    this.archive = next;
    try {
      await this.persistState();
    } catch (error) {
      await this.recoverPersistedState(error);
      throw error;
    }
  }

  private async ensureArchive(runId: string): Promise<Response | null> {
    if (!this.offloadBucket) return jsonResponse({ error: "Run archive unavailable" }, 503);
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.runId && this.runId !== runId) throw new Error("Run archive identity mismatch");
      if (!this.archive) {
        this.runId = runId;
        await this.commitArchive(newRunArchiveState());
      }
    });
    // An empty fresh archive becomes ready in this request, before accepting
    // its first event. A lost head with existing objects is never assumed fresh.
    const started = Date.now();
    for (let step = 0; step < 8 && Date.now() - started < 20_000 &&
      this.archive?.phase === "building"; step++) {
      try {
        await this.advanceArchive();
      } catch (error) {
        if (!this.archiveNeedsRepair()) throw error;
        break;
      }
    }
    return this.archive?.phase === "ready" ? null : jsonResponse({
      error: this.archive?.error ?? "Run archive index is building; retry later",
    }, 503);
  }

  private usageUnavailable(): Response {
    return jsonResponse({ success: false, error: this.usageLedger?.error ??
      "Usage ledger is building; retry later" }, 503);
  }

  private ensureUsageLedger(runId: string): Promise<Response | null> {
    if (this.runId === runId && this.usageLedger?.phase === "ready") return Promise.resolve(null);
    if (this.usageLedger?.phase === "repair") return Promise.resolve(this.usageUnavailable());
    if (this.baselinePromise) return this.baselinePromise;
    this.baselineFenceRequested = true;
    const running = this.ensureUsageLedgerWork(runId);
    this.baselinePromise = running;
    void running.finally(() => {
      if (this.baselinePromise === running) this.baselinePromise = null;
      this.baselineFenceRequested = false;
    }).catch(() => {});
    return running;
  }

  private async ensureUsageLedgerWork(runId: string): Promise<Response | null> {
    if (!this.offloadBucket) return this.usageUnavailable();
    // A delivery already in flight may publish the last frozen segment. Join
    // it before fixing the immutable migration frontier and pending prefix.
    if (this.pumpPromise) await this.pumpPromise;
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.runId && this.runId !== runId) return;
      if (this.usageLedger) return;
      this.runId = runId;
      const intent = this.intent("usage");
      this.usageLedger = newUsageLedgerBuild(this.usageLastFlushedSegmentIndex,
        this.usageSegmentBuffer.length, intent?.key ?? null, intent?.blob.digest ?? null);
      try { await this.persistState(); }
      catch (error) { await this.recoverPersistedState(error); throw error; }
    });
    if (this.runId !== runId) return jsonResponse({ error: "runId mismatch" }, 409);
    const started = Date.now();
    for (let step = 0; step < 8 && Date.now() - started < 20_000 &&
      this.usageLedger?.phase === "building"; step++) {
      try { await this.advanceUsageLedger(); }
      catch (error) {
        if (error instanceof UsageLedgerIntegrityError) {
          await this.state.blockConcurrencyWhile(async () => {
            await this.awaitInitialized();
            if (this.usageLedger?.phase !== "building") return;
            this.usageLedger = repairUsageLedger(this.usageLedger, error.message);
            try { await this.persistState(); }
            catch (persistError) { await this.recoverPersistedState(persistError); throw persistError; }
          });
          break;
        }
        throw error;
      }
    }
    return this.usageLedger?.phase === "ready" ? null : this.usageUnavailable();
  }

  private async advanceUsageLedger(): Promise<void> {
    const before = this.usageLedger;
    const build = before?.build;
    const runId = this.runId;
    const bucket = this.offloadBucket;
    if (!before || before.phase !== "building" || !build || !runId || !bucket) return;
    if (build.stage === "inventory") {
      const page = await withRemoteDeadline(bucket.list({
        prefix: `runs/${runId}/usage/`, cursor: build.cursor ?? undefined, limit: 1000,
      }), "Usage inventory list");
      if (page.objects.length > 1000 || page.truncated &&
        (page.objects.length === 0 || !page.cursor || page.cursor === build.cursor ||
          page.cursor.length > 2048)) {
        throw new UsageLedgerIntegrityError("Usage inventory pagination failed");
      }
      let scanned = build.scanned;
      let lastKey = build.lastKey;
      for (const object of page.objects) {
        const key = object.key;
        if (typeof key !== "string" || lastKey !== null && key <= lastKey) {
          throw new UsageLedgerIntegrityError("Usage inventory is not strictly ordered");
        }
        const index = usageSegmentIndex(key, runId);
        if (index > build.frontier + 1) {
          throw new UsageLedgerIntegrityError("Usage inventory has an orphan");
        }
        if (index === build.frontier + 1) {
          const pending = this.intent("usage")
            ? this.usageSegmentBuffer.slice(0, this.intent("usage")!.count)
            : this.freezePrefix(this.usageSegmentBuffer,
              Math.min(USAGE_EVENT_SEGMENT_SIZE, this.legacyPendingUsageCount));
          if (!pending.length || key !== (build.intentKey ??
            usageSegmentKey(runId, this.usageSegmentIndex))) {
            throw new UsageLedgerIntegrityError("Unwitnessed usage object above frontier");
          }
          const objectBody = await withRemoteDeadline(bucket.get(key), "Usage intent GET");
          if (!objectBody) throw new UsageLedgerIntegrityError("Listed usage intent is missing");
          const bytes = await this.readUsageBytes(objectBody, "Usage intent body");
          if (bytes.byteLength > 8 * 1024 * 1024) {
            throw new UsageLedgerIntegrityError("Usage intent exceeds byte limit");
          }
          const intent = this.intent("usage");
          if (!(intent && await sha256(bytes) === build.intentDigest)) {
            if (intent?.origin !== "legacy" && this.legacyPendingUsageCount === 0) {
              throw new UsageLedgerIntegrityError("Usage intent bytes conflict");
            }
            const decoded = await decodeUsageSegment(bytes);
            if (jsonl(decoded) !== jsonl(pending)) {
              throw new UsageLedgerIntegrityError("Legacy usage intent prefix conflict");
            }
          }
        }
        else scanned++;
        lastKey = key;
      }
      if (!page.truncated && scanned !== build.frontier) {
        throw new UsageLedgerIntegrityError("Usage inventory is incomplete");
      }
      const next = { ...before, build: { ...build, scanned, lastKey,
        cursor: page.truncated ? page.cursor! : null,
        stage: page.truncated ? "inventory" as const : "fold" as const } };
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (this.usageLedger !== before) return;
        this.usageLedger = next;
        try { await this.persistState(); }
        catch (error) { await this.recoverPersistedState(error); throw error; }
      });
      return;
    }
    if (build.nextIndex <= build.frontier) {
      const key = usageSegmentKey(runId, build.nextIndex);
      const object = await withRemoteDeadline(bucket.get(key), "Usage segment GET");
      if (!object) throw new UsageLedgerIntegrityError(`Usage segment missing: ${key}`);
      const bytes = await this.readUsageBytes(object, "Usage segment body");
      const events = await decodeUsageSegment(bytes);
      const totals = addUsageEvents(before.totals, events);
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (this.usageLedger !== before) return;
        this.usageLedger = { ...before, totals,
          build: { ...build, nextIndex: build.nextIndex + 1 } };
        try { await this.persistState(); }
        catch (error) { await this.recoverPersistedState(error); throw error; }
      });
      return;
    }
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.usageLedger !== before) return;
      if (this.usageSegmentBuffer.length !== build.pendingCount ||
        this.usageLastFlushedSegmentIndex !== build.frontier) {
        throw new UsageLedgerIntegrityError("Usage baseline witness changed");
      }
      const totals = addUsageEvents(before.totals, this.usageSegmentBuffer);
      this.usageLedger = { phase: "ready", totals, revision: 1,
        projectedRevision: 0, build: null, error: null };
      try { await this.persistState(); }
      catch (error) { await this.recoverPersistedState(error); throw error; }
    });
  }

  private async readUsageBytes(
    object: Parameters<typeof readArchiveObjectBytes>[0], label: string,
  ): Promise<ArrayBuffer> {
    try {
      return await withRemoteDeadline(readArchiveObjectBytes(object), label);
    } catch (error) {
      if (error instanceof RunArchiveIntegrityError) {
        throw new UsageLedgerIntegrityError(error.message);
      }
      throw error;
    }
  }

  private projectUsageBestEffort(): Promise<void> {
    if (this.projectionPromise) return this.projectionPromise;
    const work = this.projectUsage().catch((error) => {
      logWarn("Run usage projection retained for retry", { module: this.moduleName,
        detail: error instanceof Error ? error.message : String(error) });
    });
    this.projectionPromise = work;
    void work.finally(() => { if (this.projectionPromise === work) this.projectionPromise = null; });
    return work;
  }

  private async projectUsage(): Promise<void> {
    const captured = await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (!this.runId || this.usageLedger?.phase !== "ready" ||
        this.usageLedger.projectedRevision >= this.usageLedger.revision) return null;
      return { runId: this.runId, revision: this.usageLedger.revision,
        totals: { ...this.usageLedger.totals } };
    });
    if (!captured) return;
    await withRemoteDeadline(projectRunUsageSnapshot(this.db, captured.runId, captured.totals),
      "SQL Run usage projection");
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.runId !== captured.runId || this.usageLedger?.phase !== "ready" ||
        this.usageLedger.projectedRevision >= captured.revision) return;
      this.usageLedger = { ...this.usageLedger, projectedRevision: captured.revision };
      try { await this.persistState(); }
      catch (error) { await this.recoverPersistedState(error); throw error; }
    });
  }

  private async handleArchiveQuery(url: URL): Promise<Response> {
    const runId = url.searchParams.get("runId");
    const after = this.parseReplayAfter(url.searchParams.get("after"));
    const rawLimit = url.searchParams.get("limit") ?? "500";
    const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!isValidRunId(runId) || after === null || !Number.isSafeInteger(limit) || limit < 1 || limit > 2001) {
      return jsonResponse({ error: "Invalid archive query" }, 400);
    }
    if (this.runId && this.runId !== runId) return jsonResponse({ error: "runId mismatch" }, 409);
    const unavailable = await this.ensureArchive(runId);
    if (unavailable) return unavailable;
    return this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (!this.archive || this.archive.phase !== "ready") return jsonResponse({ error: "Archive unavailable" }, 503);
      const page = await queryArchive(this.state.storage, this.archive.root, after, Math.min(limit, 512));
      // Pending follows the whole finalized catalog, not merely this page.
      // Returning it before omitted descriptors would let a reader skip history.
      const pending = page.hasMore ? [] : this.r2SegmentBuffer.filter((event) => event.event_id > after).slice(0, limit);
      const morePending = !page.hasMore && this.r2SegmentBuffer.filter((event) => event.event_id > after).length > pending.length;
      return jsonResponse({ schemaVersion: 1, runId, descriptors: page.descriptors,
        pending, hasMore: page.hasMore || morePending });
    });
  }

  private advanceArchive(): Promise<void> {
    if (this.archiveWorkPromise) return this.archiveWorkPromise;
    const work = this.advanceArchiveStep().catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (error instanceof RunArchiveIntegrityError || error instanceof SyntaxError || code === "Z_DATA_ERROR" ||
        /repair required|migration repair|pagination failed|page capacity|Invalid run archive/i.test(message)) {
        await this.state.blockConcurrencyWhile(async () => {
          await this.awaitInitialized();
          if (this.archive?.phase === "building") await this.commitArchive({
            ...this.archive, phase: "repair", error: `Archive migration requires repair: ${message}`.slice(0, 512),
          });
        });
      }
      throw error;
    });
    this.archiveWorkPromise = work;
    void work.finally(() => {
      if (this.archiveWorkPromise === work) this.archiveWorkPromise = null;
    }).catch(() => {});
    return work;
  }

  private async finishArchiveStage(): Promise<void> {
    const archive = this.archive;
    if (!archive?.stage) return;
    const stage = archive.stage;
    await stageArchiveInsert(this.state.storage, stage.plan);
    await stageArchiveRetirement(this.state.storage, stage);
    const next = { ...archive, root: stage.plan.root, stage: null,
      gcTopHash: stage.gc?.hash ?? archive.gcTopHash,
      gcRecords: archive.gcRecords + (stage.gc ? 1 : 0) };
    if (stage.purpose === "build") {
      if (!next.build) throw new Error("Archive build frontier missing");
      next.build = { ...next.build, keyIndex: next.build.keyIndex + 1,
        scanned: next.build.scanned + 1 };
    }
    await this.commitArchive(next);
  }

  private async advanceArchiveStep(): Promise<void> {
    const runId = this.runId;
    if (!this.offloadBucket || !runId || this.archive?.phase !== "building") return;
    // Finish durable work without another R2 read after a cold replacement.
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.archive?.stage?.purpose === "build") await this.finishArchiveStage();
      if (this.archive && !this.archive.stage) await collectRunArchiveGarbage(
        this.state.storage, this.archive, (next) => this.commitArchive(next),
      );
    });
    const before = this.archive;
    const build = before?.build;
    if (!before || before.phase !== "building" || !build) return;
    if (!build.pageLoaded) {
      const page = await withRemoteDeadline(this.offloadBucket.list({
        prefix: `runs/${runId}/events/`, cursor: build.cursor ?? undefined, limit: 32,
      }), "Archive migration list");
      if (page.objects.length > 32) throw new Error("Archive migration page capacity exceeded");
      const keys = page.objects.map((object) => object.key);
      const nextCursor = page.truncated ? page.cursor : null;
      const nextHash = nextCursor ? await hashArchiveJSON(nextCursor) : null;
      if (page.truncated && (!nextCursor || nextCursor === build.cursor ||
        nextHash && build.seenCursorHashes.includes(nextHash))) {
        throw new Error("Archive migration pagination failed to progress");
      }
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (this.archive !== before) return;
        await this.commitArchive({ ...before, build: { ...build, keys, keyIndex: 0,
          pageLoaded: true, nextCursor: nextCursor ?? null, truncated: page.truncated,
          seenCursorHashes: nextHash ? [...build.seenCursorHashes, nextHash] : build.seenCursorHashes } });
      });
    }
    const current = this.archive;
    const active = current?.build;
    if (!current || current.phase !== "building" || !active) return;
    if (active.keyIndex === active.keys.length) {
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (this.archive !== current) return;
        if (!active.truncated) {
          // Segment keys advance with accepted event IDs. The final committed
          // segment must exist even if every retained ring event is pending.
          if (this.r2LastFlushedSegmentIndex > 0) {
            const final = await queryArchive(this.state.storage, current.root,
              Math.max(0, current.root.lastEventId - 1), 1);
            const descriptor = final.descriptors[0];
            if (!descriptor || descriptor.segmentIndex !== this.r2LastFlushedSegmentIndex ||
              descriptor.key !== buildRunEventSegmentKey(runId, this.r2LastFlushedSegmentIndex)) {
              throw new Error("Finalized Run archive segment is missing from legacy index; repair required");
            }
          }
          // Retained ring entries outside pending must have a matching archive
          // record. Preferred IDs can jump: absence of an arbitrary ID is not loss.
          for (const event of this.eventBuffer) {
            if (this.r2SegmentBuffer.some((pending) => pending.event_id === event.id)) continue;
            if (!active.ringWitnesses.includes(event.id)) {
              throw new Error("Known Run ring event is missing from legacy archive; repair required");
            }
          }
          await this.commitArchive({ ...current, phase: "ready", build: null });
        } else {
          await this.commitArchive({ ...current, build: { ...active, cursor: active.nextCursor,
            keys: [], keyIndex: 0, nextCursor: null, truncated: false, pageLoaded: false } });
        }
      });
      return;
    }
    const key = active.keys[active.keyIndex]!;
    const match = key.match(new RegExp(`^runs/${runId}/events/(\\d+)\\.jsonl\\.gz$`));
    const segmentIndex = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 1 ||
      key !== buildRunEventSegmentKey(runId, segmentIndex)) {
      throw new Error("Noncanonical legacy archive key; repair required");
    }
    const object = await withRemoteDeadline(this.offloadBucket.get(key), "Archive migration GET");
    if (!object) throw new Error("Legacy archive object disappeared; repair required");
    const bytes = await withRemoteDeadline(readArchiveObjectBytes(object), "Archive migration body");
    const { plain, descriptor, events } = await inspectRunArchiveSegment(bytes, key, segmentIndex, runId);
    if (descriptor.lastEventId > this.eventIdCounter) throw new Error("Legacy archive exceeds accepted counter; repair required");
    for (const event of events) {
      const ring = this.eventBuffer.find((entry) => entry.id === event.event_id);
      if (ring && (ring.type !== event.type || this.stringifyPersistedData(ring.data) !== event.data)) {
        throw new Error("Legacy archive conflicts with retained ring; repair required");
      }
    }
    const ringWitnesses = [...new Set([...active.ringWitnesses,
      ...events.filter((event) => this.eventBuffer.some((ring) => ring.id === event.event_id)).map((event) => event.event_id)])];
    if (segmentIndex > this.r2LastFlushedSegmentIndex) {
      const intent = this.intent("run");
      const expectedKey = intent?.key ?? buildRunEventSegmentKey(runId,
        Math.max(this.r2SegmentIndex, this.r2LastFlushedSegmentIndex + 1,
          segmentIndexForEventId(this.r2SegmentBuffer[0]?.event_id ?? 1)));
      const pending = this.r2SegmentBuffer.slice(0, events.length);
      if (key !== expectedKey || pending.length !== events.length ||
        jsonl(pending) !== plain || intent &&
        (intent.blob.digest !== descriptor.sha256 && intent.origin !== "legacy")) {
        throw new Error("Uncommitted legacy archive object lacks a pending witness; repair required");
      }
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (this.archive === current) await this.commitArchive({ ...current,
          build: { ...active, ringWitnesses, keyIndex: active.keyIndex + 1, scanned: active.scanned + 1 } });
      });
      return;
    }
    await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      if (this.archive !== current) return;
      const plan = await prepareArchiveInsert(this.state.storage, current.root, descriptor);
      const stage = await prepareArchiveStage(current, "build", plan);
      await this.commitArchive({ ...current, build: { ...active, ringWitnesses }, stage });
      await this.finishArchiveStage();
    });
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
    if (intent.kind === "usage" &&
      (this.baselineFenceRequested || this.usageLedger?.phase === "building")) return;
    const bytes = await readNotifierBlob(this.state.storage, intent.blob);
    const existing = await withRemoteDeadline(this.offloadBucket.get(intent.key), "R2 get");
    if (existing) {
      const current = await withRemoteDeadline(readArchiveObjectBytes(existing), "R2 body read");
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
            maxDecompressedBytes: 8 * 1024 * 1024, fatalUtf8: true,
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
        ? await withRemoteDeadline(readArchiveObjectBytes(readback), "R2 readback body") : null;
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
        if (!this.archive || this.archive.phase !== "ready") throw new Error("Archive index is not ready");
        if (!this.archive.stage) {
          await collectRunArchiveGarbage(this.state.storage, this.archive,
            (next) => this.commitArchive(next));
          const archive = this.archive;
          const prefix = this.r2SegmentBuffer.slice(0, intent.count);
          const descriptor = { key: intent.key, segmentIndex: intent.segmentIndex,
            firstEventId: prefix[0]!.event_id, lastEventId: prefix.at(-1)!.event_id,
            count: intent.count, sha256: intent.blob.digest, bytes: intent.blob.bytes };
          const plan = await prepareArchiveInsert(this.state.storage, archive.root, descriptor);
          const stage = await prepareArchiveStage(archive, "flush", plan);
          await this.commitArchive({ ...archive, stage });
        }
        const archive = this.archive;
        const stage = archive.stage;
        if (!stage || stage.purpose !== "flush" || stage.plan.descriptor.key !== intent.key) {
          throw new Error("Archive insertion frontier mismatch");
        }
        await stageArchiveInsert(this.state.storage, stage.plan);
        await stageArchiveRetirement(this.state.storage, stage);
        this.archive = { ...archive, root: stage.plan.root, stage: null,
          gcTopHash: stage.gc?.hash ?? archive.gcTopHash,
          gcRecords: archive.gcRecords + (stage.gc ? 1 : 0) };
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
      if (this.offloadBucket && this.runId && this.archive?.phase !== "ready") {
        const unavailable = await this.ensureArchive(this.runId);
        if (unavailable) return;
      }
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
            } else if (!this.baselineFenceRequested && this.usageLedger?.phase !== "building" &&
              (this.usageSegmentBuffer.length >= USAGE_EVENT_SEGMENT_SIZE ||
              bufferBytes(this.usageSegmentBuffer) >= MAX_FLUSH_PLAIN_BYTES)) {
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
        const intent = this.flushIntents.find((candidate) => candidate.kind !== "usage" ||
          !this.baselineFenceRequested && this.usageLedger?.phase !== "building");
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
    if (this.runId && this.usageLedger?.phase === "building") {
      try { await this.ensureUsageLedger(this.runId); }
      catch (error) {
        logWarn("Usage ledger migration deferred", { module: this.moduleName,
          detail: error instanceof Error ? error.message : String(error) });
      }
    }
    if (this.hasLedgerWork() && this.usageLedger?.phase === "ready") {
      await this.projectUsageBestEffort();
    }
    if (this.offloadBucket && this.runId) {
      try {
        // Bootstrap and resume share one budget. Calling ensureArchive and
        // then another progress loop gave a first alarm twice the step limit.
        if (!this.archive || this.archive.phase === "building") await this.ensureArchive(this.runId);
      } catch (error) {
        logWarn("Run archive migration deferred", { module: this.moduleName,
          detail: error instanceof Error ? error.message : String(error) });
        await this.armRecoveryAlarm();
        return;
      }
      await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        if (this.archive) await collectRunArchiveGarbage(this.state.storage,
          this.archive, (next) => this.commitArchive(next));
      });
      if (this.archive?.phase !== "ready") {
        await this.armRecoveryAlarm();
        return;
      }
    }
    if (this.offloadBucket && this.hasPending()) {
      await this.state.blockConcurrencyWhile(async () => {
        for (const kind of ["run", "usage"] as const) {
          if (kind === "usage" &&
            (this.baselineFenceRequested || this.usageLedger?.phase === "building")) continue;
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
    if (this.hasArchiveWork() || this.hasLedgerWork()) await this.armRecoveryAlarm();
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
              if (kind === "usage" &&
                (this.baselineFenceRequested || this.usageLedger?.phase === "building")) continue;
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
    const rejection = await this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
      return this.validateUsageBeforeArchive(input);
    });
    if (rejection) return rejection;
    const runId = this.runId ?? input.runId;
    const parsedUnits = typeof input.units === "number" ? input.units : parseFloat(String(input.units ?? ""));
    if (this.offloadBucket && isValidRunId(runId) &&
      (input.runId === undefined || input.runId === runId) &&
      typeof input.meter_type === "string" && input.meter_type.trim() &&
      Number.isFinite(parsedUnits) && parsedUnits > 0 &&
      (input.request_id === undefined || typeof input.request_id === "string" &&
        input.request_id.trim() === input.request_id && input.request_id.length > 0 && input.request_id.length <= 512)) {
      const unavailable = await this.ensureArchive(runId);
      if (unavailable) return unavailable;
      const ledgerUnavailable = await this.ensureUsageLedger(runId);
      if (ledgerUnavailable) return ledgerUnavailable;
    }
    return this.state.blockConcurrencyWhile(async () => {
      await this.awaitInitialized();
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
      if (this.archive?.phase !== "ready") {
        return jsonResponse({ success: false, error: "Run archive index is building" }, 503);
      }
      if (this.usageLedger?.phase !== "ready") return this.usageUnavailable();
      if (this.usageSegmentIndex === Number.MAX_SAFE_INTEGER) {
        return jsonResponse({ success: false, error: "Usage sequence exhausted" }, 503);
      }
      if (this.usageLedger.revision === Number.MAX_SAFE_INTEGER) {
        return jsonResponse({ success: false, error: "Usage revision exhausted" }, 503);
      }
      const event: PersistedUsageEvent = {
        meter_type: meterType, units, reference_type: referenceType,
        metadata, created_at: new Date().toISOString(),
      };
      const pending = [...this.usageSegmentBuffer, event];
      const receipts: UsageReceipt[] = requestId
        ? [...this.usageReceipts, { requestId, digest }] : this.usageReceipts;
      let ledger: UsageLedgerState;
      try {
        ledger = { ...this.usageLedger,
          totals: addUsageEvents(this.usageLedger.totals, [event]),
          revision: this.usageLedger.revision + 1 };
      } catch (error) {
        return jsonResponse({ success: false,
          error: error instanceof Error ? error.message : "Usage total overflow" }, 503);
      }
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
          usageSegmentBuffer: pending, usageReceipts: receipts,
          usageLedger: ledger };
        parseRunNotifierJournalState(draft);
        refs.push(prospectiveBlobRef(SNAPSHOT_RESERVE_BYTES));
        assertNotifierSnapshotBudget(draft, refs);
      } catch (error) {
        return jsonResponse({ success: false,
          error: error instanceof NotifierCapacityError ? error.message : "Usage journal capacity exhausted" }, 503);
      }
      this.runId = effectiveRunId;
      this.usageSegmentBuffer = pending;
      this.usageReceipts = receipts;
      this.usageLedger = ledger;
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
        const projection = this.projectUsageBestEffort();
        if (this.state.waitUntil) this.state.waitUntil(projection);
        else await projection;
      }
      return response;
    });
  }

  private async validateUsageBeforeArchive(input: UsageInput): Promise<Response | null> {
    if (input.runId !== undefined) {
      if (!isValidRunId(input.runId)) return jsonResponse({ success: false, error: "Invalid runId" }, 400);
      if (this.runId && input.runId !== this.runId) return jsonResponse({ success: false, error: "runId mismatch" }, 409);
    }
    const meterType = typeof input.meter_type === "string" ? input.meter_type.trim() : "";
    const units = typeof input.units === "number" ? input.units : parseFloat(String(input.units ?? ""));
    if (!meterType) return jsonResponse({ success: false, error: "meter_type is required" }, 400);
    if (!Number.isFinite(units) || units <= 0) return jsonResponse({ success: false, error: "units must be positive" }, 400);
    if (input.request_id !== undefined && (typeof input.request_id !== "string" ||
      !input.request_id || input.request_id !== input.request_id.trim() || input.request_id.length > 512)) {
      return jsonResponse({ success: false, error: "Invalid request_id" }, 400);
    }
    const runId = this.runId ?? input.runId;
    if (input.request_id && runId) {
      const receipt = this.usageReceipts.find((entry) => entry.requestId === input.request_id);
      if (receipt) {
        const digest = await digestNotifierPayload({ runId, meterType, units,
          referenceType: typeof input.reference_type === "string" ? input.reference_type : null,
          metadata: input.metadata ?? null });
        return receipt.digest === digest ? jsonResponse({ success: true, duplicate: true })
          : jsonResponse({ success: false, error: "request_id payload conflict" }, 409);
      }
    }
    if (!this.offloadBucket || !runId) return jsonResponse({ success: false, error: "Usage offload unavailable" }, 503);
    if (this.usageSegmentIndex === Number.MAX_SAFE_INTEGER) return jsonResponse({ success: false, error: "Usage sequence exhausted" }, 503);
    return null;
  }
}
