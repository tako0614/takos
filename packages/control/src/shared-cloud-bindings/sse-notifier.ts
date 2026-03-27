import { createClient } from 'redis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RedisClient = ReturnType<typeof createClient>;

export interface SseNotifierService {
  /** Emit an event to a channel (e.g., "run:{runId}" or "notifications:{userId}") */
  emit(channel: string, event: { type: string; data: unknown; event_id?: number }): void;

  /** Subscribe to a channel, returning a ReadableStream of SSE-formatted data */
  subscribe(channel: string, lastEventId?: number): ReadableStream<Uint8Array>;

  /** Dispose of resources (Redis connections) */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 1000;

interface RingBufferEvent {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

function addToRingBuffer(
  buffer: RingBufferEvent[],
  counter: { value: number },
  type: string,
  data: unknown,
  preferredEventId?: number,
): RingBufferEvent {
  const eventId =
    preferredEventId && preferredEventId > counter.value
      ? preferredEventId
      : counter.value + 1;
  counter.value = eventId;
  const event: RingBufferEvent = { id: eventId, type, data, timestamp: Date.now() };
  buffer.push(event);
  if (buffer.length > RING_BUFFER_SIZE) buffer.shift();
  return event;
}

function getEventsAfter(buffer: RingBufferEvent[], lastEventId: number): RingBufferEvent[] {
  return buffer.filter((e) => e.id > lastEventId);
}

// ---------------------------------------------------------------------------
// SSE formatting helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function formatSseMessage(event: RingBufferEvent): Uint8Array {
  const lines = [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event.data)}`,
    '',
    '',
  ];
  return encoder.encode(lines.join('\n'));
}

const HEARTBEAT_BYTES = encoder.encode(': heartbeat\n\n');

// ---------------------------------------------------------------------------
// Subscriber management
// ---------------------------------------------------------------------------

type Subscriber = (event: RingBufferEvent) => void;

interface ChannelState {
  buffer: RingBufferEvent[];
  counter: { value: number };
  subscribers: Set<Subscriber>;
}

// ---------------------------------------------------------------------------
// Redis Pub/Sub channel naming
// ---------------------------------------------------------------------------

const REDIS_CHANNEL_PREFIX = 'takos:sse:';

interface RedisMessage {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createSseNotifierService(redisUrl?: string): Promise<SseNotifierService> {
  const channels = new Map<string, ChannelState>();

  // Redis clients (optional)
  let pubClient: RedisClient | undefined;
  let subClient: RedisClient | undefined;

  // Track all Redis subscriptions so we can add new channels dynamically
  const redisSubscribedChannels = new Set<string>();

  function getOrCreateChannel(channel: string): ChannelState {
    let state = channels.get(channel);
    if (!state) {
      state = {
        buffer: [],
        counter: { value: 0 },
        subscribers: new Set(),
      };
      channels.set(channel, state);
    }
    return state;
  }

  function localBroadcast(channel: string, event: RingBufferEvent): void {
    const state = channels.get(channel);
    if (!state) return;
    for (const subscriber of state.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Ignore subscriber errors — stream may be closed
      }
    }
  }

  // Set up Redis pub/sub if URL is provided
  if (redisUrl) {
    pubClient = createClient({ url: redisUrl });
    subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);

    // Handle incoming messages from Redis and broadcast locally
    subClient.on('message', (redisChannel: string, message: string) => {
      if (!redisChannel.startsWith(REDIS_CHANNEL_PREFIX)) return;
      const channel = redisChannel.slice(REDIS_CHANNEL_PREFIX.length);

      try {
        const parsed = JSON.parse(message) as RedisMessage;
        const state = getOrCreateChannel(channel);
        // Add to local ring buffer (use the remote event id)
        const event = addToRingBuffer(
          state.buffer,
          state.counter,
          parsed.type,
          parsed.data,
          parsed.id,
        );
        localBroadcast(channel, event);
      } catch {
        // Ignore malformed messages
      }
    });
  }

  async function ensureRedisSubscription(channel: string): Promise<void> {
    const redisChannel = `${REDIS_CHANNEL_PREFIX}${channel}`;
    if (!subClient || redisSubscribedChannels.has(redisChannel)) return;
    redisSubscribedChannels.add(redisChannel);
    await subClient.subscribe(redisChannel, (message: string) => {
      if (!channel) return;
      try {
        const parsed = JSON.parse(message) as RedisMessage;
        const state = getOrCreateChannel(channel);
        const event = addToRingBuffer(
          state.buffer,
          state.counter,
          parsed.type,
          parsed.data,
          parsed.id,
        );
        localBroadcast(channel, event);
      } catch {
        // Ignore malformed messages
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Service implementation
  // ---------------------------------------------------------------------------

  const service: SseNotifierService = {
    emit(channel: string, event: { type: string; data: unknown; event_id?: number }): void {
      const state = getOrCreateChannel(channel);
      const ringEvent = addToRingBuffer(
        state.buffer,
        state.counter,
        event.type,
        event.data,
        event.event_id,
      );

      // Broadcast to local subscribers
      localBroadcast(channel, ringEvent);

      // Publish to Redis for multi-instance support
      if (pubClient) {
        const redisChannel = `${REDIS_CHANNEL_PREFIX}${channel}`;
        const payload: RedisMessage = {
          id: ringEvent.id,
          type: ringEvent.type,
          data: ringEvent.data,
          timestamp: ringEvent.timestamp,
        };
        pubClient.publish(redisChannel, JSON.stringify(payload)).catch(() => {
          // Ignore Redis publish errors — local broadcast already succeeded
        });
      }
    },

    subscribe(channel: string, lastEventId?: number): ReadableStream<Uint8Array> {
      const state = getOrCreateChannel(channel);

      // Ensure Redis subscription for this channel (fire-and-forget)
      void ensureRedisSubscription(channel);

      let subscriber: Subscriber | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let cancelled = false;

      return new ReadableStream<Uint8Array>({
        start(controller) {
          // 1. Replay buffered events after lastEventId
          if (lastEventId !== undefined && lastEventId > 0) {
            const replay = getEventsAfter(state.buffer, lastEventId);
            for (const event of replay) {
              controller.enqueue(formatSseMessage(event));
            }
          }

          // 2. Subscribe to new events
          subscriber = (event: RingBufferEvent) => {
            if (cancelled) return;
            try {
              controller.enqueue(formatSseMessage(event));
            } catch {
              // Stream closed
              cancelled = true;
            }
          };
          state.subscribers.add(subscriber);

          // 3. Heartbeat every 30 seconds
          heartbeatTimer = setInterval(() => {
            if (cancelled) {
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              return;
            }
            try {
              controller.enqueue(HEARTBEAT_BYTES);
            } catch {
              cancelled = true;
              if (heartbeatTimer) clearInterval(heartbeatTimer);
            }
          }, 30_000);
        },

        cancel() {
          cancelled = true;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          if (subscriber) {
            state.subscribers.delete(subscriber);
            subscriber = undefined;
          }
        },
      });
    },

    async dispose(): Promise<void> {
      // Clear all subscribers and timers
      for (const [, state] of channels) {
        state.subscribers.clear();
      }
      channels.clear();
      redisSubscribedChannels.clear();

      // Disconnect Redis clients
      const disconnects: Promise<unknown>[] = [];
      if (subClient) {
        disconnects.push(
          subClient.quit().catch((err) => {
            console.warn('[sse-notifier] Failed to quit Redis subscriber client', err);
          }),
        );
      }
      if (pubClient) {
        disconnects.push(
          pubClient.quit().catch((err) => {
            console.warn('[sse-notifier] Failed to quit Redis publisher client', err);
          }),
        );
      }
      await Promise.all(disconnects);
      pubClient = undefined;
      subClient = undefined;
    },
  };

  return service;
}
