# Takosumi Current State

This snapshot summarizes the implementation currently present in this product root. It is intentionally descriptive
rather than prescriptive; the forward plan remains
[`system-architecture-implementation-plan.md`](./system-architecture-implementation-plan.md).

## Implemented architecture

- `../takosumi/packages/kernel/src/index.ts` boots a Hono HTTP app from `../takosumi/packages/kernel/src/api` and
  enables kernel routes for the standalone entrypoint.
- `../takosumi/packages/kernel/src/api` exposes:
  - `GET /health` and `GET /capabilities`.
  - current kernel deploy route `POST /v1/deployments` for compiled Shape manifest apply.
  - migration compatibility routes under `/api/public/v1` that belong to Takos product compatibility during the
    transition and must not be treated as the current kernel public contract.
  - signed internal service routes through `takosumi-contract` path constants.
- `../takosumi/packages/contract` contains shared DTOs and signed internal request helpers. Internal auth binds method,
  path, timestamp, request id, actor context, caller/audience, and body digest.
- `../takosumi/packages/kernel/src/app_context.ts` is the main in-process composition point. It wires in-memory stores,
  configurable local adapters, core services, deploy apply services, and the runtime materializer.
- Runtime config and bootstrap checks now model production safety: unsafe production defaults are rejected unless
  storage, provider, source, secret, operator-config, and auth selections are explicit.
- Implemented domain modules are present for core, deploy, runtime, resources, routing, network, registry, audit,
  events, app-output dependency safety, and supply-chain. Some code-level test files still use the historical
  `publication` name; docs should describe the current public model as app metadata / resource outputs / registry
  entries / explicit grants.
- Takosumi internal process roles may exist inside the sibling kernel service, but Takos product deploy artifacts expose
  the service set as `takos-app`, `takosumi`, `takos-git`, and `takos-agent`.
- Workers and orchestration helpers exist for apply jobs, outbox dispatch, registry sync, repair, runtime vertical slice
  activation, deploy-to-runtime orchestration, event planning, app-output dependency planning, change-set planning,
  status/readiness projection, provider operations, resource operations, rollout canary steps, supply-chain preparation,
  usage aggregation, runtime logs, direct deploy compilation, approvals, backup/restore, control-plane upgrade planning,
  and bootstrap diagnostics.
- Storage has both a transactional in-memory driver and a Postgres driver boundary. Postgres migrations/statements and
  SQL-backed stores exist for core, deploy, resources, registry, and audit store families; migration runner tests cover
  ordered application, dry-run reporting, and checksum validation. The Postgres smoke also has an explicit real-database
  opt-in path through the optional `npm:pg` client adapter.
- Provider/source/secret/auth/operator-config/queue/object-storage adapters are implemented as ports with local
  defaults. The kernel/plugin ABI is versioned in `../takosumi/packages/contract/src/plugin.ts`, with a typed registry,
  env module loader, and no-I/O reference plugin in `../takosumi/packages/kernel/src/plugins`. Notable local adapters
  remain available for conformance and compatibility, but real self-host/cloud connectivity is now a plugin
  responsibility rather than a kernel completion criterion.

## Production-like capabilities now modeled in code

- Runtime configuration can reject production boot with in-memory or default local wiring, while still allowing explicit
  safe selections for production-like environments.
- Signed internal auth is paired with `WorkerAuthzService`, workload identity, service-grant checks, and private-egress
  policy denial tests.
- Provider execution is represented through `ProviderOperationService` with idempotency-key replay, persisted operation
  records, success/failure classification, retryable transient failure handling, and protection against provider failure
  mutating committed activation truth.
- Deploy-to-runtime orchestration can plan/apply a manifest, prepare artifacts, materialize runtime output, project
  status, and skip artifact preparation when requested.
- Supply-chain preparation records prepared artifacts, mirror decisions, package resolution digests, protected windows,
  digest-collision rejection, and reuse validation.
- Registry support includes bundled digest-pinned seeds, trust/revocation records, provider support reports, and blocked
  security reporting for revoked trust.
- Event planning and app-output dependency safety model explicit binding, ambiguous output blocking, dependency-cycle
  detection, breaking-change dependent plans, canary/shadow behavior, external schedule target defaults, and queue
  consumer switch previews.
- Resource operations model create/bind/unbind, migration ledgers, checksum blocking, imported/shared migration
  restrictions, and restore as a distinct resource operation.
- Router/status projections are derived from committed activations and observed runtime state without rewriting
  canonical desired state.

## Verified tests

Ran from `/home/tako/Desktop/takos/takos`:

```sh
deno task check
cd ../takosumi && deno task test
```

Result on 2026-04-29: kernel-only smoke baseline は `240 passed | 0 failed`
(`cd ../takosumi && deno task test`)。ecosystem release-gate (17 release gate + canonical full suite via
`cd takos && deno task release-gate`) は **345 tests passed** で freeze 済 (ROADMAP.md Part I §3.1 / §6.2 を canonical
value とする)。

Covered areas include:

- signed internal API request generation/verification, local actor auth, and signed service actor auth.
- public and internal route mounting behavior, standalone route defaults, and unsigned internal route rejection.
- core space/group creation, owner membership, and non-admin denial.
- non-mutating deploy plan, immutable activation creation, pointer advancement, stale `must-replan` apply rejection, and
  stale apply-worker failure recording.
- memory and Postgres storage driver/store round trips plus migration runner ordering, dry-run, and checksum validation.
- runtime desired/observed state separation, runtime vertical slice materialization, provider-output recording,
  observed-state capture, route projection, and status projection.
- deploy-to-runtime orchestration across plan/apply, artifact preparation, runtime materialization, and status
  projection.
- provider operation idempotency, success/failure classification, transient retryability, Docker dry-run/injected
  command behavior, and provider failure isolation from committed activation truth.
- rollout canary activation-per-step behavior and HTTP-only assignment defaults.
- resource create/bind/unbind, migration checksum validation, migration eligibility restrictions, and
  restore-as-resource-operation modeling.
- registry resolution/trust stores, trust revocation reporting, bundled registry seed adapter, package support reports,
  and supply-chain prepared artifact reuse/GC protection.
- event stores and app-output dependency planners, explicit bindings, dependency-cycle detection, breaking-change
  dependent plans, queue/external-schedule defaults, and canary/shadow target behavior.
- audit append/query/hash-chain checks, network report summaries, runtime agent registry and HTTP routes, bootstrap
  adapter selection/redaction, notification sink, KMS/secret stores, source snapshots, local/env operator config,
  readiness/status routes, OpenAPI route inventory, direct deploy, approvals, backup/restore, change-set orchestration,
  conformance, GC/retention, runtime logs, usage projection, control-plane upgrade planning, Redis queue adapter, and
  S3-compatible object-storage adapter request signing.

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
deno task lint:agent-docs
deno task lint:docs
deno task release-gate
deno lint
deno fmt --check
deno fmt
```

Additional useful commands:

```sh
cd ../takosumi && deno task check
cd ../takosumi && deno test --allow-all packages/kernel/src/domains/deploy
deno task validate:service-set
deno task local:up
deno task local:logs
deno task local:down
```

Notes:

- Takosumi full test execution is owned by the sibling kernel repo (`cd ../takosumi && deno test --allow-all`).
- Takosumi kernel local development runs from the sibling `../takosumi` repo; this shell owns local composition and
  Takos-specific deploy artifacts only.
- docs gates are `lint:docs`, `lint:agent-docs`, `docs:build`, and `docs:deploy` in `takos/deno.json`.
- local Compose and Helm metadata carry the current Takos service IDs and internal URL wiring.

## In-memory vs real boundaries

Current default runtime remains intentionally local/in-memory:

- `createInMemoryAppContext` uses in-memory stores for core, deploy, runtime, resources, registry, and audit.
- default adapters are local or memory-backed: local actor/auth, memory notifications, local operator config, no-op
  provider, memory encrypted secret store, and `MemoryStorageDriver`.
- source adapters produce immutable snapshots; Git command execution is dry-run by default and real Git is only
  available through the explicit `DenoGitCommandRunner`/runner injection path.
- local Docker materialization records deterministic Docker operations and uses a dry-run runner by default; real Docker
  execution requires an injected command runner.
- provider observed state is modeled separately from canonical deploy/runtime desired state. Tests assert observed drift
  and provider failure do not rewrite canonical desired state or activation truth.

Real/prod-facing boundaries that exist as code but are not the default wiring:

- `createConfiguredAppContext` and runtime config selection can reject unsafe production defaults, select plugin-backed
  external boundaries, and fail fast when an operator-selected plugin is not registered.
- `PostgresStorageDriver`, SQL store implementations, storage migration runner, and optional `npm:pg` SQL client
  creation exist behind the `StorageDriver` transaction interface, but the bundled app composition still uses memory
  stores.
- `DenoCommandDockerRunner` and `DenoGitCommandRunner` can execute real external commands when explicitly
  selected/injected.
- env operator config can read secret references without exposing raw values, but production secret management remains
  adapter-boundary work rather than a deployed secret backend in the default context.
- signed internal service auth, workload identity, service grants, and network policy checks exist as service-level
  enforcement. Full end-to-end runtime identity issuance/enforcement across every mutation boundary still remains
  production integration work.

## Remaining concrete next steps

- Wire the HTTP/runtime entrypoint to explicit production storage selection, migration execution, and health/readiness
  checks instead of defaulting to in-memory app state.
- Connect workload identity issuance, `ServiceGrant` lookup, entitlement checks, and mutation-boundary policy to every
  internal route/worker path, not only the service-level authorization slice.
- Promote provider operation persistence into the full apply path with durable retry keys, object refs, package digests,
  status persistence, and non-mutating failure behavior for every materialization step.
- Promote trust revocation, provider support reports, migration checksum blocking, network enforcement, approval checks,
  and package digest checks from isolated services/stores into plan/apply phase-boundary enforcement.
- Finish durable resource lifecycle production semantics: backups/restores, migrations, sharing/import restrictions,
  rollback windows, provider-native restore support, and operator-facing recovery workflows.
- Complete app-output/events/dependency orchestration in the apply pipeline: cross-group grants, managed projection
  health, queue and external schedule activation defaults across all mutation boundaries, and side-effect controls for
  canary/shadow traffic.
- Move real self-host/cloud provider/source/storage/queue/object/KMS/secret implementations into kernel plugins, then
  run plugin-specific release gates outside the kernel release gate.
- Keep local Compose/Helm resource names and command paths aligned with the Takos product services plus Takosumi
  substrate stack.
- Keep expanding acceptance coverage in
  [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md)
  until the remaining production gaps have route/worker-level regression tests.
