# Redis queue smoke

> このページでわかること: Redis queue プラグインの smoke テスト。

## 目的

`/scripts/redis-queue-smoke.ts` は Takosumi queue storage plugin / adapter 境界の safe-by-default smoke ハーネスです。

- `RedisQueueAdapter` を注入された `RedisQueueCommandClient` 越しに動かす。
- default パスは in-process の dry-run command client を使い、Redis 接続を行わない。
- 任意の real Redis パスは、隔離された smoke key prefix とクリーンアップ付きで `enqueue -> lease -> ack -> 空 lease` の流れを 1 サイクル検証する。

このハーネスは queue adapter のみを対象とし、S3 / object-storage / MinIO / storage migration には触れません。

## Default 挙動

`takos` で実行します。

```sh
deno run --config deno.json \
  --allow-env=TAKOS_RUN_REDIS_QUEUE_SMOKE,TAKOS_REDIS_QUEUE_SMOKE_URL,REDIS_URL \
  scripts/redis-queue-smoke.ts
```

default は `REDIS_URL` があっても Redis に接続しません。`RedisQueueAdapter` の背後で fake command client を使い、観測された抽象 queue コマンドを出力し、enqueue / lease / ack / post-ack の空 lease 挙動が確認できれば成功で終了します。

## 実 Redis plugin の opt-in

Takosumi queue storage plugin 検証用の real Redis smoke は、明示的な run flag と URL の両方が揃ったときのみ動きます。

```sh
TAKOS_RUN_REDIS_QUEUE_SMOKE=1 \
TAKOS_REDIS_QUEUE_SMOKE_URL=redis://localhost:6379 \
  deno run --config deno.json \
    --allow-env=TAKOS_RUN_REDIS_QUEUE_SMOKE,TAKOS_REDIS_QUEUE_SMOKE_URL,REDIS_URL \
    --allow-net \
    scripts/redis-queue-smoke.ts
```

`REDIS_URL` はローカル環境向けの fallback URL として受け付けますが、`TAKOS_RUN_REDIS_QUEUE_SMOKE=1` が無ければネットワーク接続は行いません。real パスは smoke 専用の最小 RESP client を使い、一意な `takos:queue:smoke:*` prefix で key を作成し、終了前に削除します。
