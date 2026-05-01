# Takos PaaS Current State

This snapshot summarizes the implementation currently present in this product
root. It is intentionally descriptive rather than prescriptive; the forward plan
remains
[`system-architecture-implementation-plan.md`](./system-architecture-implementation-plan.md).

## Implemented architecture

- `apps/paas/src/index.ts` boots a Hono HTTP app from `apps/paas/src/api` and
  enables public routes for the standalone entrypoint.
- `apps/paas/src/api` exposes:
  - `GET /health` and `GET /capabilities`.
  - signed internal service routes for spaces, groups, deploy plans, and deploy
    applies through `takos-paas-contract` path constants.
  - public standalone routes under `/api/public/v1` for capabilities, spaces,
    groups, deploy planning, and deploy apply.
- `packages/paas-contract` contains shared DTOs and signed internal request
  helpers. Internal auth binds method, path, timestamp, request id, actor
  context, caller/audience, and body digest.
- `apps/paas/src/app_context.ts` is the main in-process composition point. It
  wires in-memory stores, configurable local adapters, core services, deploy
  plan/apply services, and the runtime materializer.
- Runtime config and bootstrap checks now model production safety: unsafe
  production defaults are rejected unless storage, provider, source, secret,
  operator-config, and auth selections are explicit.
- Implemented domain modules are present for core, deploy, runtime, resources,
  routing, network, registry, audit, events, publications, and supply-chain.
  They expose type/store/service-level boundaries instead of separate default
  microservices.
- Process roles are declared in `apps/paas/src/process/roles.ts` as deployment
  roles for the same product root: `takos-paas-api`, `takos-paas-worker`,
  `takos-paas-router`, `takos-paas-runtime-agent`, and `takos-paas-log-worker`.
- Workers and orchestration helpers exist for apply jobs, outbox dispatch,
  registry sync, repair, runtime vertical slice activation, deploy-to-runtime
  orchestration, event planning, publication planning, change-set planning,
  status/readiness projection, provider operations, resource operations, rollout
  canary steps, supply-chain preparation, usage aggregation, runtime logs,
  direct deploy compilation, approvals, backup/restore, control-plane upgrade
  planning, and bootstrap diagnostics.
- Storage has both a transactional in-memory driver and a Postgres driver
  boundary. Postgres migrations/statements and SQL-backed stores exist for core,
  deploy, resources, registry, and audit store families; migration runner tests
  cover ordered application, dry-run reporting, and checksum validation. The
  Postgres smoke also has an explicit real-database opt-in path through the
  optional `npm:pg` client adapter.
- Provider/source/secret/auth/operator-config/queue/object-storage adapters are
  implemented as ports with local defaults. The kernel/plugin ABI is versioned
  in `packages/paas-contract/src/plugin.ts`, with a typed registry, env module
  loader, and no-I/O reference plugin in `apps/paas/src/plugins`. Notable local
  adapters remain available for conformance and compatibility, but real
  self-host/cloud connectivity is now a plugin responsibility rather than a
  kernel completion criterion.

## Production-like capabilities now modeled in code

- Runtime configuration can reject production boot with in-memory or default
  local wiring, while still allowing explicit safe selections for
  production-like environments.
- Signed internal auth is paired with `WorkerAuthzService`, workload identity,
  service-grant checks, and private-egress policy denial tests.
- Provider execution is represented through `ProviderOperationService` with
  idempotency-key replay, persisted operation records, success/failure
  classification, retryable transient failure handling, and protection against
  provider failure mutating committed activation truth.
- Deploy-to-runtime orchestration can plan/apply a manifest, prepare artifacts,
  materialize runtime output, project status, and skip artifact preparation when
  requested.
- Supply-chain preparation records prepared artifacts, mirror decisions, package
  resolution digests, protected windows, digest-collision rejection, and reuse
  validation.
- Registry support includes bundled digest-pinned seeds, trust/revocation
  records, provider support reports, and blocked security reporting for revoked
  trust.
- Publication and event planning model explicit binding, ambiguous publication
  blocking, dependency-cycle detection, breaking-change dependent plans,
  canary/shadow behavior, schedule defaults, and queue consumer switch previews.
- Resource operations model create/bind/unbind, migration ledgers, checksum
  blocking, imported/shared migration restrictions, and restore as a distinct
  resource operation.
- Router/status projections are derived from committed activations and observed
  runtime state without rewriting canonical desired state.

## Verified tests

Ran from `/home/tako/Desktop/takos/takos/paas`:

```sh
deno task test:all
```

Result on 2026-04-29: `240 passed | 0 failed`.

Covered areas include:

- signed internal API request generation/verification, local actor auth, and
  signed service actor auth.
- public and internal route mounting behavior, standalone route defaults, and
  unsigned internal route rejection.
- core space/group creation, owner membership, and non-admin denial.
- non-mutating deploy plan, immutable activation creation, pointer advancement,
  stale `must-replan` apply rejection, and stale apply-worker failure recording.
- memory and Postgres storage driver/store round trips plus migration runner
  ordering, dry-run, and checksum validation.
- runtime desired/observed state separation, runtime vertical slice
  materialization, provider-output recording, observed-state capture, route
  projection, and status projection.
- deploy-to-runtime orchestration across plan/apply, artifact preparation,
  runtime materialization, and status projection.
- provider operation idempotency, success/failure classification, transient
  retryability, Docker dry-run/injected command behavior, and provider failure
  isolation from committed activation truth.
- rollout canary activation-per-step behavior and HTTP-only assignment defaults.
- resource create/bind/unbind, migration checksum validation, migration
  eligibility restrictions, and restore-as-resource-operation modeling.
- registry resolution/trust stores, trust revocation reporting, bundled registry
  seed adapter, package support reports, and supply-chain prepared artifact
  reuse/GC protection.
- publication/event stores and planners, explicit bindings, dependency-cycle
  detection, breaking-change dependent plans, queue/schedule defaults, and
  canary/shadow target behavior.
- audit append/query/hash-chain checks, network report summaries, runtime agent
  registry and HTTP routes, bootstrap adapter selection/redaction, notification
  sink, KMS/secret stores, source snapshots, local/env operator config,
  readiness/status routes, OpenAPI route inventory, direct deploy, approvals,
  backup/restore, change-set orchestration, conformance, GC/retention, runtime
  logs, usage projection, control-plane upgrade planning, Redis queue adapter,
  and S3-compatible object-storage adapter request signing.

## Current smoke status

Safe-by-default smoke scripts are current as of the 2026-04-28 docs refresh:

| Boundary                     | Default status                               | Real/opt-in status                                                                                                           | Notes                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres storage/migrations  | Pass                                         | Available with `TAKOS_RUN_POSTGRES_SMOKE=1` and `DATABASE_URL`                                                               | Dry-run reports 15 tables, 6 migrations, SQL previews, and a fake `SqlClient` transaction path without opening a database connection.                                                                          |
| Redis queue                  | Pass                                         | Available with `TAKOS_RUN_REDIS_QUEUE_SMOKE=1` and a Redis URL                                                               | Dry-run exercises `RedisQueueAdapter` enqueue/lease/ack/empty-lease through an injected command client without connecting to Redis.                                                                            |
| S3-compatible object storage | Pass                                         | Available with `TAKOS_RUN_OBJECT_STORAGE_SMOKE=1` plus `TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT=1` and endpoint credentials | Dry-run verifies memory object storage put/head/get/list/delete plus S3 PUT/HEAD/GET/LIST/DELETE request signing without fetch/network.                                                                        |
| Docker Compose local stack   | Safe dry-run pass; real harness pass locally | Real mode requires `TAKOS_RUN_REAL_COMPOSE_SMOKE=1`, Docker Compose, `.env.local`, free ports, and local image builds        | The 2026-04-28 local real run built and started Postgres, Redis, MinIO, PaaS process roles, runtime, and `takos-agent`, verified health endpoints, and cleaned up. It is not part of the default release gate. |

## Runnable commands

Primary local verification commands from the root `deno.json`:

```sh
deno task check
deno task test:all
deno lint
deno fmt --check
deno fmt
```

Additional useful commands:

```sh
deno task --cwd apps/paas check
deno task --cwd packages/paas-contract check
deno task dev:paas
deno run --allow-read scripts/validate-process-roles.ts
deno task local:up
deno task local:logs
deno task local:down
```

Notes:

- `deno task test:all` delegates to
  `deno test --allow-all --permit-no-files apps/paas packages/paas-contract`.
- `deno task dev:paas` runs the Hono entrypoint with `--allow-net --allow-env`.
- docs tasks currently print that Takos docs moved out of the `takos-paas`
  service scope.
- local Compose and Helm metadata carry the current PaaS process-role
  labels/envs.

## In-memory vs real boundaries

Current default runtime remains intentionally local/in-memory:

- `createInMemoryAppContext` uses in-memory stores for core, deploy, runtime,
  resources, registry, and audit.
- default adapters are local or memory-backed: local actor/auth, memory
  notifications, local operator config, no-op provider, memory encrypted secret
  store, and `MemoryStorageDriver`.
- source adapters produce immutable snapshots; Git command execution is dry-run
  by default and real Git is only available through the explicit
  `DenoGitCommandRunner`/runner injection path.
- local Docker materialization records deterministic Docker operations and uses
  a dry-run runner by default; real Docker execution requires an injected
  command runner.
- provider observed state is modeled separately from canonical deploy/runtime
  desired state. Tests assert observed drift and provider failure do not rewrite
  canonical desired state or activation truth.

Real/prod-facing boundaries that exist as code but are not the default wiring:

- `createConfiguredAppContext` and runtime config selection can reject unsafe
  production defaults, select plugin-backed external boundaries, and fail fast
  when an operator-selected plugin is not registered.
- `PostgresStorageDriver`, SQL store implementations, storage migration runner,
  and optional `npm:pg` SQL client creation exist behind the `StorageDriver`
  transaction interface, but the default app composition still uses memory
  stores.
- `DenoCommandDockerRunner` and `DenoGitCommandRunner` can execute real external
  commands when explicitly selected/injected.
- env operator config can read secret references without exposing raw values,
  but production secret management remains adapter-boundary work rather than a
  deployed secret backend in the default context.
- signed internal service auth, workload identity, service grants, and network
  policy checks exist as service-level enforcement. Full end-to-end runtime
  identity issuance/enforcement across every mutation boundary still remains
  production integration work.

## Remaining concrete next steps

- Wire the HTTP/runtime entrypoint to explicit production storage selection,
  migration execution, and health/readiness checks instead of defaulting to
  in-memory app state.
- Connect workload identity issuance, `ServiceGrant` lookup, entitlement checks,
  and mutation-boundary policy to every internal route/worker path, not only the
  service-level authorization slice.
- Promote provider operation persistence into the full apply path with durable
  retry keys, object refs, package digests, status persistence, and non-mutating
  failure behavior for every materialization step.
- Promote trust revocation, provider support reports, migration checksum
  blocking, network enforcement, approval checks, and package digest checks from
  isolated services/stores into plan/apply phase-boundary enforcement.
- Finish durable resource lifecycle production semantics: backups/restores,
  migrations, sharing/import restrictions, rollback windows, provider-native
  restore support, and operator-facing recovery workflows.
- Complete publications/events/dependency orchestration in the apply pipeline:
  cross-group grants, managed projection health, queue and schedule activation
  defaults across all mutation boundaries, and side-effect controls for
  canary/shadow traffic.
- Move real self-host/cloud provider/source/storage/queue/object/KMS/secret
  implementations into kernel plugins, then run plugin-specific release gates
  outside the PaaS kernel release gate.
- Reconcile local Compose/Helm resource names and command paths with the current
  PaaS process-role model.
- Keep expanding acceptance coverage in
  [`acceptance-matrix.md`](./acceptance-matrix.md) until the remaining
  production gaps have route/worker-level regression tests.
