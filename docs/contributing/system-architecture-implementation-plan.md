# Takos PaaS System Architecture Implementation Plan

This plan maps the architecture contract in
`../architecture/system-architecture.md` and the Deploy v2 spec kit in
`../takos-paas/` onto the `takos/paas` product root.

## Ground rules

- `takos-paas` remains one product root. Domain boundaries are modules, not
  default microservices.
- Integrated and standalone modes share the same PaaS core semantics.
  Differences are plugins, adapters, process roles, and topology.
- `takos-deploy` and `takos-runtime` are implemented as `domains/deploy` and
  `domains/runtime` inside `takos-paas`.
- Canonical writes stay in the primary control plane. Provider/runtime observed
  state is never canonical.
- Every domain exposes commands, queries, events, ports, and a store interface;
  other domains must not import a domain store directly.
- Self-host, cloud provider, database, queue, object-storage, KMS, and secret
  backend implementations are outside the kernel. The kernel owns the plugin ABI
  and reference no-I/O adapters; real connectivity is loaded through
  operator-selected plugins.

## Target code layout

```text
apps/paas/src/api/                  HTTP API, internal API, standalone host
apps/paas/src/domains/core/         tenant / space / group / membership / entitlement
apps/paas/src/domains/deploy/       Plan / ApplyRun / RolloutRun / ActivationRecord
apps/paas/src/domains/runtime/      WorkloadRevision / ProviderMaterialization / observed state
apps/paas/src/domains/resources/    ResourceInstance / ResourceBinding / MigrationLedger
apps/paas/src/domains/routing/      route ownership / RouteProjection
apps/paas/src/domains/network/      RuntimeNetworkPolicy / ServiceGrant / WorkloadIdentity
apps/paas/src/domains/registry/     package resolution / trust / provider packages
apps/paas/src/domains/audit/        append-only audit and security events
apps/paas/src/workers/              apply jobs / materialization / outbox consumers
apps/paas/src/agents/               runtime agent protocol and work leases
apps/paas/src/adapters/             kernel reference ports and legacy local adapters
apps/paas/src/plugins/              kernel plugin ABI registry, loader, reference plugin
apps/paas/src/shared/               ids / time / errors / common helpers
packages/paas-contract/src/         public/internal/plugin TypeScript contracts
```

## Milestones

### M0: Contract freeze and initial domains

Exit criteria:

- Architecture-to-code map exists.
- Contract package exports the core Takos PaaS vocabulary.
- App package has domain boundaries for core and deploy.
- `deno task check` passes.

### M1: Core domain

Implement:

- `ActorContext` normalized across integrated and standalone modes.
- signed internal RPC bound to method, path, timestamp, request id, actor
  context, and body digest.
- Space and Group command/query services.
- membership, role, and entitlement placeholders at mutation boundaries.
- memory stores and storage ports behind the storage driver boundary.
- domain event / outbox interface.

Exit criteria:

- health endpoint works.
- signed internal space/group APIs work.
- space/group creation produces stable summaries and domain events.
- unauthorized/malformed internal calls are rejected.

### M2: Deploy kernel vertical slice

Implement:

- flat public `.takos/app.yml` manifest model.
- compiler from public manifest to internal `AppSpec` / `EnvSpec` /
  `PolicySpec`.
- immutable `SourceSnapshot` for source adapters.
- non-mutating Plan creation with read set.
- ApplyRun state machine.
- immutable `ActivationRecord` creation.
- strongly consistent `GroupActivationPointer` advancement in store boundary.

Exit criteria:

- plan-only deploy creates no activation or workload materialization.
- apply creates an `ActivationRecord` and advances `GroupActivationPointer`.
- provider/materialization failure cannot mutate `ActivationRecord`.

### M3: Runtime/routing kernel vertical slice

Implement the kernel semantics first:

- `RuntimeHostCapability` and provider materialization port.
- `ProviderMaterialization` records target/package/object/status.
- observed state ingestion and readiness conditions.
- `RouteProjection` derived from activation and route ownership.
- status split: desired / serving / dependencies / security.

Exit criteria:

- provider plugins can record materialization without changing canonical
  activation truth.
- route projection is created.
- provider drift changes observed state only, not canonical activation.

### M4: Resources/network/secrets

Implement:

- `ResourceInstance`, `ResourceBinding`, `BindingSetRevision`.
- runtime secret injection separated from provider credentials and build
  secrets.
- `RuntimeNetworkPolicy` selectors with assignment awareness.
- `ServiceGrant` and `WorkloadIdentity` checks.

Exit criteria:

- resource create/bind works.
- rollback does not roll back durable resource state.
- provider credentials are unavailable to workloads.

### M5: Registry/provider packages/trust

Implement:

- bundled registry and package resolution from ref to digest.
- resource/data/publication/provider package descriptors.
- trust records, revocation, conformance tiers.
- provider support and satisfaction reports.

Exit criteria:

- package refs resolve to digests.
- revoked packages block new plans.
- existing affected groups become degraded rather than silently mutated.

### M6: Publications/events/dependencies

Implement:

- explicit publication consume bindings.
- publication projection and withdrawal/rebind policies.
- event subscriptions that resolve through `primaryAppReleaseId` by default.
- `ChangeSetPlan` for dependent groups.

Exit criteria:

- outputs are never injected automatically.
- breaking publication changes create dependent plans.
- deployment-time publication cycles are blocked.

### M7: Standalone PaaS kernel host

Implement:

- standalone API process using the same kernel services as integrated mode.
- operator-only plugin selection and module loading.
- reference no-I/O plugin for conformance and local development.
- production safety guards that reject unselected external boundaries.

Exit criteria:

- `takos-paas` boots without `takos-app`.
- space/group/deploy/rollback/uninstall work through the API with injected
  reference or operator plugins.
- same core services are used in integrated mode.

### M8: Acceptance test hardening

Convert `../takos-paas/tests/conformance-tests.md` into tests grouped by:

- plan/apply
- activation
- provider materialization
- resource contracts
- migration/restore
- canary side effects
- events
- publications/dependencies
- runtime security
- direct deploy
- GC/retention
- security/supply chain

## Verification

```bash
deno task check
deno task test:all
deno lint
deno fmt --check
```
