# Real Docker Compose smoke harness

`scripts/compose-real-smoke.ts` is an opt-in harness for validating the real
local `compose.local.yml` stack. It is safe by default: without
`TAKOS_RUN_REAL_COMPOSE_SMOKE=1`, it prints a skipped summary and exits `0`
without invoking Docker, rendering compose config, or starting containers.

## Default safe mode

```sh
deno run \
  --config deno.json \
  --allow-env=TAKOS_RUN_REAL_COMPOSE_SMOKE,TAKOS_KEEP_COMPOSE_SMOKE,TAKOS_LOCAL_ENV_FILE,TAKOS_REAL_COMPOSE_SMOKE_TIMEOUT_MS,TAKOS_REAL_COMPOSE_SMOKE_POLL_INTERVAL_MS \
  scripts/compose-real-smoke.ts
```

Expected default result: skipped/safe summary, exit `0`.

## Opt-in real mode

```sh
TAKOS_RUN_REAL_COMPOSE_SMOKE=1 deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local \
  --allow-env \
  --allow-run=docker \
  --allow-net=127.0.0.1 \
  scripts/compose-real-smoke.ts
```

The harness uses a generated compose project name and:

1. checks Docker daemon and `docker compose` availability;
2. renders `docker compose config`;
3. prefers `docker compose up --build --wait` when supported;
4. falls back to `docker compose up --build -d` plus
   `docker compose ps --format json` health polling;
5. verifies compose service state/health and localhost `/health` endpoints; and
6. runs `docker compose down --remove-orphans --timeout 10` in cleanup.

Set `TAKOS_KEEP_COMPOSE_SMOKE=1` with real mode to leave the compose project
running for inspection. The default overall command timeout is `600000` ms and
can be changed with `TAKOS_REAL_COMPOSE_SMOKE_TIMEOUT_MS`. Fallback health
polling defaults to `5000` ms between polls and can be changed with
`TAKOS_REAL_COMPOSE_SMOKE_POLL_INTERVAL_MS`.

## Latest local result

On 2026-04-28, the real opt-in harness was run locally with
`TAKOS_RUN_REAL_COMPOSE_SMOKE=1`. The smoke built the PaaS local image, started
Postgres, Redis, MinIO, PaaS process-role containers, runtime, and
`takos-agent`, verified Compose health plus all mapped `/health` endpoints, and
then cleaned up with `docker compose down`.
