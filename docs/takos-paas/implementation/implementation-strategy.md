# Takos Deploy Implementation Strategy

This document complements the Takos Deploy Core Contract
([`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md)).

The core specification stays implementation-neutral. This document explains how
to implement it without becoming cloud-dependent, while still allowing cloud
providers and optional plugin-style extensions.

```text
Core defines meaning boundaries.
Implementation provides mechanisms.
Self-hosted must work.
Cloud providers are optional materializers.
Plugins are an implementation strategy, not a core requirement.
```

---

## 1. Goal

Takos Deploy should support both:

```text
Self-sufficient Takos:
  Runs on owned machines / VPS / local infrastructure.
  Does not require Cloudflare, Cloud Run, AWS, GCP, or any specific cloud.

Cloud-integrated Takos:
  Can materialize the same core contracts onto Cloudflare, Cloud Run, ECS, Kubernetes, Neon, R2, S3, etc.
```

The goal is not to make every provider identical. The goal is:

```text
Takos Core owns meaning.
Provider implementations materialize meaning.
```

A cloud provider may offer stronger native behavior, but it must not redefine
core semantics such as Deployment resolution, Deployment apply, the
`Deployment.desired.activation_envelope`, ResourceInstance, the
`Deployment.desired.bindings` shape, GroupHead advancement, or rollback.

---

## 2. Core vs implementation

### 2.1 Core specification

The core specification defines:

```text
Component
Named contract instance
Deployment (with input / resolution / desired / status / conditions)
Deployment.resolution.descriptor_closure
Deployment.resolution.resolved_graph
Deployment.desired.bindings
Deployment.desired.routes
Deployment.desired.runtime_network_policy
Deployment.desired.activation_envelope
ResourceInstance
ProviderObservation
GroupHead
```

Core does not define:

```text
JavaScript worker runtime internals
Container runtime internals
SQL database implementation
Object storage implementation
Queue implementation
Provider adapter packaging
Plugin loading
CLI syntax
Physical database schema
```

### 2.2 Implementation strategy

An implementation must provide mechanisms for:

```text
contract descriptors
provider capability descriptors
provider targets
input translation
build execution
artifact storage
provider materialization
observation / drift detection
runtime execution
routing / gateway materialization
resource lifecycle
```

These mechanisms may be implemented as:

```text
built-in code
static descriptor files
embedded providers
dynamic plugins
remote registries
local directories
operator-installed packages
```

Core does not care which mechanism is used as long as the resulting
`Deployment.resolution.resolved_graph`, `Deployment.desired`, apply behavior,
and ProviderObservation records satisfy the core contract.

---

## 3. Recommended implementation model

Use a hybrid implementation model:

```text
1. Core kernel and reference adapters first.
2. Stable provider/plugin port interface internally.
3. External operator-registered self-hosted/provider plugin bundles.
4. Trusted plugin manifest/signature policy for production selection.
```

In other words:

```text
Do not require cloud plugins or third-party dynamic plugin installation for Core
conformance.
Design provider implementations as plugins from the beginning.
```

This keeps the first implementation simple while avoiding a closed architecture.

---

## 4. Self-hosted provider bundle

Takosumi does not ship a built-in self-hosted provider implementation. A
self-hosted bundle can run on a single VPS or local server stack, but it is an
operator-owned external plugin bundle and not a Core semantic dependency.

The bundle should satisfy common contracts without any required cloud provider.

### 4.1 Suggested self-hosted stack

```text
HTTP gateway:
  Caddy or Traefik

JS runtime:
  Takos runtime-agent

Container runtime:
  Docker or Podman

SQL Postgres contract:
  local Postgres

SQLite/serverless-like contract:
  libSQL or local SQLite-compatible adapter

Object-store S3 contract:
  MinIO

Queue at-least-once contract:
  NATS JetStream, Redis Streams, or another local queue provider

Artifact storage:
  local object store / MinIO / filesystem-backed object storage

Secrets:
  encrypted control-plane storage, optionally Vault-compatible

DNS/TLS:
  Caddy/Traefik ACME for public domains, manual DNS support, wildcard local domain for dev
```

This gives Takos an example operator-owned non-cloud materialization path:

```text
runtime.js-worker@v1          -> takos.runtime-agent@v1
runtime.oci-container@v1      -> docker.host@v1
artifact.js-module@v1         -> local artifact store
artifact.oci-image@v1         -> local/remote OCI registry
interface.http@v1             -> caddy.gateway@v1 or traefik.gateway@v1
resource.sql.postgres@v1      -> local.postgres@v1
resource.object-store.s3@v1   -> minio.object-store@v1
resource.queue.at-least-once@v1 -> local.queue@v1
```

Use an operator-owned plugin id such as:

```text
operator.example.self-hosted
```

It is selected per kernel I/O port through `TAKOS_*_PLUGIN` or
`TAKOS_KERNEL_PLUGIN_SELECTIONS` and configured through
`TAKOS_KERNEL_PLUGIN_CONFIG`. That config stores per-plugin client references
under `pluginConfig[pluginId].clients`; the actual clients are injected by the
operator-owned `KernelPluginClientRegistry`, not constructed by the PaaS kernel.
Production and staging must select trusted external plugins for required ports
and cannot select reference/noop plugins.

### 4.2 Self-hosted environment example

```yaml
providerTargets:
  runtime-agent:
    provider: takos.runtime-agent@v1

  docker-host:
    provider: docker.host@v1

  gateway:
    provider: caddy.gateway@v1

  postgres:
    provider: local.postgres@v1

  object-store:
    provider: minio.object-store@v1

  queue:
    provider: local.queue@v1

providerMappings:
  componentProfiles:
    workload.js-http@v1:
      target: runtime-agent

    workload.oci-http@v1:
      target: docker-host

  interfaces:
    interface.http@v1:
      target: gateway

  resourceContracts:
    resource.sql.postgres@v1:
      target: postgres

    resource.object-store.s3@v1:
      target: object-store

    resource.queue.at-least-once@v1:
      target: queue
```

This environment may not support every feature. Unsupported features must be
visible on the Deployment record (resolution / desired / conditions).

Example:

```text
Blocked:
  component api requires provider-native Cloud Run traffic split.
  self-hosted gateway target does not support that native schema.
```

Or:

```text
Warning:
  egress private-network deny is advisory on docker.host@v1.
  Policy requires enforced egress, so the Deployment is blocked
  (Deployment.conditions[].reason="AccessPathExternalBoundaryRequiresPolicy").
```

---

## 5. Cloud providers as optional provider targets

Cloud providers are not special in the core.

Cloudflare Workers, Cloud Run, ECS, Kubernetes, Neon, R2, S3, and similar
systems are provider targets that satisfy contracts.

Example:

```text
Cloudflare Workers:
  runtime.js-worker@v1
  artifact.js-module@v1
  interface.http@v1

Cloud Run:
  runtime.oci-container@v1
  artifact.oci-image@v1
  interface.http@v1

Neon:
  resource.sql.postgres@v1

R2 / S3 / MinIO:
  resource.object-store.s3@v1
```

A cloud provider may expose provider-native configuration, but that
configuration must be:

```text
typed
versioned
policy-governed
Deployment-resolution-visible (resolved_graph projections + descriptor_closure)
not allowed to redefine core semantics
```

---

## 6. Provider plugin implementations

Provider implementations are external plugin bundles or operator bootstrap
adapters. The kernel may include reference adapters only for local/conformance
use.

### 6.1 External provider plugin

An external provider plugin is registered by an operator and selected per kernel
port.

```text
extensible
third-party provider support
operator-specific providers
faster experimentation
```

Requirements:

```text
explicit port capabilities
plugin trust and signing
provider credential isolation
compatibility testing
```

### 6.2 Recommended stance

```text
Core spec: no plugin requirement.
Implementation: support explicit provider ports and trusted external plugin selection first.
Architecture: keep provider code outside the PaaS kernel.
Production: only verified or operator-trusted providers.
Local/conformance mode: allow reference adapters by policy.
```

---

## 7. Provider implementation interface

This is an implementation interface, not a core object.

A provider implementation should expose capabilities similar to:

```ts
interface ProviderImplementation {
  validate(input: ValidateInput): Promise<ValidateResult>;
  estimate(input: EstimateInput): Promise<EstimateResult>;
  materialize(input: MaterializeInput): Promise<MaterializeResult>;
  observe(input: ObserveInput): Promise<ObservedState>;
  delete(input: DeleteInput): Promise<DeleteResult>;
}
```

Rules:

```text
validate:
  Checks whether the provider can materialize the resolved object.

estimate:
  Produces cost / quota / limitation information when available.

materialize:
  Creates or updates provider-side infrastructure according to core desired state.

observe:
  Reads provider-side observed state for convergence / drift.

delete:
  Deletes provider-side materialization only when lifecycle and policy allow.
```

Provider implementations must not define what the Deployment record, apply
phases, the activation envelope, ResourceInstance, or rollback mean.

They only materialize resolved meaning.

---

## 8. Provider execution isolation

Provider implementations may use powerful credentials. They must be isolated
from workload runtime and build runtime.

Minimum rules:

```text
Provider execution must not access tenant runtime secrets.
Provider execution must not access build secrets unless explicitly granted.
Provider execution may use only credentials assigned to its ProviderTarget.
Provider credential use must be audit logged.
Provider execution must be policy-governed.
Provider execution failures must produce provider operation records and conditions.
```

For dynamic plugins, additional rules are required:

```text
plugin signature or trust record
execution sandbox
network restrictions
credential scoping
version/digest pinning
revocation behavior
conformance tests
```

For operator-provided external plugins, the same semantic rules apply and the
operator-owned trust mechanism decides which implementations are available.

---

## 9. Contract and capability descriptors

Implementations must provide descriptors for contracts and capabilities.

A descriptor may come from:

```text
built-in files
operator configuration
local registry
remote registry
plugin metadata
compiled code
```

Core only requires that the compiler can produce a deterministic
`Deployment.resolution.resolved_graph` and matching descriptor closure entries.

### 9.1 Contract descriptor responsibilities

Contract descriptors define meaning:

```text
contract reference
config schema
lifecycle domain
allowed outputs
allowed access modes
allowed injection modes
permissions / scopes
compatibility rules
breaking change policy
```

### 9.2 Provider capability descriptor responsibilities

Provider capability descriptors declare support:

```text
which contracts can be materialized
which contract combinations can be materialized
provider limitations
supported access modes
supported injection modes
restore modes
migration engines
conformance status
```

### 9.3 Input translation descriptors

Authoring conveniences such as `kind: js-worker`, `takos deploy image`, or
`takos deploy compose` are translated before Deployment resolution finalizes.

Core does not specify the syntax. Implementation documentation should specify
official input forms.

Rules:

```text
translated output must be visible in Deployment.resolution.resolved_graph
translation mechanism must be deterministic
translation mechanism version/digest must be included in Deployment.resolution.descriptor_closure
production should use trusted official translators by default
```

---

## 10. Self-sufficient bootstrap path

Takos should be able to bootstrap without external cloud dependencies.

A minimal self-hosted deployment should support:

```text
HTTP apps
JS runtime-agent apps
OCI container apps
Postgres resources
S3-compatible object storage
At-least-once queue
Secrets
Artifact storage
Basic routing
TLS with manual or ACME DNS setup
Rollback to a compatible retained Deployment via GroupHead
Resource restore where provider supports it
```

It may initially lack:

```text
provider-native traffic split
advanced DNS automation
multi-region
full egress enforcement
native cloud resource features
```

Unsupported or advisory features must be visible on the Deployment record
(resolution / desired payload + `Deployment.conditions[]`).

Self-hosted mode must not silently fall back to unsafe behavior.

---

## 11. Cloud integration path

Cloud providers can be added as provider implementations.

Examples:

```text
Cloudflare Workers provider:
  materializes JS runtime + JS module artifact + HTTP interface

Cloud Run provider:
  materializes OCI container runtime + OCI image artifact + HTTP interface

Neon provider:
  materializes Postgres resource contract

R2 / S3 provider:
  materializes S3-compatible object-store contract
```

Cloud providers must pass the same Deployment resolution / apply / GroupHead
advancement / observation rules as self-hosted providers.

They may offer provider-native config, but the Deployment must show:

```text
native feature used
impact
cost/security sensitivity
portability impact
approval requirements
fallback or block behavior
```

---

## 12. Implementation phases

### Phase 1: Core kernel and reference adapters

Implement:

```text
descriptor-pinned Deployment resolution
apply-time read-set validation
Deployment.desired.activation_envelope
inlined Deployment.desired.bindings + access paths
ProviderObservation separation
reference adapters for conformance
```

Goal:

```text
Takos can prove Core semantics without claiming real provider ownership.
```

### Phase 2: Self-hosted provider bundle

Implement:

```text
runtime-agent provider
Docker/Podman provider
Caddy/Traefik gateway provider
local Postgres provider
MinIO provider
local queue provider
local artifact store
secret storage
```

Goal:

```text
Takos can deploy meaningful apps without Cloudflare/GCP/AWS.
```

### Phase 3: Cloud provider bundle requirements

Define descriptor-backed external provider bundle requirements for the clouds
already used operationally.

Likely candidates:

```text
Cloudflare Workers / dispatch / D1 / R2 / Queues
Cloud Run
Neon or Postgres provider
S3-compatible provider
```

### Phase 4: Stable provider interface

Stabilize internal provider implementation interface:

```text
validate
estimate
materialize
observe
delete
operation records
idempotency
credential isolation
audit
```

### Phase 5: Trusted plugin loading

After the port contracts and conformance tests are stable:

```text
plugin package format
signature / trust
sandbox
registry
conformance tests
operator enablement policy
```

Takos should remain usable with explicit operator-provided plugins or reference
adapters where allowed.

---

## 13. Decision matrix

| Approach                    | Pros                                  | Cons                                                 | Recommendation                |
| --------------------------- | ------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| Built-in only               | Simple, secure, easy bootstrap        | Harder ecosystem extension                           | Good for first implementation |
| Plugin only                 | Extensible                            | Security and bootstrap complexity                    | Avoid as initial requirement  |
| Built-in + optional plugins | Balanced                              | Requires clean provider interface                    | Recommended                   |
| Cloud-first providers       | Fast if existing infra is cloud-heavy | Weak self-sufficiency                                | Avoid as only path            |
| Self-hosted provider bundle | Ownership, portability, local dev     | Outside Core kernel; some features weaker than cloud | Future operator bundle        |

---

## 14. Non-negotiable rules

```text
1. Takos Core must not require a self-hosted provider path for conformance.
2. Cloud providers must be optional provider targets, not core assumptions.
3. Provider implementations materialize meaning; they do not define core meaning.
4. Provider state is observed (ProviderObservation), never canonical.
5. Built-in providers and plugins must obey the same Deployment resolution / apply / GroupHead-advance rules.
6. Provider credentials must be isolated from workload and build runtimes.
7. Unsupported enforcement must be visible on the Deployment (resolution + desired + conditions).
8. No silent unsafe fallback.
9. Authoring conveniences must compile to canonical AppSpec/EnvSpec/PolicySpec before resolution finalizes.
10. Dynamic plugins are optional, not required for core conformance.
```

---

## 15. Practical recommendation

Use this implementation direction:

```text
Build Takos Deploy as descriptor-driven and provider-interface-driven.
Keep the PaaS kernel reference-only and register self-hosted/provider implementations as external plugins.
Design provider implementations so they can be loaded through the trusted plugin path.
Do not make dynamic plugins required for the core system.
```

In short:

```text
Self-hosted first.
Cloud optional.
Plugins optional.
Provider interface stable.
Core remains small.
```
