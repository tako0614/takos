# Takos Deploy v2 Implementation Strategy

This document complements the Takos Deploy v2 Simple Core Architecture Contract.

The core specification stays implementation-neutral. This document explains how to implement it without becoming cloud-dependent, while still allowing cloud providers and optional plugin-style extensions.

```text
Core defines meaning boundaries.
Implementation provides mechanisms.
Self-hosted must work.
Cloud providers are optional materializers.
Plugins are an implementation strategy, not a core requirement.
```

---

## 1. Goal

Takos Deploy v2 should support both:

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

A cloud provider may offer stronger native behavior, but it must not redefine core semantics such as Plan, Apply, ActivationRecord, ResourceInstance, BindingSetRevision, or rollback.

---

## 2. Core vs implementation

### 2.1 Core specification

The core specification defines:

```text
Component
Named contract instance
Binding
Plan
ApplyRun
AppRelease
NetworkConfig
RuntimeNetworkPolicy
ActivationRecord
ResourceInstance
ResourceBinding
BindingSetRevision
ProviderMaterialization
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

Core does not care which mechanism is used as long as the resulting resolved graph, plan, apply behavior, and materialization records satisfy the core contract.

---

## 3. Recommended implementation model

Use a hybrid implementation model:

```text
1. Built-in official provider bundle for self-hosted Takos.
2. Built-in official provider bundle for current cloud integrations.
3. Stable provider interface internally.
4. Optional dynamic plugins later.
```

In other words:

```text
Do not require plugins to ship v1.
Design provider implementations as if they could become plugins.
```

This keeps the first implementation simple while avoiding a closed architecture.

---

## 4. Self-hosted reference provider bundle

Takos should ship a self-hosted provider bundle that can run on a single VPS or local server stack.

This bundle should be able to satisfy the common contracts without any required cloud provider.

### 4.1 Suggested self-hosted stack

```text
HTTP gateway:
  Caddy or Traefik

JS runtime:
  Takos runtime-host

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

This gives Takos a default non-cloud materialization path:

```text
runtime.js-worker@v1          -> takos.runtime-host@v1
runtime.oci-container@v1      -> docker.host@v1
artifact.js-module@v1         -> local artifact store
artifact.oci-image@v1         -> local/remote OCI registry
interface.http@v1             -> caddy.gateway@v1 or traefik.gateway@v1
resource.sql.postgres@v1      -> local.postgres@v1
resource.object-store.s3@v1   -> minio.object-store@v1
resource.queue.at-least-once@v1 -> local.queue@v1
```

### 4.2 Self-hosted environment example

```yaml
providerTargets:
  runtime-host:
    provider: takos.runtime-host@v1

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
      target: runtime-host

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

This environment may not support every feature. Unsupported features must be visible in Plan.

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
  Policy requires enforced egress, so Plan is blocked.
```

---

## 5. Cloud providers as optional provider targets

Cloud providers are not special in the core.

Cloudflare Workers, Cloud Run, ECS, Kubernetes, Neon, R2, S3, and similar systems are provider targets that satisfy contracts.

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

A cloud provider may expose provider-native configuration, but that configuration must be:

```text
typed
versioned
policy-governed
Plan-visible
not allowed to redefine core semantics
```

---

## 6. Built-in vs plugin provider implementations

Takos can support both implementation styles.

### 6.1 Built-in provider

A built-in provider is compiled into or shipped with Takos.

Advantages:

```text
simpler security model
easier bootstrap
stable official support
better for self-hosted reference implementation
```

Disadvantages:

```text
slower ecosystem extension
requires Takos release to add provider code
```

### 6.2 Plugin provider

A plugin provider is loaded dynamically or installed by an operator.

Advantages:

```text
extensible
third-party provider support
operator-specific providers
faster experimentation
```

Disadvantages:

```text
harder security model
provider credential isolation required
plugin trust and signing required
compatibility testing required
```

### 6.3 Recommended stance

```text
Core spec: no plugin requirement.
Implementation: support built-in providers first.
Architecture: design provider interface so plugins can be added later.
Production: only official or verified providers by default.
Local/operator mode: allow local providers by policy.
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

Provider implementations must not define what Plan, Apply, ActivationRecord, ResourceInstance, or rollback mean.

They only materialize resolved meaning.

---

## 8. Provider execution isolation

Provider implementations may use powerful credentials. They must be isolated from workload runtime and build runtime.

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

For built-in providers, the same semantic rules apply, but the packaging and trust mechanism can be simpler.

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

Core only requires that the compiler can produce a deterministic resolved graph and PackageResolution-like records.

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

Authoring conveniences such as `kind: js-worker`, `takos deploy image`, or `takos deploy compose` are translated before Plan.

Core does not specify the syntax. Implementation documentation should specify official input forms.

Rules:

```text
translated output must be visible in Plan
translation mechanism must be deterministic
translation mechanism version/digest must be included in Plan read set or equivalent reproducibility record
production should use trusted official translators by default
```

---

## 10. Self-sufficient bootstrap path

Takos should be able to bootstrap without external cloud dependencies.

A minimal self-hosted deployment should support:

```text
HTTP apps
JS runtime-host apps
OCI container apps
Postgres resources
S3-compatible object storage
At-least-once queue
Secrets
Artifact storage
Basic routing
TLS with manual or ACME DNS setup
Rollback to compatible AppRelease
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

Unsupported or advisory features must be Plan-visible.

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

Cloudflare Containers provider:
  materializes OCI container runtime + OCI image artifact + HTTP interface through a Worker / Durable Object / Container bridge

Neon provider:
  materializes Postgres resource contract

R2 / S3 provider:
  materializes S3-compatible object-store contract
```

Cloud providers must pass the same Plan / Apply / Activation / Materialization rules as self-hosted providers.

They may offer provider-native config, but Plan must show:

```text
native feature used
impact
cost/security sensitivity
portability impact
approval requirements
fallback or block behavior
```



---

## 12. Cloudflare Containers implementation path

Cloudflare Containers can be supported as a cloud provider target for the canonical contract tuple:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
```

It must not be introduced as a core kind such as `cloudflare-container`.

### 12.1 Provider position

Cloudflare Containers is a provider-fronted container materializer:

```text
request
  -> Worker / gateway code
  -> Durable Object-backed Container class
  -> Container instance
```

The provider implementation may create Worker, Durable Object, Container class, container image registry, and routing/materialization records as provider-owned infrastructure.

These provider-owned bridge objects are not AppSpec components unless the user explicitly declares them as components.

### 12.2 Supported contract tuple

A Cloudflare Containers target may advertise a materialization profile like:

```yaml
materializationProfiles:
  - ref: materialize.cloudflare-container-http@v1
    requiredContractSlots:
      - slot: runtime
        ref: runtime.oci-container@v1
        min: 1
        max: 1
      - slot: artifact
        ref: artifact.oci-image@v1
        min: 1
        max: 1
      - slot: httpInterface
        ref: interface.http@v1
        min: 1
        max: many
    limitations:
      - worker-fronted
      - durable-object-backed
      - http-ingress-only
      - no-direct-end-user-tcp-udp
      - provider-managed-placement
      - image-retention-required-for-rollback
```

If a component requires a non-HTTP end-user interface, the Plan must block unless the provider explicitly supports that interface.

### 12.3 Provider-native config

Cloudflare Containers settings are provider-native environment configuration, not portable AppSpec meaning.

Example:

```yaml
providerNative:
  cloudflare.containers.class@v1:
    components:
      api:
        values:
          defaultPort: 8080
          requiredPorts: [8080]
          sleepAfter: "5m"
          enableInternet: false
          pingEndpoint: "localhost/ready"
          instanceType: "basic"
          maxInstances: 10
```

Provider-native values must be Plan-visible, policy-governed, and included in the ResolvedGraph digest.

### 12.4 RuntimeNetworkPolicy

Cloudflare Containers provider should prefer a controlled outbound path:

```text
enableInternet=false
+ outbound handler / virtual host bridge
+ explicit RuntimeNetworkPolicy allowlist
```

Resource access from the container should be represented as binding material, commonly through `internal-url`, `secret-ref`, or other runtime-supported injection modes.

Example:

```text
api.ASSETS:
  source: resource assets
  access: object-store-api
  injection: internal-url http://assets.local
  enforcement: provider-mediated
```

The provider must produce an EgressPolicySatisfactionReport. If policy requires enforced egress and the provider can only provide advisory enforcement, Plan must block.

### 12.5 Activation and convergence

Cloudflare Containers does not change Takos activation semantics.

```text
ActivationRecord:
  canonical desired HTTP serving assignment

ProviderMaterialization:
  Worker / Durable Object / Container class / image / route materialization reference

Observed provider state:
  convergence status, container readiness, image rollout status
```

Activation commit and provider convergence are separate:

```text
ActivationCommitted:
  GroupActivationPointer moved to an ActivationRecord

ServingConverged:
  Worker bridge, container class, image, readiness, and routing are observed as converged
```

### 12.6 Artifact retention

Container image availability is required for rollback safety.

The provider implementation must record:

```text
source image digest
provider registry image ref
provider image digest/ref
retention deadline
rollback protection reason
```

Policy may require:

```yaml
artifactPolicy:
  mirrorExternalImages: true
  retainForRollbackWindow: true
```

The provider must protect images referenced by current activation, rollback windows, retained releases, and prepared plans.

### 12.7 Relationship to self-hosted containers

The same AppSpec can be materialized by a self-hosted provider:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
  -> Docker / Podman + Caddy / Traefik
```

or by Cloudflare Containers:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
  -> Worker + Durable Object-backed Container class
```

Core semantics remain identical. ProviderMaterialization differs.

### 12.8 Implementation warning

Cloudflare Containers is not a general-purpose Kubernetes or Docker replacement in the Takos model.

It is best treated as:

```text
Worker-fronted, Durable-Object-backed, HTTP-oriented serverless container materialization.
```

Takos should not silently map unsupported interfaces, host networking, persistent local disk assumptions, or direct end-user TCP/UDP needs onto this provider.


---

## 13. Implementation phases

### Phase 1: Built-in self-hosted bundle

Implement:

```text
runtime-host provider
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

### Phase 2: Cloud built-in providers

Implement official providers for the clouds already used operationally.

Likely candidates:

```text
Cloudflare Workers / dispatch / D1 / R2 / Queues
Cloud Run
Neon or Postgres provider
S3-compatible provider
```

### Phase 3: Stable provider interface

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

### Phase 4: Optional plugin loading

Only after built-in provider semantics are stable:

```text
plugin package format
signature / trust
sandbox
registry
conformance tests
operator enablement policy
```

Plugins should be optional. Takos should remain fully usable with built-in providers.

---

## 13. Decision matrix

| Approach | Pros | Cons | Recommendation |
|---|---|---|---|
| Built-in only | Simple, secure, easy bootstrap | Harder ecosystem extension | Good for first implementation |
| Plugin only | Extensible | Security and bootstrap complexity | Avoid as initial requirement |
| Built-in + optional plugins | Balanced | Requires clean provider interface | Recommended |
| Cloud-first providers | Fast if existing infra is cloud-heavy | Weak self-sufficiency | Avoid as only path |
| Self-hosted reference bundle | Ownership, portability, local dev | Some features weaker than cloud | Required baseline |

---

## 14. Non-negotiable rules

```text
1. Takos must have a self-hosted provider path.
2. Cloud providers must be optional provider targets, not core assumptions.
3. Provider implementations materialize meaning; they do not define core meaning.
4. Provider state is observed, never canonical.
5. Built-in providers and plugins must obey the same Plan / Apply / Activation rules.
6. Provider credentials must be isolated from workload and build runtimes.
7. Unsupported enforcement must be visible in Plan.
8. No silent unsafe fallback.
9. Authoring conveniences must compile to canonical specs before Plan.
10. Dynamic plugins are optional, not required for core conformance.
```

---

## 15. Practical recommendation

Use this implementation direction:

```text
Build Takos Deploy v2 as descriptor-driven and provider-interface-driven.
Ship official built-in providers first.
Make the self-hosted provider bundle a required reference implementation.
Design provider implementations so they can later be loaded as plugins.
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

