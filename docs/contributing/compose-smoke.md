# Compose opt-in smoke script

`scripts/compose-smoke.ts` is a safe-by-default smoke entrypoint for the local
`compose.local.yml` stack.

## Default dry-run

Run the checklist without invoking Docker:

```sh
deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local \
  --allow-env=TAKOS_RUN_COMPOSE_SMOKE,TAKOS_LOCAL_ENV_FILE,TAKOS_COMPOSE_SMOKE_TIMEOUT_MS \
  scripts/compose-smoke.ts
```

Default behavior checks that required services, role labels, healthchecks,
volumes, networks, docker-socket wiring, and non-defaulted compose environment
variables are present. It does **not** run `docker` or `docker compose` unless
`TAKOS_RUN_COMPOSE_SMOKE=1` is set.

Use another env file with `TAKOS_LOCAL_ENV_FILE=path/to/file`; update the
`--allow-read` permission to include that file.

## Opt-in compose execution

To run the local stack smoke, opt in explicitly and grant `docker` execution:

```sh
TAKOS_RUN_COMPOSE_SMOKE=1 deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local \
  --allow-env \
  --allow-run=docker \
  scripts/compose-smoke.ts
```

When enabled, the script uses `Deno.Command` with a minimal explicit environment
and a generated compose project name. It runs:

1. `docker compose config`
2. `docker compose up --build -d`
3. `docker compose ps`
4. `docker compose logs --no-color --tail 200`
5. `docker compose down --remove-orphans --timeout 10` in `finally`

Each command has a timeout safeguard. The default timeout is 300000 ms; override
it with `TAKOS_COMPOSE_SMOKE_TIMEOUT_MS=<milliseconds>`.
