# Self-host E2E runbook

This runbook moves from the current safe/static checks to a real single-node
self-host E2E on `compose.local.yml`. Run from `takos/paas`. Do not run this in
shared automation unless the host and Docker daemon are intentionally reserved
for the smoke.

## 1. Prepare the env file

```sh
cp .env.self-host .env.local
$EDITOR .env.local
```

Set or replace at least the placeholder secrets before the real run:

- `EXECUTOR_PROXY_SECRET`, `TAKOS_INTERNAL_API_SECRET`
- `PLATFORM_PRIVATE_KEY`, `PLATFORM_PUBLIC_KEY`, `JWT_PUBLIC_KEY`
- `ENCRYPTION_KEY` as a base64 32-byte key
- Provider keys only when you want non-`TAKOS_ALLOW_NO_LLM=1` behavior

Keep local defaults for ports unless the host already uses them: `8787`, `8788`,
`8789`, `8790`, `8081`, `8082`, `15432`, `16379`, `19000`, `19001`.

## 2. Run safe validation first

```sh
deno fmt

deno run --no-config --allow-read scripts/self-host-e2e-check.ts

deno task check

TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml config
```

Stop here if the static check, type check, or Compose render fails.

## 3. Start Compose

```sh
TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml up --build -d

TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml ps
```

Follow logs until health checks settle:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml logs -f \
    postgres redis minio minio-init control-web control-dispatch \
    control-worker runtime-host executor-host runtime takos-agent \
    oci-orchestrator
```

## 4. Migration bootstrap check

The stack should bootstrap against
`DATABASE_URL=postgresql://takos:takos@postgres:5432/takos` during service
startup. Confirm the database is reachable and that the control services did not
log migration/bootstrap errors:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml exec postgres \
    psql -U takos -d takos -c '\dt'

TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml logs control-web control-worker \
    | grep -Ei 'migration|bootstrap|error|failed'
```

Expected for the current hardening state: no standalone migration CLI is exposed
by this repo yet. Treat missing tables or startup migration errors as blockers
before public API smoke.

## 5. Public API smoke

First run the host-mapped health smoke:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local \
  deno run --allow-read --allow-env --allow-net scripts/local-smoke.mjs
```

Then exercise the public PaaS API on `control-web`:

```sh
curl -fsS http://127.0.0.1:8787/api/public/v1/capabilities
curl -fsS http://127.0.0.1:8787/api/public/v1/spaces

curl -fsS -X POST http://127.0.0.1:8787/api/public/v1/spaces \
  -H 'content-type: application/json' \
  -d '{"name":"Smoke Space","slug":"space-smoke"}'

curl -fsS -X POST http://127.0.0.1:8787/api/public/v1/groups \
  -H 'content-type: application/json' \
  -d '{"spaceId":"space-smoke","name":"Smoke App","envName":"smoke-app"}'

curl -fsS -X POST http://127.0.0.1:8787/api/public/v1/deploy/plans \
  -H 'content-type: application/json' \
  -d '{"spaceId":"space-smoke","manifest":{"name":"smoke-app","version":"1.0.0","compute":{"web":{"type":"container","image":"busybox:latest","env":{"PORT":"8080"}}},"routes":{"http":{"to":"web","host":"smoke.localhost","path":"/"}}}}'
```

For an in-process route/runtime sanity check that does not use Compose, run:

```sh
deno run --allow-read --allow-env scripts/paas-smoke.ts
```

## 6. Optional Docker provider smoke

Dry-run first:

```sh
deno run --config deno.json --allow-env=TAKOS_RUN_DOCKER_SMOKE \
  scripts/docker-provider-smoke.ts
```

Opt in to real Docker only when the daemon can create a temporary network and
container:

```sh
TAKOS_RUN_DOCKER_SMOKE=1 deno run \
  --config deno.json \
  --allow-env=TAKOS_RUN_DOCKER_SMOKE \
  --allow-run=docker \
  scripts/docker-provider-smoke.ts
```

## 7. Teardown

```sh
TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml down --remove-orphans
```

Destroy smoke data only when you do not need database/object-store evidence:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local \
  docker compose --env-file .env.local -f compose.local.yml down -v --remove-orphans
```

## Expected failures and triage

- Compose config fails: `.env.local` is missing or still has incompatible
  placeholders.
- Port bind fails: another local process owns one of the mapped ports; change
  the corresponding `TAKOS_*_PORT` in `.env.local`.
- `minio-init` fails: `MINIO_ROOT_*` or `S3_BUCKET` is missing, or MinIO health
  never settled.
- `control-worker` unhealthy: heartbeat file is stale; inspect worker logs and
  dependencies on `runtime-host`, `executor-host`, and `oci-orchestrator`.
- Public API create calls fail: bootstrap/migration or in-memory default service
  wiring is not ready for persistent self-host state; keep the logs and database
  table listing for follow-up.
- Optional Docker provider smoke fails: Docker socket/network permissions are
  unavailable, or `busybox:latest` cannot be pulled.
