import { logError, logWarn } from '../../shared/utils/logger.ts';
import { NotifierBase, type EmitResult, type jsonResponse as _jsonResponse, type RingBufferEvent } from './notifier-base.ts';

/** User-scoped notification streaming (WebSocket + ring buffer replay). */
export class NotificationNotifierDO extends NotifierBase {
  protected readonly moduleName = 'notificationnotifierdo';
  protected readonly maxConnections = 1000;

  private userId: string | null = null;

  constructor(state: DurableObjectState) {
    super(state);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  protected async loadPersistedState(): Promise<void> {
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
  }

  protected async persistState(): Promise<void> {
    await this.state.storage.put('bufferState', {
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
      userId: this.userId,
    });
  }

  protected override resetState(): void {
    super.resetState();
    this.userId = null;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  protected override isAuthorizedHttp(request: Request): boolean {
    // Notification notifier only accepts internal service calls (no WS auth passthrough)
    return request.headers.get('X-Takos-Internal') === '1';
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  protected override async validateWebSocket(request: Request, _url: URL): Promise<{ reject?: Response; tags?: string[] }> {
    const headerUserId = request.headers.get('X-WS-User-Id');
    if (!headerUserId) {
      return { reject: new Response('Unauthorized', { status: 401 }) };
    }

    if (this.userId && this.userId !== headerUserId) {
      logWarn('NotificationNotifierDO user mismatch', { module: 'security' });
      return { reject: new Response('Forbidden', { status: 403 }) };
    }
    if (!this.userId) {
      this.userId = headerUserId;
      try {
        await this.persistState();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError('persist failed (userId init)', msg, { module: 'notification-notifier' });
        this.userId = null;
        return { reject: new Response('Failed to initialize notifier', { status: 500 }) };
      }
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
  // Event mapping – notifications omit created_at
  // ---------------------------------------------------------------------------

  protected override mapEventForHttp(event: { id: number; type: string; data: unknown; timestamp: number }): Record<string, unknown> {
    return { ...event, event_id: String(event.id) };
  }

  // ---------------------------------------------------------------------------
  // Emit
  // ---------------------------------------------------------------------------

  protected override async processEmit(
    input: { type: string; data: unknown },
    eventId: number,
  ): Promise<EmitResult> {
    const broadcastMessage = JSON.stringify({
      type: input.type,
      data: input.data,
      eventId,
      event_id: String(eventId),
    });
    return { broadcastMessage };
  }

  // ---------------------------------------------------------------------------
  // /state extra
  // ---------------------------------------------------------------------------

  protected override getStateExtra(): Record<string, unknown> {
    return { userId: this.userId };
  }
}

function parseReplayCursor(value: string | null): number | null {
  if (value === null || value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
