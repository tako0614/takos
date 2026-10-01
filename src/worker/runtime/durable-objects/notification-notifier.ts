import type { DurableObjectStateBinding } from "../../shared/types/bindings.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import {
  type EmitResult,
  jsonResponse,
  NotifierBase,
  parseReplayCursor,
  toWsEnvelope,
  type RingBufferEvent,
} from "./notifier-base.ts";
import { parseNotificationNotifierState } from "./notifier-state.ts";
import {
  assertNotifierSnapshotBudget,
  digestNotifierPayload,
  loadNotifierSnapshot,
  NotifierCapacityError,
  persistNotifierSnapshot,
} from "./notifier-journal.ts";

type EmitInput = { type: string; data: unknown; [key: string]: unknown };
type Receipt = { key: string; digest: string; eventId: number };

function parseState(raw: unknown) {
  if (!raw || typeof raw !== "object" ||
    (raw as Record<string, unknown>).schemaVersion !== 2) {
    const legacy = parseNotificationNotifierState(raw);
    return legacy && { ...legacy, emitReceipts: [] as Receipt[] };
  }
  const value = raw as Record<string, unknown>;
  const keys = ["schemaVersion", "eventBuffer", "eventIdCounter", "userId", "emitReceipts"];
  const invalid = () => { throw new Error("Invalid persisted notification journal: receipts"); };
  if (Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))) invalid();
  const state = parseNotificationNotifierState({
    schemaVersion: 1, eventBuffer: value.eventBuffer,
    eventIdCounter: value.eventIdCounter, userId: value.userId,
  })!;
  if (!Array.isArray(value.emitReceipts) || value.emitReceipts.length > state.eventBuffer.length) invalid();
  const seen = new Set<string>();
  const seenEventIds = new Set<number>();
  const replayIds = new Set(state.eventBuffer.map((event) => event.id));
  const receipts = (value.emitReceipts as unknown[]).map((rawReceipt): Receipt => {
    if (!rawReceipt || typeof rawReceipt !== "object" || Array.isArray(rawReceipt)) invalid();
    const receipt = rawReceipt as Record<string, unknown>;
    if (Object.keys(receipt).length !== 3 ||
      Object.keys(receipt).some((key) => !["key", "digest", "eventId"].includes(key)) ||
      typeof receipt.key !== "string" || !receipt.key.trim() || receipt.key !== receipt.key.trim() ||
      receipt.key.length > 512 || seen.has(receipt.key) ||
      typeof receipt.digest !== "string" || !/^[a-f0-9]{64}$/.test(receipt.digest) ||
      typeof receipt.eventId !== "number" || !Number.isSafeInteger(receipt.eventId) ||
      receipt.eventId <= 0 || seenEventIds.has(receipt.eventId) || !replayIds.has(receipt.eventId)) invalid();
    seen.add(receipt.key as string);
    seenEventIds.add(receipt.eventId as number);
    return { key: receipt.key as string, digest: receipt.digest as string, eventId: receipt.eventId as number };
  });
  return { ...state, emitReceipts: receipts };
}

/** Instance-owner notification streaming (WebSocket + ring buffer replay). */
export class NotificationNotifierDO extends NotifierBase {
  protected readonly moduleName = "notificationnotifierdo";
  protected readonly maxConnections = 1000;
  protected override readonly journalKind = "notification";

  private userId: string | null = null;
  private emitReceipts: Receipt[] = [];

  constructor(state: DurableObjectStateBinding) {
    super(state);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  protected async loadPersistedState(): Promise<void> {
    const stored = parseState(
      await loadNotifierSnapshot(this.state.storage, "notification"),
    );
    if (stored !== null) {
      for (const receipt of stored.emitReceipts) {
        const event = stored.eventBuffer.find((entry) => entry.id === receipt.eventId)!;
        if (await digestNotifierPayload({ type: event.type, data: event.data }) !== receipt.digest) {
          throw new Error("Invalid persisted notification journal: receipt payload");
        }
      }
      this.eventBuffer = stored.eventBuffer;
      this.eventIdCounter = stored.eventIdCounter;
      this.userId = stored.userId;
      this.emitReceipts = stored.emitReceipts;
    } else {
      this.eventBuffer = [];
      this.eventIdCounter = 0;
      this.userId = null;
      this.emitReceipts = [];
    }
  }

  protected async persistState(): Promise<void> {
    const snapshot = this.snapshot();
    parseState(snapshot);
    await persistNotifierSnapshot(this.state.storage, "notification", snapshot);
  }

  private snapshot() {
    return {
      schemaVersion: 2,
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
      userId: this.userId,
      emitReceipts: this.emitReceipts,
    };
  }

  private receiptKey(input: EmitInput): string | null {
    if (input.type === "notification.new" && input.data && typeof input.data === "object") {
      const id = (input.data as Record<string, unknown>).notification_id;
      if (typeof id === "string" && id.trim() && id.length <= 480) return `notification:${id}`;
    }
    if (typeof input.dedup_key === "string") return input.dedup_key;
    if (input.event_id !== undefined) return `event:${Number(input.event_id)}`;
    return null;
  }

  private replayReceipts(buffer: RingBufferEvent[]): Receipt[] {
    // This stream carries inbox refresh hints, not the durable inbox rows.
    // Receipts cover the replay horizon. A retired hint may be delivered again
    // with the same notification ID; SQL inbox identity remains idempotent.
    const replayIds = new Set(buffer.map((event) => event.id));
    return this.emitReceipts.filter((receipt) => replayIds.has(receipt.eventId));
  }

  protected override async validateEmit(input: EmitInput): Promise<Response | null> {
    if (input.dedup_key !== undefined &&
      (typeof input.dedup_key !== "string" || !input.dedup_key.trim() ||
        input.dedup_key !== input.dedup_key.trim() || input.dedup_key.length > 512)) {
      return jsonResponse({ success: false, error: "Invalid dedup_key" }, 400);
    }
    const key = this.receiptKey(input);
    const receipt = key ? this.emitReceipts.find((entry) => entry.key === key) : undefined;
    if (receipt) {
      const digest = await digestNotifierPayload({ type: input.type, data: input.data });
      return receipt.digest === digest
        ? jsonResponse({ success: true, duplicate: true, eventId: receipt.eventId })
        : jsonResponse({ success: false, error: "Notification retry payload conflict" }, 409);
    }
    return null;
  }

  protected override async validateEmitCapacity(
    input: EmitInput,
    prospectiveBuffer: RingBufferEvent[],
    eventId: number,
  ): Promise<Response | null> {
    try {
      const key = this.receiptKey(input);
      const retained = this.replayReceipts(prospectiveBuffer);
      const receipts = key ? [...retained, {
        key, digest: await digestNotifierPayload({ type: input.type, data: input.data }), eventId,
      }] : retained;
      const draft = {
        ...this.snapshot(),
        eventBuffer: prospectiveBuffer,
        eventIdCounter: eventId,
        emitReceipts: receipts,
      };
      parseState(draft);
      assertNotifierSnapshotBudget(draft);
    } catch (error) {
      if (error instanceof NotifierCapacityError) {
        return jsonResponse({ success: false, error: error.message }, 503);
      }
      throw error;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  protected override isAuthorizedHttp(_request: Request): boolean {
    // Notification notifier is only reachable via service binding (Durable
    // Object stub). The binding itself is the trust boundary — no header-based
    // auth is needed. External requests cannot reach this DO directly.
    return true;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  protected override async validateWebSocket(
    request: Request,
    _url: URL,
  ): Promise<{ reject?: Response; tags?: string[] }> {
    const headerUserId = request.headers.get("X-WS-User-Id");
    if (!headerUserId?.trim()) {
      return { reject: new Response("Unauthorized", { status: 401 }) };
    }

    if (this.userId && this.userId !== headerUserId) {
      logWarn("NotificationNotifierDO user mismatch", { module: "security" });
      return { reject: new Response("Forbidden", { status: 403 }) };
    }
    if (!this.userId) {
      try {
        await this.state.blockConcurrencyWhile(async () => {
          await this.awaitInitialized();
          if (this.userId && this.userId !== headerUserId) return;
          this.userId = headerUserId;
          try {
            await this.persistState();
          } catch (error) {
            await this.recoverPersistedState(error);
            throw error;
          }
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError("persist failed (userId init)", msg, {
          module: "notification-notifier",
        });
        return {
          reject: new Response("Failed to initialize notifier", {
            status: 500,
          }),
        };
      }
    }
    if (this.userId !== headerUserId) {
      return { reject: new Response("Forbidden", { status: 403 }) };
    }

    return {};
  }

  protected override parseWsLastEventId(raw: string | null): number | null {
    return parseReplayCursor(raw);
  }

  protected override parseReplayAfter(raw: string | null): number | null {
    return parseReplayCursor(raw);
  }

  // ---------------------------------------------------------------------------
  // Event mapping
  // ---------------------------------------------------------------------------
  // Inherits the base `mapEventForHttp` which emits the canonical envelope
  // shape (`event_id` + `created_at` from the ring-buffer timestamp).

  // ---------------------------------------------------------------------------
  // Emit
  // ---------------------------------------------------------------------------

  protected override async processEmit(
    input: EmitInput,
    eventId: number,
  ): Promise<EmitResult> {
    const key = this.receiptKey(input);
    this.emitReceipts = this.replayReceipts(this.eventBuffer);
    if (key) this.emitReceipts.push({
      key, digest: await digestNotifierPayload({ type: input.type, data: input.data }), eventId,
    });
    // Carry `created_at` so generic WebSocket clients receive the same
    // envelope shape across notifier subclasses (matches RunNotifierDO).
    const broadcastMessage = JSON.stringify(
      toWsEnvelope({
        type: input.type,
        data: input.data,
        eventId,
        createdAt: new Date().toISOString(),
      }),
    );
    return { broadcastMessage };
  }

  // ---------------------------------------------------------------------------
  // /state extra
  // ---------------------------------------------------------------------------

  protected override getStateExtra(): Record<string, unknown> {
    return { userId: this.userId };
  }
}
