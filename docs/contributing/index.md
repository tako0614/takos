# 開発者向け情報

> このページでわかること: Takos の開発に参加するための実装計画と検証手順の目次。

## Architecture

- [`system-architecture-implementation-plan.md`](./system-architecture-implementation-plan.md) — target Takosumi domain
  layout, ground rules, and milestones.
- [`current-state.md`](./current-state.md) — snapshot of the implemented kernel API, domains, process roles, adapters,
  storage, and production-safety checks.
- [`api-surface.md`](./api-surface.md) — OpenAPI-ish route snapshot owned by
  `takosumi/packages/kernel/src/api/openapi.ts` and its route-source-of-truth boundary.
- [`deploy-topology-notes.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/deploy-topology-notes.md)
  — Takos service-set alignment for Compose/Helm.
- [`kernel-plugin-boundary-audit.md`](./kernel-plugin-boundary-audit.md) — source-of-truth checklist for keeping docs
  and implementation aligned around the kernel-only / plugin-backed infrastructure split.
- Kernel/plugin boundary: `../takosumi/packages/contract/src/plugin.ts` defines the public plugin ABI;
  `../takosumi/packages/kernel/src/plugins/` contains the typed registry, module loader, and no-I/O reference plugin
  used by kernel conformance tests.

## Validation

- [`quality/`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/) is the cross-product quality
  index.
- [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md)
  maps acceptance items to implemented coverage.
- [`acceptance-test-backlog.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md)
  tracks remaining acceptance-test work.
- [`release-gate.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/release-gate.md) is the
  single reference for Takos product release validators, including service-set and architecture-alignment checks.

## Smoke

- [`smoke.md`](./smoke.md) documents the historical in-process lifecycle smoke scope. Current executable kernel coverage
  lives under sibling `../takosumi` tests.
- [`runtime-agent-api-smoke.md`](./runtime-agent-api-smoke.md) documents the runtime-agent lifecycle API smoke scope.
  Current executable coverage is
  `cd ../takosumi && deno test --allow-all packages/kernel/src/api/runtime_agent_routes_test.ts`.
- [`router-config-smoke.md`](./router-config-smoke.md) documents the memory/file router config materialization smoke
  scope.
- [`self-host-e2e.md`](./self-host-e2e.md) documents the static self-host Compose check and the manual single-node
  Docker smoke path.
- [`self-host-runbook.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/self-host-runbook.md)
  is the operator runbook for a real single-node self-host E2E run.
- [`compose-smoke.md`](./compose-smoke.md) documents the safe-by-default Compose checklist and optional stack smoke.
- [`git-source-smoke.md`](./git-source-smoke.md) documents the source-adapter smoke scope for manifest, local upload,
  and git snapshots.
- [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) documents the safe-by-default Postgres storage/migration
  smoke scope with real-database opt-in.
- [`redis-queue-smoke.md`](./redis-queue-smoke.md) documents the safe-by-default Redis queue adapter smoke scope with
  real Redis opt-in.
- [`object-storage-smoke.md`](./object-storage-smoke.md) documents the safe-by-default memory/S3-compatible
  object-storage smoke scope with real endpoint opt-in.
- [`docker-provider-smoke.md`](./docker-provider-smoke.md) documents the Docker provider materialization smoke scope.
- [`compose-real-smoke.md`](./compose-real-smoke.md) documents the safe-by-default real Compose harness scope; its
  opt-in mode passed locally on 2026-04-28 but remains outside default gates.

## Production gaps

- [`production-gap-burndown.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/production-gap-burndown.md)
  — concise production-readiness burndown with proof commands for implemented, safe-dry-run, opt-in-real,
  partial-boundary, and environment-dependent areas.
- Remaining phase-boundary and catalog gaps are tracked in
  [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md)
  and backed by the backlog in
  [`acceptance-test-backlog.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md).
- Topology/resource-name alignment gaps are tracked in
  [`deploy-topology-notes.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/deploy-topology-notes.md).

## Plugin-backed infrastructure

Self-host and cloud connectivity are not kernel responsibilities. External systems are reached through kernel plugins
loaded by `TAKOS_KERNEL_PLUGIN_MODULES` or injected by the host process. The proof paths below remain safe by default
and exercise local adapter behavior only when explicitly opted in:

- Real git resolution: [`git-source-smoke.md`](./git-source-smoke.md) with `TAKOS_RUN_GIT_SMOKE=1`,
  `TAKOS_GIT_SMOKE_REPO`, and `--allow-run=git`.
- Real Docker provider execution: [`docker-provider-smoke.md`](./docker-provider-smoke.md) with
  `TAKOS_RUN_DOCKER_SMOKE=1` and `--allow-run=docker`.
- Real Compose stack smoke: [`compose-smoke.md`](./compose-smoke.md) with `TAKOS_RUN_COMPOSE_SMOKE=1`, a prepared env
  file, and `--allow-run=docker`.
- Real Compose harness: [`compose-real-smoke.md`](./compose-real-smoke.md) with `TAKOS_RUN_REAL_COMPOSE_SMOKE=1`, a
  prepared env file, `--allow-run=docker`, and `--allow-net=127.0.0.1`.
- Real Postgres storage smoke: [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) runs the optional
  `npm:pg`-backed SQL client path when `TAKOS_RUN_POSTGRES_SMOKE=1`, `DATABASE_URL`/`TAKOS_DATABASE_URL`, `--allow-net`,
  and `--allow-read` are provided.
- Real Redis queue smoke: [`redis-queue-smoke.md`](./redis-queue-smoke.md) with `TAKOS_RUN_REDIS_QUEUE_SMOKE=1`, a Redis
  URL, and `--allow-net`.
- Real S3-compatible object-storage smoke: [`object-storage-smoke.md`](./object-storage-smoke.md) with
  `TAKOS_RUN_OBJECT_STORAGE_SMOKE=1`, `TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT=1`, endpoint/bucket credentials, and
  `--allow-net`.
- Real single-node self-host proof:
  [`self-host-runbook.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/self-host-runbook.md)
  and [`self-host-e2e.md`](./self-host-e2e.md) require Docker Compose, images, open ports, credentials, and an
  operator-edited `.env.local`.

## 1.x Installable App Model Roadmap

1.0 Core Release (Part I) 完了後、Installable App Model に向けた 1.x 系 phase は ROADMAP.md Part II + Part III
で管理されます。

- ROADMAP.md Part II Phase 1.1-1.7 (ecosystem root の `ROADMAP.md` を参照)
- [Acceptance Backlog (Phase 1.x feature)](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md)
- [Installable App Model 設計](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
