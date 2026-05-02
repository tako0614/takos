# Implementation Plan Index

This directory is the Takos shell-owned planning index for PaaS implementation
work. It lives outside the `takos/paas` product repo so the kernel plan can
reference shell-level boundaries without making PaaS own the plan. Run PaaS
commands from the `takos/paas` product root unless a document says otherwise.

## Architecture

- [`system-architecture-implementation-plan.md`](./system-architecture-implementation-plan.md)
  — target Takosumi domain layout, ground rules, and milestones.
- [`current-state.md`](./current-state.md) — snapshot of the implemented PaaS
  API, domains, process roles, adapters, storage, and production-safety checks.
- [`api-surface.md`](./api-surface.md) — OpenAPI-ish route snapshot owned by
  `apps/paas/src/api/openapi.ts` and its route-source-of-truth boundary.
- [`deploy-topology-notes.md`](./deploy-topology-notes.md) — process-role naming
  alignment for Compose/Helm.
- [`kernel-plugin-boundary-audit.md`](./kernel-plugin-boundary-audit.md) —
  source-of-truth checklist for keeping docs and implementation aligned around
  the kernel-only / plugin-backed infrastructure split.
- Kernel/plugin boundary: `packages/paas-contract/src/plugin.ts` defines the
  public plugin ABI; `apps/paas/src/plugins/` contains the typed registry,
  module loader, and no-I/O reference plugin used by kernel conformance tests.

## Validation

- [`acceptance-test-backlog.md`](./acceptance-test-backlog.md) —
  severity-ordered acceptance-test backlog translated from the Takosumi
  acceptance catalog.
- [`acceptance-matrix.md`](./acceptance-matrix.md) — acceptance catalog coverage
  matrix with covered, partial, and gap classifications.
- [`process-role-validation.md`](./process-role-validation.md) documents
  [`../../paas/scripts/validate-process-roles.ts`](../../paas/scripts/validate-process-roles.ts),
  the static Compose/Helm role validator.
- [`architecture-alignment-validation.md`](./architecture-alignment-validation.md)
  documents
  [`../../paas/scripts/validate-architecture-alignment.ts`](../../paas/scripts/validate-architecture-alignment.ts),
  the stale-boundary/path-drift validator.
- [`release-gate.md`](./release-gate.md) documents
  [`../../paas/scripts/release-gate.ts`](../../paas/scripts/release-gate.ts),
  which runs check, tests, lint, fmt check, validators, safe smokes, and the
  in-process PaaS smoke.

## Smoke

- [`smoke.md`](./smoke.md) documents
  [`../../paas/scripts/paas-smoke.ts`](../../paas/scripts/paas-smoke.ts), the
  no-server, no-Docker in-process PaaS lifecycle smoke.
- [`runtime-agent-api-smoke.md`](./runtime-agent-api-smoke.md) documents
  [`../../paas/scripts/runtime-agent-api-smoke.ts`](../../paas/scripts/runtime-agent-api-smoke.ts),
  the in-process runtime-agent lifecycle API smoke.
- [`router-config-smoke.md`](./router-config-smoke.md) documents
  [`../../paas/scripts/router-config-smoke.ts`](../../paas/scripts/router-config-smoke.ts),
  the memory/file router config materialization smoke.
- [`self-host-e2e.md`](./self-host-e2e.md) documents the static self-host
  Compose check and the manual single-node Docker smoke path.
- [`self-host-runbook.md`](./self-host-runbook.md) is the operator runbook for a
  real single-node self-host E2E run.
- [`compose-smoke.md`](./compose-smoke.md) documents
  [`../../paas/scripts/compose-smoke.ts`](../../paas/scripts/compose-smoke.ts),
  the safe-by-default Compose checklist and optional stack smoke.
- [`git-source-smoke.md`](./git-source-smoke.md) documents
  [`../../paas/scripts/git-source-smoke.ts`](../../paas/scripts/git-source-smoke.ts),
  the source-adapter smoke for manifest, local upload, and git snapshots.
- [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) documents
  [`../../paas/scripts/postgres-storage-smoke.ts`](../../paas/scripts/postgres-storage-smoke.ts),
  the safe-by-default Postgres storage/migration smoke with real-database
  opt-in.
- [`redis-queue-smoke.md`](./redis-queue-smoke.md) documents
  [`../../paas/scripts/redis-queue-smoke.ts`](../../paas/scripts/redis-queue-smoke.ts),
  the safe-by-default Redis queue adapter smoke with real Redis opt-in.
- [`object-storage-smoke.md`](./object-storage-smoke.md) documents
  [`../../paas/scripts/object-storage-smoke.ts`](../../paas/scripts/object-storage-smoke.ts),
  the safe-by-default memory/S3-compatible object-storage smoke with real
  endpoint opt-in.
- [`docker-provider-smoke.md`](./docker-provider-smoke.md) documents
  [`../../paas/scripts/docker-provider-smoke.ts`](../../paas/scripts/docker-provider-smoke.ts),
  the Docker provider materialization smoke.
- [`compose-real-smoke.md`](./compose-real-smoke.md) documents
  [`../../paas/scripts/compose-real-smoke.ts`](../../paas/scripts/compose-real-smoke.ts),
  the safe-by-default real Compose harness; its opt-in mode passed locally on
  2026-04-28 but remains outside default gates.
- [`../../paas/scripts/self-host-e2e-check.ts`](../../paas/scripts/self-host-e2e-check.ts)
  is the dependency-free static checker used by the self-host docs and release
  gate.

## Production gaps

- [`production-gap-burndown.md`](./production-gap-burndown.md) — concise
  production-readiness burndown with proof commands for implemented,
  safe-dry-run, opt-in-real, partial-boundary, and environment-dependent areas.
- Remaining phase-boundary and catalog gaps are tracked in
  [`acceptance-matrix.md`](./acceptance-matrix.md) and backed by the backlog in
  [`acceptance-test-backlog.md`](./acceptance-test-backlog.md).
- Topology/resource-name alignment gaps are tracked in
  [`deploy-topology-notes.md`](./deploy-topology-notes.md).

## Plugin-backed infrastructure

Self-host and cloud connectivity are not PaaS kernel responsibilities. External
systems are reached through kernel plugins loaded by
`TAKOS_KERNEL_PLUGIN_MODULES` or injected by the host process. The scripts below
remain safe by default and exercise local adapter behavior only when explicitly
opted in:

- Real git resolution: [`git-source-smoke.md`](./git-source-smoke.md) /
  [`../../paas/scripts/git-source-smoke.ts`](../../paas/scripts/git-source-smoke.ts)
  with `TAKOS_RUN_GIT_SMOKE=1`, `TAKOS_GIT_SMOKE_REPO`, and `--allow-run=git`.
- Real Docker provider execution:
  [`docker-provider-smoke.md`](./docker-provider-smoke.md) /
  [`../../paas/scripts/docker-provider-smoke.ts`](../../paas/scripts/docker-provider-smoke.ts)
  with `TAKOS_RUN_DOCKER_SMOKE=1` and `--allow-run=docker`.
- Real Compose stack smoke: [`compose-smoke.md`](./compose-smoke.md) /
  [`../../paas/scripts/compose-smoke.ts`](../../paas/scripts/compose-smoke.ts)
  with `TAKOS_RUN_COMPOSE_SMOKE=1`, a prepared env file, and
  `--allow-run=docker`.
- Real Compose harness: [`compose-real-smoke.md`](./compose-real-smoke.md) /
  [`../../paas/scripts/compose-real-smoke.ts`](../../paas/scripts/compose-real-smoke.ts)
  with `TAKOS_RUN_REAL_COMPOSE_SMOKE=1`, a prepared env file,
  `--allow-run=docker`, and `--allow-net=127.0.0.1`.
- Real Postgres storage smoke:
  [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) /
  [`../../paas/scripts/postgres-storage-smoke.ts`](../../paas/scripts/postgres-storage-smoke.ts)
  runs the optional `npm:pg`-backed SQL client path when
  `TAKOS_RUN_POSTGRES_SMOKE=1`, `DATABASE_URL`/`TAKOS_DATABASE_URL`,
  `--allow-net`, and `--allow-read` are provided.
- Real Redis queue smoke: [`redis-queue-smoke.md`](./redis-queue-smoke.md) /
  [`../../paas/scripts/redis-queue-smoke.ts`](../../paas/scripts/redis-queue-smoke.ts)
  with `TAKOS_RUN_REDIS_QUEUE_SMOKE=1`, a Redis URL, and `--allow-net`.
- Real S3-compatible object-storage smoke:
  [`object-storage-smoke.md`](./object-storage-smoke.md) /
  [`../../paas/scripts/object-storage-smoke.ts`](../../paas/scripts/object-storage-smoke.ts)
  with `TAKOS_RUN_OBJECT_STORAGE_SMOKE=1`,
  `TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT=1`, endpoint/bucket credentials, and
  `--allow-net`.
- Real single-node self-host proof:
  [`self-host-runbook.md`](./self-host-runbook.md) and
  [`self-host-e2e.md`](./self-host-e2e.md) require Docker Compose, images, open
  ports, credentials, and an operator-edited `.env.local`.
