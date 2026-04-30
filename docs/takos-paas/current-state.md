# Takos PaaS Current State

Date: 2026-04-30

## Strict reference-kernel-with-external-plugins

The current `takos-paas` implementation treats Core kernel semantics as the
release boundary. The implemented path is descriptor-pinned Deployment
resolution (`Deployment.resolution.descriptor_closure`), canonical authoring
expansion, resolved graph digests carried in `Deployment.resolution.resolved_graph`,
apply-time read-set validation reflected as `Deployment.conditions[]`, immutable
`Deployment.desired` (including `desired.activation_envelope`), resource and
binding reports inlined into `Deployment.desired.bindings`, ProviderObservation
separation as a non-canonical observed-state stream, reference adapter
conformance, trusted plugin manifest verification, and operator-registered
external plugin selection. Deploy and runtime behavior are implemented as
internal domain modules inside the PaaS product root, not as separate top-level
service boundaries.

## v2 → v3 record migration status

v3 (Deployment-centric) is the canonical Core surface. The Phase 1 spec at
[`core/01-core-contract-v1.0.md`](./core/01-core-contract-v1.0.md) collapses
the prior v2 records onto three: `Deployment` (input + resolution + desired +
status + conditions + optional policy / approval), `ProviderObservation`
(observed-side stream), and `GroupHead` (group-scoped pointer). The Phase 2
contract types are exported from `takos-paas-contract` (`Deployment`,
`ProviderObservation`, `GroupHead`). The Phase 3 deploy-domain
`DeploymentService` (`apps/paas/src/domains/deploy/deployment_service.ts`) is
the canonical v3 entry point; it currently writes Deployment records with stub
`emptyResolution()` / `emptyDesired()` payloads while the v2 plan / apply
pipeline business logic (`buildCorePlanArtifacts`, `compileManifestToAppSpec`,
`resolvePublicDeployManifest`, `commitActivation`, `_recordCoreOperationGraph`,
`buildRollbackDeployPlan`) is being ported into the new helper layout. v2
record types remain exported for migration shims and for the docs/checklist /
migration validators that still pin the legacy names; they are not Core
canonical going forward.

The kernel does not make cloud provider APIs canonical. Cloudflare, AWS, GCP,
Kubernetes, Neon, R2, S3, and similar systems remain provider targets described
by descriptors and implemented by trusted provider plugins or operator bundles.

## Runtime Configuration

Staging and production runtime configuration must select explicit non-reference
kernel plugin ports, including `provider` and `coordination`, or provide
concrete adapters through operator-owned bootstrap code. The kernel rejects
stale selector names such as `TAKOS_PROVIDER=local-docker`,
`TAKOS_STORAGE_BACKEND=postgres`, and direct provider/backend URL selectors in
the PaaS runtime config path.

The no-op provider remains a local/reference adapter for tests and conformance.
It is not a silent fallback for staging or production.

`takos.kernel.reference` is the only in-repo plugin implementation. It provides
memory/noop/local adapters for tests, local development, and kernel conformance.
It is not a silent fallback for staging or production.

Self-hosted and cloud production behavior, including signed service auth,
database storage, source snapshots, provider materialization, queue/object
storage, router config, KMS, secret storage, notifications, observability, and
runtime agent integration, belongs in operator-provided external plugin bundles.
The ecosystem checkout contains a separate `takos-paas-plugins` root with
operator profile bundles for self-hosted, Cloudflare, AWS, and GCP. Those
profiles declare every required kernel port plus `coordination` and provide
adapter wrappers for Cloudflare D1/R2/Queues/Durable Objects/Workers/Containers,
AWS RDS/S3/SQS/KMS/Secrets/ECS-style control clients, GCP Cloud
SQL/GCS/Pub/Sub/KMS/Secret Manager/Cloud Run-style control clients, and
self-hosted Postgres/object/process/router clients. Provider SDK objects,
bindings, and credentials still enter through operator-injected clients. They
are configured through `TAKOS_KERNEL_PLUGIN_CONFIG`, not through stale kernel
backend selectors.

When a storage plugin is selected, canonical PaaS stores for core, deploy
(Deployment / GroupHead), runtime desired/observed state, ProviderObservation
streams, resources, registry, audit, usage aggregates, and service endpoints
are all routed through the selected `StorageDriver` transaction boundary.
Local/reference mode can still use in-memory stores for conformance and tests.

## Access path coverage

The Deployment resolver currently records access path entries inline on
`Deployment.desired.bindings[*].accessPath` for direct resource bindings,
preserves contract-scoped access modes, and surfaces ambiguous or unsupported
access selection as a blocking `Deployment.conditions[]` entry. When a selected
provider descriptor has a matching `resourceAccessPaths` entry, the Deployment
carries the descriptor's injection mode, stages, enforcement, limitations, and
provider-internal/external boundary. Locally represented paths are still
emitted with an internal network boundary.

The v1.0 rule that an external access-path `networkBoundary` must satisfy
`Deployment.desired.runtime_network_policy` is enforced at resolution time.
The resolver emits a blocking condition for external resource access paths
unless the environment runtime network policy allows external egress through
`defaultEgress: "allow"` or an explicit egress rule to `internet` / `0.0.0.0/0`
/ `::/0`. External provider bundles must continue to fail closed for their
own provider/client references.

## Plugin Loader

`TAKOS_KERNEL_PLUGIN_MODULES` is a reference module loader for local or operator
experiments. It is ignored unless the reference loader is explicitly enabled and
is rejected for staging/production.

Production plugin selection uses trusted plugins registered in the kernel
registry. The default registry contains the reference plugin only; no
self-hosted, Cloudflare, AWS, GCP, Kubernetes, Neon, R2, or S3 implementation is
registered by default. Provider descriptors and capability profiles document how
external bundles should integrate those targets through `TAKOS_*_PLUGIN`
selectors. They require operator-injected configuration or client references in
`TAKOS_KERNEL_PLUGIN_CONFIG`; the PaaS kernel does not construct cloud SDK or
provider network clients by default.

The PaaS API can be created through a side-effect-free bootstrap factory, so an
operator runtime can register trusted plugins and a `KernelPluginClientRegistry`
before serving traffic. The `takos-paas-plugins/deploy/cloudflare` scaffold
documents the Worker, D1, R2, Queue, Durable Object, and Container binding shape
for running the PaaS API behind Cloudflare infrastructure, and includes a Deno
container template for the PaaS API. Operators still need to inject real
Cloudflare clients and plugin config before serving traffic. Cloudflare
Containers are on-demand lifecycle infrastructure; strict always-on workloads
must target an always-on provider plugin such as Kubernetes, Cloud Run, or
self-hosted process/container infrastructure.

The external plugin root also includes operator bootstrap helpers, a Map-backed
client registry, Cloudflare Worker binding helpers, and AWS/GCP fetch-based
gateway clients with matching gateway handlers. Cloudflare R2 bindings can back
object storage directly, Queue bindings expose enqueue unless a full queue
client is injected, Durable Object bindings expose the coordination port, and D1
requires an injected Takos storage client or gateway. AWS and GCP gateway
clients call operator-controlled JSON endpoints; callback-based storage
transactions still require an injected storage driver because they cannot be
represented as a single stateless HTTP request. Credentialed live provider
checks are available through the `takos-paas-plugins` opt-in `live-smoke` task
and are skipped unless the operator sets `TAKOS_PAAS_PLUGIN_LIVE_PROVIDER`.

The `runtime-agent` port is a real plugin adapter port. Staging and production
plugins must return a `RuntimeAgentRegistry`; the route layer uses the selected
adapter instead of silently creating an in-memory registry when a configured
context is present.

Signed third-party production plugin enablement is supported only for plugin
implementations that are already present in an operator-controlled trusted
registry. The kernel verifies the signed manifest envelope, publisher key,
kernel API compatibility, implementation manifest equality, and install policy
before registering the plugin. It still rejects ad hoc dynamic module loading in
staging and production.

## Deploy shell status {#deploy-shell}

`takos/paas` の PaaS control plane が deploy (Deployment / GroupHead) / runtime
/ resource / routing / network / registry / audit の canonical semantics を提供
する。`takos/deploy` および `takos/runtime` は migration 中の compatibility
shell / stub であり、 Git repository fetch、manifest parse、persistent
Deployment history、rollback 等の business logic は実装していない。現行 CLI は
`takos/app` の deploy compatibility API (`/api/deploy/plans`,
`/api/deploy/apply-runs`) を経由する v2 facade と、Phase 3 で再構築中の v3
public surface (`POST /api/public/v1/deployments`,
`POST /api/public/v1/deployments/:id/apply`,
`POST /api/public/v1/groups/:group_id/rollback`,
`GET /api/public/v1/groups/:group_id/head`) が並走する。Phase 1 spec の API
mapping は core contract § 17–§ 18 を参照。

他章は
`> 現行実装の split status は [Current Implementation Note](/current-state#deploy-shell) を参照`
の 1 行 include で本セクションを参照する。

## API gateway split status {#api-gateway-split}

Takos app/API gateway は migration 中で 2 系統が並走している:

- `takos/app/apps/api`: split 後の minimum gateway。`/health`, `/api/spaces`,
  repository/source resolution, deploy snapshot routes, deploy compatibility
  routes, runtime-facing `/api/services` / `/api/resources` / `/api/sessions` の
  forwarding subset
- `takos/app/apps/control` + `takos/app/packages/control`: account / auth /
  profile / billing / OAuth と広い compatibility API を提供する compatibility
  app

この境界は migration 完了まで維持。public docs は `takos/app/apps/control` 側を
canonical reference として記述する。

他章は
`> 現行 API gateway split status は [API Gateway Split](/current-state#api-gateway-split) を参照`
の 1 行 include で本セクションを参照する。
