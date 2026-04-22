import { createClient } from "redis";
import { logWarn } from "../shared/utils/logger.ts";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

type RedisClient = ReturnType<typeof createClient>;

export interface SseNotifierService {
  /** チャンネルへイベントを送信する（例: "run:{runId}"、"notifications:{userId}"）。 */
  emit(
    channel: string,
    event: { type: string; data: unknown; event_id?: number },
  ): void;

  /** チャンネルを購読し、SSE 形式の ReadableStream を返す。 */
  subscribe(channel: string, lastEventId?: number): ReadableStream<Uint8Array>;

  /** リソース（Redis 接続）を解放する。 */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// リングバッファ
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
  const eventId = preferredEventId && preferredEventId > counter.value
    ? preferredEventId
    : counter.value + 1;
  counter.value = eventId;
  const event: RingBufferEvent = {
    id: eventId,
    type,
    data,
    timestamp: Date.now(),
  };
  buffer.push(event);
  if (buffer.length > RING_BUFFER_SIZE) buffer.shift();
  return event;
}

function getEventsAfter(
  buffer: RingBufferEvent[],
  lastEventId: number,
): RingBufferEvent[] {
  return buffer.filter((e) => e.id > lastEventId);
}

// ---------------------------------------------------------------------------
// SSE フォーマットヘルパー
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function formatSseMessage(event: RingBufferEvent): Uint8Array {
  const lines = [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event.data)}`,
    "",
    "",
  ];
  return encoder.encode(lines.join("\n"));
}

const HEARTBEAT_BYTES = encoder.encode(": heartbeat\n\n");

// ---------------------------------------------------------------------------
// 購読管理
// ---------------------------------------------------------------------------

type Subscriber = (event: RingBufferEvent) => void;

interface ChannelState {
  buffer: RingBufferEvent[];
  counter: { value: number };
  subscribers: Set<Subscriber>;
}

// ---------------------------------------------------------------------------
// Redis Pub/Sub チャンネル命名
// ---------------------------------------------------------------------------

const REDIS_CHANNEL_PREFIX = "takos:sse:";

interface RedisMessage {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// ファクトリ
// ---------------------------------------------------------------------------

export async function createSseNotifierService(
  redisUrl?: string,
): Promise<SseNotifierService> {
  const channels = new Map<string, ChannelState>();

  // Redis クライアント（任意）
  let pubClient: RedisClient | undefined;
  let subClient: RedisClient | undefined;

  // Redis 購読を一元管理し、新規チャンネルを動的に追加できるようにする
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
        // 購読者のエラーは無視（ストリームが既に閉じている可能性がある）
      }
    }
  }

  // URL が指定されている場合のみ Redis の pub/sub を初期化する
  if (redisUrl) {
    pubClient = createClient({ url: redisUrl });
    subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);

    // Redis からのメッセージを受信してローカルで配信する
    subClient.on("message", (redisChannel: string, message: string) => {
      if (!redisChannel.startsWith(REDIS_CHANNEL_PREFIX)) return;
      const channel = redisChannel.slice(REDIS_CHANNEL_PREFIX.length);

      try {
        const parsed = JSON.parse(message) as RedisMessage;
        const state = getOrCreateChannel(channel);
        // ローカルリングバッファへ追加（リモートのイベント ID を使用）
        const event = addToRingBuffer(
          state.buffer,
          state.counter,
          parsed.type,
          parsed.data,
          parsed.id,
        );
        localBroadcast(channel, event);
      } catch {
        // 不正な形式のメッセージは無視
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
        // 不正な形式のメッセージは無視
      }
    });
  }

  // ---------------------------------------------------------------------------
  // サービス実装
  // ---------------------------------------------------------------------------

  const service: SseNotifierService = {
    emit(
      channel: string,
      event: { type: string; data: unknown; event_id?: number },
    ): void {
      const state = getOrCreateChannel(channel);
      const ringEvent = addToRingBuffer(
        state.buffer,
        state.counter,
        event.type,
        event.data,
        event.event_id,
      );

      // ローカル購読者へブロードキャスト
      localBroadcast(channel, ringEvent);

      // マルチインスタンス対応のため Redis へ publish する
      if (pubClient) {
        const redisChannel = `${REDIS_CHANNEL_PREFIX}${channel}`;
        const payload: RedisMessage = {
          id: ringEvent.id,
          type: ringEvent.type,
          data: ringEvent.data,
          timestamp: ringEvent.timestamp,
        };
        pubClient.publish(redisChannel, JSON.stringify(payload)).catch(() => {
          // Redis publish のエラーは無視（ローカル配信は成功済み）
        });
      }
    },

    subscribe(
      channel: string,
      lastEventId?: number,
    ): ReadableStream<Uint8Array> {
      const state = getOrCreateChannel(channel);

      // このチャンネルの Redis 購読を確保（fire-and-forget）
      void ensureRedisSubscription(channel);

      let subscriber: Subscriber | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let cancelled = false;

      return new ReadableStream<Uint8Array>({
        start(controller) {
          // 1. lastEventId 以降のバッファ済みイベントを再送信する
          if (lastEventId !== undefined && lastEventId > 0) {
            const replay = getEventsAfter(state.buffer, lastEventId);
            for (const event of replay) {
              controller.enqueue(formatSseMessage(event));
            }
          }

          // 2. 新規イベントの購読を開始する
          subscriber = (event: RingBufferEvent) => {
            if (cancelled) return;
            try {
              controller.enqueue(formatSseMessage(event));
            } catch {
              // ストリームが閉じられた
              cancelled = true;
            }
          };
          state.subscribers.add(subscriber);

          // 3. 30 秒ごとにハートビートを送信する
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
      // すべての購読者とタイマーを停止・破棄する
      for (const [, state] of channels) {
        state.subscribers.clear();
      }
      channels.clear();
      redisSubscribedChannels.clear();

      // Redis クライアントを切断する
      const disconnects: Promise<unknown>[] = [];
      if (subClient) {
        disconnects.push(
          subClient.quit().catch((err) => {
            logWarn("Failed to quit Redis subscriber client", {
              module: "sse-notifier",
              error: err instanceof Error ? err.message : String(err),
            });
          }),
        );
      }
      if (pubClient) {
        disconnects.push(
          pubClient.quit().catch((err) => {
            logWarn("Failed to quit Redis publisher client", {
              module: "sse-notifier",
              error: err instanceof Error ? err.message : String(err),
            });
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
