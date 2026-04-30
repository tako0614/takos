# Plugin-backed infrastructure readiness runbook

`scripts/real-backend-readiness.ts` is a no-start readiness gate for deciding
which plugin-backed infrastructure smoke checks can run from `takos/paas`. These
checks are operator proofs for plugin/local adapter wiring. They are not PaaS
kernel release criteria.

The script checks:

- required command-line tools: `docker`, `docker compose`, and `git`
- optional `psql` availability for manual Postgres inspection
- required local files: `compose.local.yml`, `.env.local.example`, and the
  selected env file (`TAKOS_LOCAL_ENV_FILE`, default `.env.local`)
- non-defaulted `${VAR}` references in `compose.local.yml` are present in the
  selected env file
- host port availability for the local real backend stack
- which existing smoke scripts are ready to run

It intentionally does **not** start Docker, Postgres, Redis, MinIO, or any Takos
service.

## Run readiness

```sh
cd takos/paas
deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local,.env.local.example \
  --allow-env=TAKOS_LOCAL_ENV_FILE \
  --allow-run=docker,git,psql \
  --allow-net=127.0.0.1 \
  scripts/real-backend-readiness.ts
```

Use another env file by setting `TAKOS_LOCAL_ENV_FILE` and adding it to
`--allow-read`:

```sh
TAKOS_LOCAL_ENV_FILE=/tmp/takos-local.env deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local.example,/tmp/takos-local.env \
  --allow-env=TAKOS_LOCAL_ENV_FILE \
  --allow-run=docker,git,psql \
  --allow-net=127.0.0.1 \
  scripts/real-backend-readiness.ts
```

## Interpreting results

- `docker` and `docker compose` must be present before compose-backed plugin
  infrastructure smokes can run.
- `git` must be present before the opt-in git source plugin smoke can run.
- `psql` is optional. Missing `psql` should not block the smoke suite, but it
  limits manual database debugging.
- Port checks are expected to be `ok` before starting the compose stack. If a
  Takos stack is already running, those ports may be blocked; in that case the
  readiness output will mark
  `local health smoke against an already-running
  stack` as runnable.

## Follow-up smoke commands

The readiness output prints concrete commands for the smokes it detects as
runnable, including:

- compose dry-run checklist: `scripts/compose-smoke.ts`
- opt-in compose plugin infrastructure smoke: `TAKOS_RUN_COMPOSE_SMOKE=1 ...`
- local health smoke against an already-running stack: `scripts/local-smoke.mjs`
- opt-in git source smoke: `TAKOS_RUN_GIT_SMOKE=1 ...`
- opt-in docker provider smoke: `TAKOS_RUN_DOCKER_SMOKE=1 ...`
- Postgres storage dry-run smoke: `scripts/postgres-storage-smoke.ts`

Run readiness first, then run only the smoke commands whose prerequisites match
the intended environment.
