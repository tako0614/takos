# CI Release Gate

Takos PaaS uses `.github/workflows/paas-release-gate.yml` as a safe GitHub
Actions release gate for pull requests, pushes to `main`, and manual dispatches.

The workflow sets up Deno and runs only local validation:

1. `deno task check`
2. `deno task test:all`
3. `deno lint`
4. `deno fmt --check`
5. `scripts/release-gate.ts --keep-going`

The CI job does not read secrets, deploy, or contact real external services.
Smoke tests that can optionally call compose, git, object storage, postgres,
Redis, or docker providers are forced into dry-run mode with
`TAKOS_RUN_COMPOSE_SMOKE=0`, `TAKOS_RUN_GIT_SMOKE=0`,
`TAKOS_RUN_OBJECT_STORAGE_SMOKE=0`, `TAKOS_RUN_POSTGRES_SMOKE=0`,
`TAKOS_RUN_REDIS_QUEUE_SMOKE=0`, `TAKOS_RUN_DOCKER_SMOKE=0`, and
`TAKOS_RUN_REAL_COMPOSE_SMOKE=0`. The gate also runs the runtime-agent API
smoke, safe-by-default real compose harness, no-start backend readiness check,
and release manifest generation.

The workflow is path-filtered to the PaaS service, its contract package,
release-gate scripts, lock/config files, and this implementation note.
