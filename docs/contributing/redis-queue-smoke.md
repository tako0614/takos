# Redis queue smoke

## Purpose

`/scripts/redis-queue-smoke.ts` is a safe-by-default smoke harness for the Takos
PaaS queue plugin/adapter boundary:

- `RedisQueueAdapter` is exercised through its injected
  `RedisQueueCommandClient`.
- The default path uses an in-process dry-run command client and never opens a
  Redis connection.
- The optional real Redis path verifies a single
  `enqueue -> lease -> ack ->
  empty lease` flow with an isolated smoke key
  prefix and cleanup.

This harness is scoped to the queue adapter only. It does not touch S3,
object-storage, MinIO, or storage migration code.

## Default behavior

Run from `takos/paas`:

```sh
deno run --config deno.json \
  --allow-env=TAKOS_RUN_REDIS_QUEUE_SMOKE,TAKOS_REDIS_QUEUE_SMOKE_URL,REDIS_URL \
  scripts/redis-queue-smoke.ts
```

The default mode does not connect to Redis, even if `REDIS_URL` is present. It
uses a fake command client behind `RedisQueueAdapter`, prints the abstract queue
commands observed by that client, and exits successfully when enqueue, lease,
ack, and post-ack empty lease behavior is visible.

## Real Redis plugin opt-in

A real Redis smoke path is available for queue plugin/operator validation only
when both the explicit run flag and a URL are provided:

```sh
TAKOS_RUN_REDIS_QUEUE_SMOKE=1 \
TAKOS_REDIS_QUEUE_SMOKE_URL=redis://localhost:6379 \
  deno run --config deno.json \
    --allow-env=TAKOS_RUN_REDIS_QUEUE_SMOKE,TAKOS_REDIS_QUEUE_SMOKE_URL,REDIS_URL \
    --allow-net \
    scripts/redis-queue-smoke.ts
```

`REDIS_URL` is accepted as a fallback URL for local environments, but the script
still requires `TAKOS_RUN_REDIS_QUEUE_SMOKE=1` before any network connection is
attempted. The real path uses a minimal RESP client local to the smoke script,
creates keys under a unique `takos:queue:smoke:*` prefix, and deletes those keys
before exit.
