# Takos Deploy v2 Core Contract v1.0

**Status:** v1.0 final  
**Scope:** Core semantics only  
**Non-goal:** This document does not specify plugin loading, package managers, descriptor registry APIs, billing, concrete JavaScript Worker / container / SQL implementations, or concrete cloud provider APIs.

Takos Deploy v2 is a deployment meaning system.

```text
Core has no domain kinds.
Core defines deployment meta-objects.
Descriptors define meaning.
Plans pin descriptors.
Apply uses pinned meaning.
Bindings are explicit.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
Providers materialize; they do not define.
Provider capability descriptors MAY constrain, reject, or report limitations for contract configurations. They MUST NOT reinterpret contract semantics.
Observed provider state is never canonical.
```

Core does not define built-in concepts such as `js-worker`, `container`, `sql`, `queue`, `mcp-server`, `file-handler`, `Cloudflare`, `Cloud Run`, `Docker`, or `Kubernetes`.

Core still defines deployment meta-objects such as `Component`, `Plan`, `ApplyRun`, `ActivationRecord`, `ResourceInstance`, `BindingSetRevision`, and `ProviderMaterialization`.

Concrete meanings are supplied by descriptors. A Takos distribution may ship official descriptor sets, and an implementation may support authoring conveniences, but those are outside Core semantics.

---

## 1. Normative keywords

```text
MUST      required for Core conformance
SHOULD    strongly recommended, but may be relaxed with documented rationale
MAY       optional
MUST NOT  forbidden for Core conformance
```

---

## 2. Core invariants

```text
1. Core MUST NOT assign built-in meaning to workload, resource, publication, or provider names.
2. Every concrete meaning used by Plan MUST come from descriptor resolutions.
Descriptors MUST be declarative. Descriptors MUST NOT contain arbitrary executable behavior, provider-specific callbacks, or implementation-specific code.
3. Apply MUST use the DescriptorClosure fixed by Plan.
4. Apply MUST NOT reinterpret descriptor URLs, aliases, or remote contexts at execution time.
5. Publication MUST NOT imply injection.
6. Resource credentials MUST NOT be publication outputs by default.
7. Provider-assigned outputs MUST NOT be directly injectable.
8. Binding material MUST be explicitly selected in a BindingSetRevision.
9. BindingSetRevision structure MUST be immutable.
10. Binding values MAY refresh only according to BindingValueResolution policy.
11. ProviderMaterialization is Takos-side desired/reference state.
12. ProviderObservation is observed provider state.
13. Observed provider state MUST NOT be canonical.
14. ActivationRecord records a desired routed serving envelope, not proof of router/provider convergence.
15. GroupActivationPointer selects the current immutable ActivationRecord.
16. RouterConfig and RuntimeNetworkPolicy changes require a new ActivationRecord.
17. Rollback MUST NOT reverse migrations or restore durable resource contents.
18. Retained releases MUST use retained immutable artifacts and retained or policy-approved immutable descriptors.
```

---

## 3. Scope boundaries

Core intentionally does not define:

```text
concrete runtime behavior
concrete resource behavior
provider plugin loading
provider marketplace mechanics
descriptor registry APIs
billing / quotas
actor or volume primitives
multi-region active-active semantics
automatic application-level DB write compatibility inference
```

Core defines only the meaning boundaries and required records for deterministic Plan, Apply, Activation, Binding, Resource access, and Materialization.

Core is router-layer protocol-agnostic. Core does not define HTTP, TCP, UDP, WebSocket, gRPC, QUIC, or any other protocol as a built-in kind. Routable protocols and their matching, assignment, health, and materialization semantics are descriptor-defined.

---

## 4. AppSpec, EnvSpec, and PolicySpec

### AppSpec

AppSpec declares application meaning:

```text
components
named contract instances
exposures
consume declarations
publication declarations
application-level requirements
```

AppSpec MUST NOT silently encode environment provider choices unless the relevant descriptor explicitly marks the configuration as application behavior.

### EnvSpec

EnvSpec binds application meaning to an environment:

```text
provider targets
route / listener / domain / transport security choices
runtime network policy choices
environment-specific materialization preferences
access path preferences
```

EnvSpec MUST NOT redefine AppSpec meaning.

### PolicySpec

PolicySpec constrains and defaults behavior:

```text
allow
deny
require approval
defaults
limits
credential and trust policy
```

PolicySpec does not define application intent, but policy defaults MAY affect ResolvedGraph materialization choices.

Policy precedence is:

```text
deny > require-approval > allow
```

Approval MUST NOT override deny unless PolicySpec explicitly defines break-glass behavior.

---

## 5. Components and named contract instances

A component is a named bundle of contract instances.

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.oci-container@v1

      artifact:
        ref: artifact.oci-image@v1
        config:
          image: ghcr.io/acme/api@sha256:abc

      publicHttp:
        ref: interface.http@v1
        config:
          port: 8080

      adminHttp:
        ref: interface.http@v1
        config:
          port: 9090
```

Rules:

```text
Contract ref is the type.
Contract instance name is the local instance inside the component.
The same contract ref MAY be used more than once with different instance names.
Core behavior MUST be derived from descriptor semantics, not from instance names.
```

A canonical component MUST have exactly one selected revisioned-runtime root unless a descriptor explicitly defines a composite component. If multiple possible runtime roots exist and no materialization profile binds them unambiguously, Plan MUST be blocked.

Authoring conveniences such as `kind: container`, `kind: js-worker`, `takos deploy image`, or `takos deploy worker` are outside Core semantics. They MUST expand to canonical component and contract instance form before Plan. Their expansion descriptor digest MUST be included in the DescriptorClosure.

---

## 6. Descriptors and DescriptorClosure

Descriptors define meaning. A descriptor is identified by a canonical URI and fixed by digest.

```text
alias:  runtime.oci-container@v1
id:     https://takos.dev/contracts/runtime/oci-container/v1
digest: sha256:...
```

Aliases are authoring conveniences. Canonical descriptor identity is the URI. Execution truth is digest.

### DescriptorResolution

```ts
interface DescriptorResolution {
  id: string;                    // canonical URI
  alias?: string;                // authoring alias, if any
  documentUrl?: string;          // where it was loaded from
  mediaType: string;             // application/json, application/ld+json, etc.
  rawDigest: string;             // fetched bytes
  expandedDigest?: string;       // canonical semantic form, if applicable
  contextDigests?: string[];     // JSON-LD or equivalent contexts
  canonicalization?: {
    algorithm: string;
    version: string;
  };
  policyDecisionId: string;
}
```

If a descriptor declares an internal canonical id, it MUST match the expected id unless PolicySpec explicitly allows aliasing.

### DescriptorClosure

```ts
interface DescriptorClosure {
  id: string;
  digest: string;
  resolutions: DescriptorResolution[];
  dependencies: DescriptorDependency[];
  createdAt: string;
}

interface DescriptorDependency {
  fromDescriptorId: string;
  toDescriptorId: string;
  reason:
    | "jsonld-context"
    | "schema"
    | "compatibility-rule"
    | "permission-scope"
    | "resolver"
    | "shape-derivation"
    | "access-mode"
    | "policy";
}
```

Rules:

```text
DescriptorClosure MUST include every descriptor that can affect shape derivation, provider matching, binding resolution, access path selection, publication resolution, policy evaluation, or operation planning.
DescriptorClosure MUST include transitive descriptor dependencies.
Apply MUST use the DescriptorClosure fixed by Plan.
Apply MUST NOT fetch a new descriptor version or reinterpret remote context URLs.
```

Same major ref updates MUST be backward-compatible. Breaking changes require a new major ref. Compatibility MAY be established by descriptor compatibility declarations, conformance tests, schema diff, author attestation, or policy approval. Policy MAY block unknown or weak compatibility evidence.

Retained releases MUST retain descriptor digests required for interpretation, binding, and materialization in Takos-controlled storage or in a policy-approved immutable source for the rollback window.

---

## 7. Policy decisions and approvals

Policy MUST be evaluated before irreversible or externally visible action.

Policy gates are grouped as:

```text
Resolution gate:
  descriptor resolution, authoring expansion, graph projection, provider target selection

Planning gate:
  binding resolution, access path selection, operation planning, approval evaluation

Execution gate:
  apply phase revalidation, provider materialization, activation preview

Recovery gate:
  rollback, restore, repair, rebind, retained release interpretation
```

Every meaningful policy decision SHOULD produce a PolicyDecisionRecord.

```ts
interface PolicyDecisionRecord {
  id: string;
  gate:
    | "resolution"
    | "planning"
    | "execution"
    | "recovery"
    | string;
  subjectAddress?: string;
  subjectDigest: string;
  decision: "allow" | "deny" | "require-approval";
  ruleRef?: string;
  decidedAt: string;
}

interface ApprovalRecord {
  id: string;
  policyDecisionId: string;
  subjectDigest: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
}
```

Policy says whether approval is required. ApprovalRecord records the human or system approval that satisfies that requirement. Approval MUST NOT convert a deny decision into allow unless explicit break-glass policy permits it.

Descriptor policy itself MUST be evaluated by a bootstrap trust rule, not by the policy descriptor it is currently defining.

---

## 8. ResolvedGraph and projections

The compiler turns AppSpec + EnvSpec + PolicySpec + DescriptorClosure into ResolvedGraph.

ResolvedGraph MAY be flat internally, but it SHOULD expose deterministic projections for controllers. Controllers SHOULD consume projections rather than reinterpret raw descriptors independently.

```ts
interface ProjectionRecord {
  projectionType: string;
  objectAddress: string;
  sourceComponentAddress: string;
  sourceContractInstance: string;
  descriptorResolutionId: string;
  digest: string;
}
```

Projection families are compiler outputs for controller routing, not authoring kinds. Examples include runtime claims, resource claims, exposure targets, publication declarations, binding requests, and access path requests.

---

## 9. ObjectAddress

ObjectAddress is the stable address used for diff, audit, idempotency, repair, binding, and ownership.

Formal grammar:

```text
ObjectAddress = Segment ("/" Segment)*
Segment       = Namespace ":" EncodedName
Namespace     = [a-z][a-z0-9.-]*
EncodedName   = percent-encoded UTF-8 string without unescaped "/"
```

Canonical examples:

```text
app.component:api
app.component:api/app.contract:publicHttp
app.exposure:web
app.binding:api%2FDATABASE_URL
resource.instance:db_inst_123
publication:search-agent%2Fsearch
publication:search-agent%2Fsearch#url
runtime.app-release:rel_123
network.activation:act_456
provider.materialization:pm_789
```

Rules:

```text
Addresses are case-sensitive.
Path separators inside names MUST be percent-encoded.
Renames MUST NOT be inferred by similarity.
Rename/adoption requires previousAddress or explicit adoption metadata.
Cross-contract rename is a dangerous change unless an explicit migration/rebind plan exists.
```

---

## 10. Interface, exposure, route, router, and publication

The boundaries are:

```text
Interface:
  component-side reachable surface; how the component can receive traffic or calls

Exposure:
  app-level intent to expose a component interface

Route:
  environment/router binding of an exposure to a listener, protocol-specific match,
  gateway, and transport/security policy

Router:
  materialized routing layer that can serve protocol-specific routes

Publication:
  typed output that says what an endpoint or value means
```

Invariants:

```text
Interface does not know domain.
Exposure does not know provider implementation.
Route does not know artifact or runtime implementation.
Router materialization does not define application meaning.
Publication does not imply injection.
Transport protocol does not determine object type.
```

Exposure target MUST reference a contract instance whose descriptor has `exposureEligible=true` or equivalent descriptor semantics.

### InterfaceDescriptor and RouteDescriptor

Router-agnostic Core separates component-side protocol capability from router-side protocol binding:

```text
InterfaceDescriptor:
  defines what a component can receive or serve.
  Examples: HTTP request surface, TCP connection surface, UDP datagram surface,
  gRPC service surface, internal service surface.

RouteDescriptor:
  defines how RouterConfig can match, listen, terminate transport/security,
  and forward traffic to an Exposure.
```

They MUST be compatible during activation preview. A RouteDescriptor MUST NOT redefine the component-side interface meaning. An InterfaceDescriptor MUST NOT define environment route/domain/provider choices.

### Serving channel descriptors

Core is protocol-agnostic. A routable interface/route descriptor MAY define, for example:

```text
HTTP host/path/request routing
TCP listener/connection routing
UDP datagram or flow routing
WebSocket session routing
gRPC service/method/stream routing
QUIC or future transport routing
internal-only service routing
```

Core MUST NOT assume that every route is HTTP. Core also MUST NOT assume that every serving channel supports weighted assignment, request mirroring, header/path matching, TLS termination, connection draining, or health probing. Those capabilities are descriptor-defined and provider-validated.

Serving channel descriptors MUST be declarative. They MAY define routing semantics, assignment granularity, health observation requirements, and compatibility rules, but MUST NOT contain arbitrary routing code or provider-specific executable behavior.

If a serving channel descriptor does not support weighted assignment, Plan MUST require a single assignment with weight 100 for that channel or block the rollout strategy. If a serving channel has connection, flow, stream, session, or datagram semantics, the descriptor MUST define how assignment is applied. If deterministic assignment semantics cannot be defined for the protocol/provider combination, weighted assignment MUST be unsupported.

Transport protocol does not determine object type:

```text
external client -> routed listener -> component:
  RouterConfig

component -> resource over TCP/HTTP/connector:
  ResourceAccessPath

component -> arbitrary external destination:
  RuntimeNetworkPolicy
```

For long-lived sessions or streams, the descriptor SHOULD define assignment point, drain behavior, and session affinity semantics. For protocols without observable health, `ServingConverged` MAY remain unknown unless the descriptor or provider materialization profile defines a probe or observation model.

## 11. Bindings, access modes, and injection modes

AccessMode and InjectionMode are different.

```text
AccessMode:
  what is obtained from the source

InjectionMode:
  how the material is delivered to the component
```

Canonical access modes are contract-scoped:

```yaml
access:
  contract: resource.sql.postgres@v1
  mode: database-url
```

Authoring shorthand MAY omit the contract only when the source is already unambiguous. Ambiguous shorthand MUST block Plan.

Binding material MUST pass:

```text
source contract permits access
provider supports access
output descriptor permits injection
runtime supports injection
provider supports injection
policy permits sensitivity and injection
grant exists
no injection target collision
```

### BindingResolutionReport

```ts
interface BindingResolutionReport {
  componentAddress: string;
  bindingSetRevisionId?: string;
  inputs: BindingResolutionInput[];
  blockers: string[];
  warnings: string[];
}

interface BindingResolutionInput {
  bindingName: string;
  source: "resource" | "publication" | "secret" | "provider-output";
  sourceAddress: string;
  access?: { contract: string; mode: string };
  injection: { mode: string; target: string };
  sensitivity: "public" | "internal" | "secret" | "credential";
  enforcement: "enforced" | "advisory" | "unsupported";
}
```

Binding target collisions MUST block Plan unless the relevant runtime descriptor explicitly supports ordered merge and every binding declares precedence.

---

## 12. BindingSetRevision and BindingValueResolution

BindingSetRevision is an immutable structure record.

```text
source
access mode
injection mode
target name
sensitivity
grant reference
```

Changing structure requires a new BindingSetRevision and normally a new AppRelease.

BindingValueResolution records value/version resolution.

```ts
interface BindingValueResolution {
  bindingSetRevisionId: string;
  bindingName: string;
  sourceAddress: string;
  resolutionPolicy: "latest-at-activation" | "pinned-version" | "latest-at-invocation";
  resolvedVersion?: string;
  resolvedAt: string;
  sensitivity: "public" | "internal" | "secret" | "credential";
}
```

Core default allowed policies are `latest-at-activation` and `pinned-version`. `latest-at-invocation` MAY be used only if the RuntimeContract and PolicySpec explicitly permit it.

If a secret or credential version referenced by BindingValueResolution is revoked, the implementation MUST surface a condition such as `SecretVersionRevoked` or `SecretResolutionFailed`. Repair or re-resolution MUST be planned explicitly.

---

## 13. ResourceInstance, ResourceBinding, and ResourceAccessPath

ResourceInstance carries durable state. ResourceBinding connects a claim to an instance. ResourceAccessPath records how a component reaches that resource.

Resource access is not determined by the resource alone. It is selected by:

```text
Resource contract
consumer component shape
requested AccessMode
requested InjectionMode
provider support
policy
grant
selected ResourceAccessPath
```

ResourceAccessPath is resource-only. External egress and internal service calls are governed by RuntimeNetworkPolicy and ServiceGrant-like semantics, not by ResourceAccessPath.

```ts
interface ResourceAccessPath {
  id: string;
  networkBoundary: "internal" | "provider-internal" | "external";
  consumerAddress: string;
  resourceBindingId: string;
  access: { contract: string; mode: string };
  injection: { mode: string; target: string };
  stages: AccessPathStage[];
  enforcement: "enforced" | "advisory" | "unsupported";
  limitations?: string[];
}

interface AccessPathStage {
  category: "direct" | "credential" | "mediated" | "brokered";
  materializationRef?: string;
  providerTarget?: string;
  owner?: "takos" | "provider" | "operator";
  lifecycle?: "per-component" | "per-resource" | "shared";
  readiness?: "required" | "optional";
  credentialVisibility?: "consumer-runtime" | "mediator-only" | "provider-only" | "control-plane-only" | "none";
}
```

If multiple valid resource access paths exist, selection order is:

```text
1. explicit EnvSpec selection
2. explicit PolicySpec selection or preference
3. strongest enforcement level
4. lowest credential visibility / sensitivity exposure
5. provider priority / cost / locality rule
6. otherwise Plan blocked with alternatives
```

If a resource-access path crosses an external network boundary, RuntimeNetworkPolicy MUST also be satisfied.

---

## 14. Minimal release and router/network objects

Core does not define concrete runtime or provider behavior, but it does define minimum identity and status for these records.

```ts
interface AppRelease {
  id: string;
  groupId: string;
  resolvedGraphDigest: string;
  componentRevisionRefs: string[];
  bindingSetRevisionRefs: string[];
  status: "preparing" | "ready" | "failed" | "retired";
}

interface RouterConfig {
  id: string;
  groupId: string;
  routeRefs: string[];        // protocol-agnostic route/listener references
  status: "preparing" | "ready" | "failed" | "retired";
}

interface RuntimeNetworkPolicy {
  id: string;
  groupId: string;
  policyDigest: string;
  status: "preparing" | "ready" | "failed" | "retired";
}
```

RuntimeNetworkPolicy governs external egress, internal service identity, component-to-service permissions, and primary/candidate assignment-specific runtime access. It is distinct from RouterConfig.

RouterConfig governs inbound routed serving: listeners, protocol-specific route matching, domains when applicable, gateways, and transport/security policy for traffic entering the platform.

Boundary:

```text
client -> router:
  RouterConfig

router -> component runtime:
  RouterConfig + ProviderMaterialization

component -> resource:
  ResourceAccessPath

component -> external destination:
  RuntimeNetworkPolicy

component -> internal service:
  RuntimeNetworkPolicy / service identity semantics
```

RouterConfig is protocol-agnostic. A route may target any routable interface contract whose descriptor declares it routable. Concrete protocol examples such as HTTP, TCP, UDP, WebSocket, gRPC, or QUIC are non-normative examples, not Core kinds. Protocol descriptors define listener shape, routing keys, assignment granularity, health/probe model, and materialization requirements.

Changing RouterConfig or RuntimeNetworkPolicy requires a new ActivationRecord, even if AppRelease assignments do not change. This keeps the active runtime/router/policy envelope immutable.

---

## 15. PublicationResolution and PublicationConsumerBinding

Publication is typed output. It is not injection.

Publication output descriptors MUST define value type and sensitivity. HTTP URL outputs are one possible value shape, not a Core assumption. Non-normative examples include `url`, `endpoint`, `host`, `port`, `protocol`, `service-ref`, `secret-ref`, `json`, and `string`. TCP, UDP, gRPC, QUIC, and future routed protocols MAY publish endpoint-shaped outputs defined by their descriptors.

PublicationResolution records output values.

```ts
interface PublicationResolution {
  publicationAddress: string;
  resolverRef: string;
  inputDigests: string[];
  outputDigest: string;
  values: Record<string, unknown>;
}
```

PublicationResolution changes MUST NOT mutate existing PublicationConsumerBindings. A change creates a rebind candidate. If policy permits automatic rebind, a new BindingSetRevision is created. Otherwise a consumer rebind Plan is required.

`PublicationWithdrawn` means the producer declaration was removed. `PublicationUnavailable` means the declaration exists but resolution, projection, route, or auth is not currently usable.

PublicationProjection is discovery/projection state, not provider infra. It MUST NOT be recorded as ProviderMaterialization.

---

## 16. Plan

Plan records:

```text
diff
risk
approval requirements
DescriptorClosure
PolicyDecisionRecords
ApprovalRecords, if any
ResolvedGraph digest
BindingResolutionReport
operation graph
read set
staleness behavior
```

Plan MUST include descriptor resolutions for every descriptor that can affect:

```text
shape derivation
provider matching
binding resolution
access path selection
publication resolution
policy evaluation
operation planning
```

Plan MUST show significant descriptor trust warnings, binding sensitivity, access path enforcement, and provider limitations.

---

## 17. ApplyRun, ApplyPhase, and OperationRun

Apply executes a Plan with scoped locks, idempotent operations, and phase-boundary revalidation.

```ts
interface ApplyPhase {
  id: string;
  applyRunId: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  revalidationRequired: boolean;
}
```

OperationRun belongs to an ApplyPhase. Operation kind names are stable strings such as:

```text
descriptor.resolve
component.project
resource.bind
resource.migrate
resource.restore
binding-set.create
runtime.deploy
router.prepare
publication.resolve
publication.rebind
access-path.materialize
activation.create
provider.materialize
provider.observe
repair.plan
```

Default idempotency key:

```text
applyRunId + operationKind + objectAddress + desiredDigest
```

Operation-specific keys MAY override this when required, such as migration checksum or ActivationRecord digest.

---

## 18. ActivationRecord, GroupActivationPointer, RouterConfig, and serving status

ActivationRecord is an immutable desired routed serving envelope. It selects the AppRelease records, RouterConfig, and RuntimeNetworkPolicy that should be active for the group.

For routed components, ActivationRecord also records desired routed serving assignment. For non-routed groups, ActivationRecord still acts as the active runtime/policy envelope.

ActivationRecord is protocol-agnostic. HTTP is one possible routed protocol, not a Core assumption. TCP, UDP, WebSocket, gRPC, QUIC, or future protocols are valid when their interface/route descriptors define the semantics and the selected provider/materialization supports them.

```ts
interface ActivationAssignment {
  appReleaseId: string;
  weight: number;
  labels?: Record<string, string>;
}

interface ActivationRecord {
  id: string;
  groupId: string;
  routerConfigId: string;
  runtimeNetworkPolicyId: string;
  primaryAppReleaseId: string;
  assignments: ActivationAssignment[];
  createdAt: string;
}

interface GroupActivationPointer {
  groupId: string;
  currentActivationRecordId: string;
  generation: number;
  updatedAt: string;
}
```

ActivationRecord invariants:

```text
ActivationRecord MUST be immutable.
GroupActivationPointer selects the current ActivationRecord.
Advancing GroupActivationPointer is the canonical activation commit.
assignment weights MUST sum to 100 for weighted routed serving assignments.
primaryAppReleaseId MUST be one of assignments.
assigned AppRelease records MUST be ready and not retired.
routerConfigId MUST be compatible with every assigned AppRelease.
runtimeNetworkPolicyId MUST be compatible with every assigned AppRelease and assignment role.
RuntimeNetworkPolicy MUST be compatible with primary and candidate assignments.
RouterConfig MUST support the assignment granularity required by each routed interface descriptor.
If a route/interface/provider combination does not support weighted assignment, ActivationRecord MUST use a single assignment with weight 100 for that routed traffic or Plan MUST be blocked.
Protocol-specific routing constraints MUST be validated by descriptors and provider materialization profiles during activation preview.
```

Activation preview MUST include at least:

```text
exposure target exists and is exposureEligible
InterfaceDescriptor is compatible with RouteDescriptor
router provider/materialization supports required protocol/listener semantics
assignment semantics are supported or blocked
health/probe/convergence model is declared or explicitly unknown
transport/security policy is supported
RuntimeNetworkPolicy covers every assigned AppRelease and primary/candidate selector used
```

For non-routed groups:

```text
RouterConfig MAY contain zero routes.
ActivationRecord SHOULD contain one assignment for primaryAppReleaseId with weight 100.
This records the active AppRelease and RuntimeNetworkPolicy even when there is no routed ingress.
```

Protocol-specific assignment semantics are descriptor-defined:

```text
HTTP-like protocols MAY use request-level weighted assignment.
TCP-like protocols MAY use connection-level weighted assignment.
UDP-like protocols MAY use flow-level, datagram-level, or provider-defined assignment.
gRPC-like protocols MAY use request, stream, service, or method assignment.
A descriptor MAY declare weighted assignment unsupported.
If a descriptor cannot define deterministic assignment semantics, weighted assignment MUST be unsupported.
```

Core default assignment applies globally across routed traffic selected by the current RouterConfig. Route-specific or protocol-specific assignment MAY be supported. If supported, its canonical desired state MUST be recorded in ActivationRecord or an ActivationRecord-owned extension digest, not hidden in provider state.

Specific RuntimeNetworkPolicy selectors MAY match `appReleaseId` directly. The assignment role `primary` is derived from `primaryAppReleaseId`; `candidate` means an assigned AppRelease that is not primary.

ActivationRecord is not proof of provider/router convergence. It is the Takos desired active envelope and routed serving assignment.

Serving status uses conditions:

```text
ActivationCommitted
ServingMaterializing
ServingConverged
ServingDegraded
```

`ServingConverged` MUST require provider observation for materializations required by the current RouterConfig, RuntimeNetworkPolicy when relevant, and ActivationRecord. For non-HTTP protocols, the descriptor or provider materialization profile MUST define what observation is sufficient for convergence. Protocols without observable health MAY remain unknown or materializing until descriptor-defined observation succeeds.

Provider materialization failure MUST NOT mutate or delete ActivationRecord. Repair or rollback creates new Plan and, if needed, a new ActivationRecord. Auto rollback, if supported by policy, MUST also create a new ActivationRecord and advance GroupActivationPointer.

---

## 19. ProviderMaterialization and ProviderObservation

ProviderMaterialization is Takos-side desired materialization reference. `role="router"` records routed serving materialization, including provider-created bridges, gateways, dispatchers, listeners, or protocol frontends.

```ts
interface ProviderMaterialization {
  id: string;
  desiredObjectRef: string;
  providerTarget: string;
  objectAddress: string;
  role: "router" | "runtime" | "resource" | "access";
  createdByOperationId: string;
}
```

`desiredObjectRef` MUST point to an immutable desired materialization payload, ResolvedGraph fragment digest, or OperationRun desired payload digest. ProviderMaterialization MUST NOT depend on mutable provider configuration by reference.

ProviderObservation is point-in-time observation.

```ts
interface ProviderObservation {
  materializationId: string;
  observedState: "present" | "missing" | "drifted" | "unknown";
  driftReason?:
    | "provider-object-missing"
    | "config-drift"
    | "status-drift"
    | "security-drift"
    | "ownership-drift"
    | "cache-drift";
  observedDigest?: string;
  observedAt: string;
}
```

Observed provider state is never canonical.

---

## 20. Rollback, restore, and repair

Rollback activates a previous compatible AppRelease and/or ActivationRecord. It does not roll back durable resource state, object-store contents, queue messages, or secret values.

Rollback MUST use retained immutable artifacts. It MUST NOT depend on rebuilding source.

DescriptorClosure is part of release interpretability. A retained AppRelease without its descriptor closure is not safely reusable.

Restore is a resource operation. Restore-to-new-instance usually implies ResourceBinding switch, new BindingSetRevision, and usually new AppRelease.

Repair is a Plan intent. Repair MUST NOT mutate canonical state invisibly. Repair may rematerialize provider state, refresh descriptor closures, restore access path mediators, recreate publication projections, rebind resources, or recover retained artifacts.

---

## 21. Required conformance invariants

Core conformant implementations MUST satisfy:

```text
DescriptorClosure is used by Apply.
Descriptor URL/content changes do not silently alter Apply.
Ambiguous aliases block Plan.
ObjectAddress is stable and used for diff/audit/idempotency.
PolicyDecisionRecord and ApprovalRecord are separate.
Publication does not imply injection.
Binding target collisions block Plan.
ResourceAccessPath is resource-only and shown in Plan when resource binding is used.
External network boundary requires RuntimeNetworkPolicy satisfaction.
ProviderMaterialization.role does not include projection and uses router for routed serving materialization.
ProviderMaterialization is separated from ProviderObservation.
ActivationRecord is immutable and satisfies assignment/primary/readiness/router-policy invariants.
GroupActivationPointer selects the current ActivationRecord.
Router/provider convergence is reported separately from activation commit.
RouterConfig and RuntimeNetworkPolicy changes create a new ActivationRecord.
Rollback does not restore durable state or secret values.
Rollback does not rebuild source.
Retained releases retain immutable artifacts and required descriptor digests.
```

---

## 22. Final sentence

```text
Core has no domain kinds.
Core defines deployment meta-objects.
Descriptors define meaning.
Plans pin descriptors.
Apply uses pinned meaning.
Bindings are explicit.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
Providers materialize; they do not define.
Provider capability descriptors MAY constrain, reject, or report limitations for contract configurations. They MUST NOT reinterpret contract semantics.
Observed provider state is never canonical.
```
