# Control to PaaS Migration Inventory

This inventory scopes the first three decoupling steps for mature control-plane
implementation that still lives in `takos/app/packages/control`. The target is
the `takos/paas` product root as a PaaS monolith: domains are module boundaries,
and process roles are deployment/runtime roles of the same codebase.

## Scope rules

- Source owner is the current implementation owner in
  `takos/app/packages/control`; target owner is the PaaS domain or service
  module that should become canonical.
- Do not import `takos/app` implementation from PaaS. Port contracts, behavior,
  and tests; leave app-facing compatibility behind signed/internal or public
  PaaS contracts.
- Keep deploy/runtime compatibility roots stable during the first migration
  pass: existing `control-web`, `control-worker`, `control-dispatch`,
  `runtime-host`, and `executor` topology names remain aliases for PaaS process
  roles until an upgrade plan renames resources.

## Step 1: Deploy history and apply semantics

Goal: move canonical deploy state from control service rows and deployment
snapshot helpers into `domains/deploy`, with runtime/provider effects recorded
as materialization output rather than canonical deployment truth.

### Apply engine

- Source owner: `application/services/deployment/*`.
- Mature source surface: apply engine, apply order, backend target translation,
  deploy validation, group state, rollback orchestration, readiness probes, and
  artifact refs.
- Target PaaS domain: `domains/deploy`, `services/deploy-orchestrator`,
  `services/rollout`, `services/status`, and `domains/runtime` for
  materialization records.
- Dependencies: source snapshots, artifact/object storage, provider adapter,
  routing projection, and resource/publication binding projections.
- Data tables: source `deployments`, `deployment_events`, `bundle_deployments`,
  `bundle_deployment_events`, `group_deployment_snapshots`; target
  `deploy_plans`, `deploy_activation_records`,
  `deploy_group_activation_pointers`, `deploy_operation_records`.
- Tests to port: `apply-engine*.test.ts`, `apply-order.test.ts`,
  `deploy-validation.test.ts`, `group-state.test.ts`, `execute.test.ts`,
  `backend*.test.ts`, `readiness-probe.test.ts`, `artifact-refs.test.ts`.
- Compat route impact: existing app/API deploy routes should call PaaS
  plan/apply and expose legacy deployment ids as compatibility aliases to
  activation/apply ids. Keep stale apply and rollback semantics visible to
  current clients.

### Deployment snapshots

- Source owner: `application/services/platform/group-deployment-snapshots*`.
- Mature source surface: snapshot record creation, archive/source/artifact
  metadata, and rollback source references.
- Target PaaS domain: `domains/deploy` for immutable activation/source metadata,
  `adapters/object-storage` for archive bytes, and `domains/supply-chain` where
  package/artifact digests become registry-backed.
- Dependencies: group identity from core, source adapter, object storage, and
  audit.
- Data tables: source `group_deployment_snapshots`; target
  `deploy_activation_records.source_json`,
  `deploy_activation_records.manifest_json`, and future artifact/supply-chain
  records.
- Tests to port: `group-deployment-snapshots*.test.ts`,
  `group-deployment-snapshot-source.test.ts`,
  `group-deployment-snapshot-artifacts.test.ts`,
  `group-deployment-snapshot-archives.test.ts`.
- Compat route impact: legacy snapshot list/detail routes should remain
  read-compatible, backed by activation/source records plus archive metadata.
  Snapshot status `applied` maps to activation pointer/current status.

### Deploy jobs

- Source owner: `runtime/queues/deploy-jobs.ts` and queue resolver wiring.
- Mature source surface: asynchronous deploy job envelope, queue naming, and
  retry entrypoint.
- Target PaaS domain: `workers/apply_worker`, `adapters/queue`, and
  `domains/deploy` operation records.
- Dependencies: queue adapter, signed worker actor, idempotency key, and audit.
- Data tables: source queue payload plus
  `deployments.status/current_step/step_error`; target
  `deploy_operation_records` and apply worker lease state.
- Tests to port: `runtime/queues/__tests__/deploy-jobs.test.ts`,
  `queue-names.test.ts`.
- Compat route impact: worker queue names may keep legacy aliases while
  `takos-paas-worker` owns processing. Route callers should not observe queue
  migration except improved operation ids/status.

## Step 2: Routing and runtime compatibility roots

Goal: move hostname, route ownership, and dispatch projection to PaaS routing
and runtime domains while preserving tenant-domain request compatibility.

### Tenant dispatch routing

- Source owner: `dispatch.ts`, `application/services/routing/*`, and
  `runtime/durable-objects/routing.ts`.
- Mature source surface: hostname resolution, weighted deployment targets,
  endpoint sets, rollout pending/schedule/cancel, and dispatch headers.
- Target PaaS domain: `domains/routing`, `services/rollout`, `domains/runtime`,
  and `adapters/router`.
- Dependencies: activation pointer, runtime materialization status, route
  ownership claims, and router config materializer.
- Data tables: source routing KV/DO state, `services.hostname`,
  `services.route_ref`, `deployments.routing_status`,
  `deployments.routing_weight`; target `RouteOwnershipStore`,
  `RouteProjectionStore`, and router config snapshots.
- Tests to port: `local-platform/__tests__/dispatch-routing.test.ts`,
  `routing-service.test.ts`, deployment `group-routing.test.ts`, platform
  `infra-routing-targets.test.ts`.
- Compat route impact: keep tenant-domain behavior and headers such as
  `X-Forwarded-Host`, `X-Takos-Internal`, `X-Tenant-Worker`, and
  `X-Tenant-Deployment` during cutover. `control-dispatch` remains a
  compatibility root for `takos-paas-router`.

### Local routing adapters

- Source owner: `node-platform/resolvers/routing-resolver.ts`,
  `local-platform/routing-store.ts`, and URL/HTTP endpoint local platform
  helpers.
- Mature source surface: local routing seed, persistent routing JSON, and HTTP
  endpoint target selection.
- Target PaaS domain: `adapters/router`, `domains/service-endpoints`, and
  `domains/routing`.
- Dependencies: local operator config, runtime service endpoint registry, and
  router config smoke.
- Data tables: source local JSON `routing-store.json`, KV
  `hostname-routing.json`, `infra_endpoints`, `infra_endpoint_routes`; target
  route projections plus service endpoint records.
- Tests to port: node resolver dispatch tests,
  `public-runtime-contract.test.ts`, and PaaS `router-config-smoke.ts` coverage.
- Compat route impact: preserve `TAKOS_LOCAL_ROUTING_JSON` and local data-dir
  compatibility until operators have a PaaS-native router config migration path.

### Runtime host roots

- Source owner: `runtime/container-hosts/*`, `local-platform/runtime-host*`, and
  executor proxy RPC.
- Mature source surface: runtime host fetch, executor auth/RPC, container
  runtime metadata, and public runtime contract.
- Target PaaS domain: `domains/runtime`, `agents`,
  `services/runtime-vertical-slice`, `services/runtime-logs`, and
  `domains/network`.
- Dependencies: workload identity, service grants, provider operation records,
  and logs/status projection.
- Data tables: source `service_runtimes`, `service_runtime_*`, runtime host
  state; target runtime stores and provider materialization records.
- Tests to port: `runtime-host.test.ts`, `executor-auth.test.ts`,
  `executor-control-rpc.test.ts`, `runtime-host-fetch.test.ts`,
  `public-runtime-contract.test.ts`.
- Compat route impact: keep `runtime-host` and `executor` as compatibility roots
  for `takos-paas-runtime-agent` and `takos-paas-log-worker` until
  process/resource names are migrated.

## Step 3: Resources and publications

Goal: port resource binding and publication/consume behavior into explicit PaaS
resource and publication domains so deploy planning can reason about durable
state, grants, and dependency impact before apply.

### Resource bindings

- Source owner: `application/services/resources/*` and platform resource binding
  helpers.
- Mature source surface: resource declarations, backend env formatting, service
  binding records, and access/token state.
- Target PaaS domain: `domains/resources`, `services/resources`, and
  `domains/network` for identity-bound access.
- Dependencies: deploy activation, provider materialization, secret store, and
  workload identity.
- Data tables: source `resources`, `resource_access`, `resource_access_tokens`,
  `service_bindings`, `service_env_vars`, `managed_takos_tokens`; target
  `resource_instances`, `resource_bindings`, `resource_binding_set_revisions`,
  `resource_migration_ledger`.
- Tests to port: `resources/__tests__/bindings.test.ts`, `backend-env.test.ts`,
  `format.test.ts`, platform `resource-bindings.test.ts`.
- Compat route impact: existing storage/resource APIs should map service/worker
  binding names to PaaS `ResourceBinding` claims. Durable resource state must
  not roll back with deploy activation rollback.

### Publications and consumes

- Source owner: `application/services/platform/service-publications.ts` and
  publication catalog helpers.
- Mature source surface: publication definitions, route output validation,
  consume resolution, output env contract, and Takos grant publications.
- Target PaaS domain: `domains/publications`, `services/publication-planner`,
  `services/event-planner`, and `services/change-set`.
- Dependencies: routing projection, resource binding revisions, group activation
  pointer, and app-owned OAuth/API-key grant handling in `takos/app`.
- Data tables: source `publications`, `service_consumes`,
  `service_common_env_links`, `service_mcp_endpoints`, `file_handlers`,
  `ui_extensions`; target publication, consumer binding, grant, and projection
  stores, with publication binding ids inside `resource_binding_set_revisions`.
- Tests to port: platform `service-publications.test.ts`, source
  `app-manifest-public-contract.test.ts`, PaaS
  `publication-planner/service_test.ts`, `event-planner/service_test.ts`,
  `change-set/service_test.ts`.
- Compat route impact: keep manifest `publish`/`consume` compatibility and
  legacy route-output validation. App-owned OAuth/API-key issuance stays in
  `takos/app`; PaaS records explicit grants and dependency plans.

### Manifest resource/publication parsing

- Source owner:
  `application/services/source/app-manifest-parser/parse-resources.ts`,
  `parse-publish.ts`, `parse-routes.ts`, and public manifest contract tests.
- Mature source surface: manifest parsing for routes, resources, publication
  output contracts, file-handler routes, and queue/scheduled triggers.
- Target PaaS domain: `domains/deploy/compiler`, `domains/resources`,
  `domains/routing`, `domains/publications`, and `domains/events`.
- Dependencies: source snapshot adapter, registry package resolution, and
  schedule/queue planner.
- Data tables: source manifest JSON in `bundle_deployments` and
  `group_deployment_snapshots`; target `deploy_plans.plan_json`, activation
  manifest/app spec JSON, and resource/publication projections.
- Tests to port: `app-manifest-public-contract.test.ts`,
  `app-manifest-bundle-docs.test.ts`, deployment `scheduled-triggers.test.ts`.
- Compat route impact: do not break public `.takos/app.yml` fields already
  accepted by control. Unsupported legacy fields can remain rejected, but error
  text should be preserved where clients assert it.

## Open storage gaps before implementation

- PaaS has Postgres table definitions for core, deploy, resources, registry, and
  audit, but routing and publications currently rely on in-memory stores. Add
  Postgres-backed route ownership/projection and publication/binding/projection
  tables before making them canonical.
- Existing control data is SQLite/D1-shaped and account/service-oriented; target
  PaaS data is space/group/activation-oriented. Migration needs an explicit
  account-to-space/group mapping sourced from app-owned membership metadata, not
  inferred from service rows alone.
- Compatibility reads should be implemented as projections/adapters over PaaS
  canonical records. Avoid dual writes unless the cutover plan defines
  reconciliation, ownership, and rollback behavior.
