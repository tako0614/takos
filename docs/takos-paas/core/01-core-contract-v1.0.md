# Takos Deploy Core Contract v1.0

**Status:** v1.0 core contract for Deployment-centric design\
**Scope:** Core semantics only\
**Non-goal:** This document does not specify plugin loading, package managers,
descriptor registry APIs, billing, concrete JavaScript Worker / container / SQL
implementations, or concrete cloud provider APIs.

Takos Deploy is a deployment meaning system organized around three records:

```text
Deployment            — input + resolution + desired state + status
ProviderObservation   — observed provider state (separate from canonical)
GroupHead             — group-scoped pointer to the current Deployment
```

Core defines no domain kinds. Core does not define `js-worker`, `container`,
`sql`, `queue`, `mcp-server`, `file-handler`, `Cloudflare`, `Cloud Run`,
`Docker`, or `Kubernetes`. Concrete meanings are supplied by descriptors.

Takos separates **declaration**, **resolution**, and **injection**:

```text
Output         = producer-side typed value declaration
Binding        = consumer-side explicit injection request
BindingResolution = resolved policy / grant / approval / source revision
BindingSetRevision = immutable runtime binding snapshot used by AppRelease
```

Short form:

```text
Output   = 出す
Binding  = 入れる
BindingResolution = 許可・解決する
BindingSetRevision = 有効化する
```

```text
Core has no domain kinds.
Core defines Deployment / ProviderObservation / GroupHead.
Descriptors define meaning.
Deployments pin descriptors.
Apply uses pinned meaning.
Output does not imply Binding.
Binding is explicit.
Binding does not imply raw env.
BindingResolution is planned.
BindingSetRevision is immutable.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
Resource credentials are not Outputs by default.
Providers materialize; they do not define.
Observed provider state is never canonical.
```

---

## 1. Normative keywords

```text
MUST      required for Core conformance
SHOULD    strongly recommended, but relaxable with documented rationale
MAY       optional
MUST NOT  forbidden for Core conformance
```

---

## 2. Core invariants

```text
1.  Core MUST NOT assign built-in meaning to workload, resource, output, or provider names.
2.  Every concrete meaning used by Deployment.resolution MUST come from descriptor resolutions.
3.  Apply MUST use the descriptor_closure fixed in Deployment.resolution. Apply MUST NOT reinterpret descriptor URLs, aliases, or remote contexts at execution time.
4.  Output MUST NOT imply Binding. Catalog / discovery projection of an Output MUST NOT imply Binding either.
5.  Binding MUST be explicit. Binding material MUST be explicitly selected as a BindingDeclaration in Deployment.desired.bindings.
6.  BindingResolution is planned: every BindingDeclaration MUST have a corresponding BindingResolution carrying policyDecisionId, grantRef, approvalRecordId, sensitivity, and resolvedSourceRevision before runtime injection.
7.  BindingSetRevision is immutable. Output changes MUST NOT mutate existing BindingSetRevisions. An Output change creates rebind candidates or a consumer rebind Plan; Binding structure changes require a new AppRelease.
8.  Resource credentials MUST NOT be Output fields by default. A credential Output MUST be declared by an Output contract that explicitly permits credential outputs and MUST be protected by policy + grant + approval + secret-ref injection rules.
9.  Provider-assigned outputs MUST NOT be directly injectable. A `provider-output` source is reachable only through an explicit BindingDeclaration of `kind: "provider-output"`.
10. Secret / credential Outputs default to secret-ref injection. Raw env injection of a secret or credential Output requires an explicit Output contract permitting raw env, plus PolicySpec allow + approval (CredentialOutputRequiresApproval / RawCredentialInjectionDenied gate this).
11. Deployment.desired is immutable once Deployment.status is `applied`.
12. ProviderObservation is observed provider state and MUST NOT be canonical.
13. Deployment.desired.activation_envelope records a desired routed serving envelope, not proof of router/provider convergence.
14. GroupHead.current_deployment_id advancement MUST be strongly consistent.
15. Rollback MUST reuse Deployment.input.manifest_snapshot and the retained descriptor_closure of the rollback target. Rollback MUST NOT reverse migrations or restore durable resource contents.
```

These fifteen invariants are the load-bearing semantics of Core. Implementations
MAY surface additional checks but MUST NOT relax any of these.

> **Vocabulary note.** The legacy authoring nouns `publish` / `consume` are
> retained as authoring shorthand; the canonical Core vocabulary is **Output**
> (producer-side typed value), **Binding** (consumer-side explicit injection
> request), **BindingResolution** (resolved policy + grant + approval +
> revision), and **BindingSetRevision** (immutable runtime snapshot).
> `PublicationContract` is preserved as one class of Output contract, but
> Core objects are spelled `Output*` / `Binding*`.

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

Core is router-layer protocol-agnostic. Core does not define HTTP, TCP, UDP,
WebSocket, gRPC, QUIC, or any other protocol as a built-in kind. Routable
protocols and their matching, assignment, health, and materialization semantics
are descriptor-defined.

---

## 4. AppSpec, EnvSpec, and PolicySpec

A Deployment is produced from a manifest snapshot combining AppSpec, EnvSpec,
and PolicySpec inputs. The combined snapshot is recorded as
`Deployment.input.manifest_snapshot` and is the immutable input to resolution.

**AppSpec** declares application meaning (components, named contract instances,
exposures, Output declarations, component-level Binding declarations, and
application-level requirements). The legacy `publish` / `consume` authoring
keys are accepted as shorthand and expand to `outputs` / component-level
`bindings` during resolution. AppSpec MUST NOT silently encode environment
provider choices unless a descriptor explicitly marks the configuration as
application behavior.

**EnvSpec** binds application meaning to an environment (provider targets, route
/ listener / domain / transport security choices, runtime network policy,
materialization preferences, access path preferences). EnvSpec MUST NOT redefine
AppSpec meaning.

**PolicySpec** constrains and defaults behavior (allow / deny / require approval
/ defaults / limits / credential and trust policy). Policy precedence is
`deny > require-approval > allow`. Approval MUST NOT override deny unless
PolicySpec explicitly defines break-glass behavior. Policy defaults MAY
influence resolution choices captured in `Deployment.resolution.resolved_graph`.

```ts
type DeploymentInput = {
  manifest_snapshot: string; // canonical bytes / digest reference
  source_kind: "git" | "registry" | "inline" | "store" | string;
  source_ref?: string; // commit SHA, registry digest, store address
  env?: string; // selected environment label
  group?: string; // requested group (overrides manifest default)
};
```

`Deployment.input` is immutable from the moment a Deployment record is persisted
(i.e. from `status: "resolved"` onward).

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
        config: { image: ghcr.io/acme/api@sha256:abc }
      publicHttp:
        ref: interface.http@v1
        config: { port: 8080 }
      adminHttp:
        ref: interface.http@v1
        config: { port: 9090 }
```

```text
Contract ref is the type.
Contract instance name is the local instance inside the component.
The same contract ref MAY be used more than once with different instance names.
Core behavior MUST be derived from descriptor semantics, not from instance names.
```

A canonical component MUST have exactly one selected revisioned-runtime root
unless a descriptor explicitly defines a composite component. Otherwise
resolution MUST be blocked.

Authoring conveniences (`kind: container`, `kind: js-worker`,
`takos deploy image`, etc.) MUST expand to canonical component / contract
instance form before resolution finalizes, and their expansion descriptor digest
MUST be included in `Deployment.resolution.descriptor_closure`.

---

## 6. Descriptors and descriptor_closure

Descriptors define meaning. A descriptor is identified by a canonical URI and
fixed by digest. Aliases are authoring conveniences; canonical descriptor
identity is the URI; execution truth is the digest.

```ts
interface CoreDescriptorResolution {
  id: string; // canonical URI
  alias?: string;
  documentUrl?: string;
  mediaType: string;
  rawDigest: string;
  expandedDigest?: string;
  contextDigests?: string[];
  canonicalization?: { algorithm: string; version: string };
  policyDecisionId?: string; // optional reference into Deployment.policy_decisions
  resolvedAt: string;
}

interface CoreDescriptorClosure {
  resolutions: CoreDescriptorResolution[];
  dependencies?: CoreDescriptorDependency[];
  closureDigest: string; // stable digest over the sorted resolutions
  createdAt: string;
}

interface CoreDescriptorDependency {
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
    | "policy"
    | string;
}
```

If a descriptor declares an internal canonical id, it MUST match the expected id
unless PolicySpec explicitly allows aliasing.

Rules for `Deployment.resolution.descriptor_closure`:

```text
descriptor_closure MUST include every descriptor that can affect shape derivation, provider matching, binding resolution, access path selection, output resolution, policy evaluation, or operation planning.
descriptor_closure MUST include transitive descriptor dependencies.
Apply MUST use the descriptor_closure fixed in Deployment.resolution and MUST NOT fetch a new descriptor version or reinterpret remote context URLs.
```

Same major ref updates MUST be backward-compatible; breaking changes require a
new major ref. Compatibility MAY be established by descriptor compatibility
declarations, conformance tests, schema diff, author attestation, or policy
approval.

Retained Deployments MUST retain their descriptor digests for the rollback
window; otherwise they are not safely reusable for rollback (§ 15).

---

## 7. Policy decisions and approvals

Policy MUST be evaluated before irreversible or externally visible action.
Policy decisions and approvals are recorded inline on the Deployment. Policy
gates are grouped as **Resolution**, **Planning**, **Execution**, and
**Recovery**.

```ts
type DeploymentPolicyDecision = {
  id: string;
  gateGroup: "resolution" | "planning" | "execution" | "recovery" | string;
  gate:
    | "descriptor-resolution"
    | "authoring-expansion"
    | "graph-projection"
    | "provider-selection"
    | "binding-resolution"
    | "access-path-selection"
    | "operation-planning"
    | "activation-preview"
    | "apply-phase-revalidation"
    | "repair-planning"
    | "rollback-planning"
    | string;
  decision: "allow" | "deny" | "require-approval";
  ruleRef?: string;
  subjectAddress?: string;
  subjectDigest: string;
  decidedAt: string;
};

type DeploymentApproval = {
  approved_by: string;
  approved_at: string;
  policy_decision_id: string; // refers into Deployment.policy_decisions
  expires_at?: string;
};
```

Every meaningful policy decision SHOULD produce an entry in
`Deployment.policy_decisions[]`. `Deployment.approval` is optional and, when
present, satisfies a `require-approval` decision recorded there. Approval MUST
NOT convert a deny decision into allow unless explicit break-glass policy
permits it. Descriptor policy itself MUST be evaluated by a bootstrap trust
rule, not by the policy descriptor it is currently defining.

---

## 8. resolved_graph and projections {#resolved-graph}

The compiler turns AppSpec + EnvSpec + PolicySpec + descriptor_closure into a
resolved graph and stores it as `Deployment.resolution.resolved_graph`.

```ts
type ResolvedGraph = {
  digest: string; // stable digest of the canonical graph
  components: ResolvedComponent[];
  projections: GraphProjection[];
};

type GraphProjection = {
  projectionType: string; // e.g. "runtime-claim", "exposure-target"
  objectAddress: string;
  sourceComponentAddress: string;
  sourceContractInstance: string;
  descriptorResolutionId: string;
  digest: string;
};
```

The graph MAY be flat internally, but SHOULD expose deterministic projections
for controllers. Controllers SHOULD consume projections rather than reinterpret
raw descriptors. Projection families (runtime claim, resource claim, exposure
target, Output declaration, BindingDeclaration, access path request, etc.) are
compiler outputs for controller routing, not authoring kinds.

---

## 9. ObjectAddress

ObjectAddress is the stable address used for diff, audit, idempotency, repair,
binding, and ownership.

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
output:search-agent%2Fsearch
publication:search-agent%2Fsearch   (legacy alias of output:...)
deployment:dep_123
group:checkout-prod
```

Addresses are case-sensitive. Path separators inside names MUST be
percent-encoded. Renames MUST NOT be inferred by similarity; they require
`previousAddress` or explicit adoption metadata. Cross-contract rename is a
dangerous change unless an explicit migration/rebind plan exists.

---

## 10. Interface, exposure, route, router, and Output

Boundaries:

```text
Interface:           component-side reachable surface
Exposure:            app-level intent to expose a component interface
Route:               environment binding of an exposure to a listener / match / transport
Router:              materialized routing layer
Output:              producer-side typed value declaration
OutputRevision:      resolved values for an Output
OutputProjection:    discovery / catalog projection of an Output (e.g. MCP registry, FileHandler discovery, UI catalog)
```

Invariants:

```text
Interface does not know domain.
Exposure does not know provider implementation.
Route does not know artifact or runtime implementation.
Router materialization does not define application meaning.
Output does not imply Binding.
OutputProjection (catalog / discovery) does not imply Binding.
Transport protocol does not determine object type.
```

Routes are recorded in `Deployment.desired.routes`. Each route references an
exposure target whose descriptor declares `exposureEligible=true` (or
equivalent), plus a route descriptor that defines listener, matching, and
transport/security shape.

Core is protocol-agnostic. A routable interface/route descriptor MAY define
HTTP, TCP, UDP, WebSocket, gRPC, QUIC, or internal-only routing. Core MUST NOT
assume that every route is HTTP or that every serving channel supports weighted
assignment, request mirroring, header/path matching, TLS termination, connection
draining, or health probing — those are descriptor-defined and
provider-validated. If a channel descriptor does not support weighted
assignment, the Deployment MUST record a single assignment with weight 100 or
resolution MUST be blocked.

### 10.1 Output

`Output` is producer-side typed output. An Output is declared by an Output
contract (e.g. `publication.mcp-server@v1`, `publication.http-endpoint@v1`,
`publication.topic@v1`, `builtin:takos.api-key@v1`). Output contract
descriptors MUST define value type and sensitivity per output field.

```ts
interface CoreOutputDeclaration {
  address: string; // output:<group>/<name>  (legacy alias: publication:...)
  producerGroupId: string;
  contract: string; // canonical Output contract id
  source: unknown; // descriptor-defined source projection (exposure / path / lookup)
  visibility: "private" | "explicit" | "space" | "public";
  status?: "declared" | "withdrawn";
}

interface CoreOutputValue {
  valueType:
    | "string"
    | "url"
    | "json"
    | "secret-ref"
    | "service-ref"
    | "endpoint";
  sensitivity: "public" | "internal" | "secret" | "credential";
  value?: unknown;
  secretRef?: string;
}

interface CoreOutputRevision {
  outputAddress: string;
  revisionId: string;
  activationRecordId?: string;
  resolverDescriptorId?: string;
  inputDigests: string[];
  values: Record<string, CoreOutputValue>;
  status: "ready" | "unavailable" | "withdrawn";
  digest: string;
  createdAt: string;
}
```

Output change semantics:

```text
A change in Output declaration produces a new OutputRevision.
A new OutputRevision MUST NOT mutate an existing BindingSetRevision.
Affected BindingDeclarations become rebind candidates.
If policy permits automatic rebind, a new BindingSetRevision is produced and a new AppRelease may be generated.
Otherwise a consumer rebind Plan is produced and existing runtime bindings remain unchanged until the new AppRelease activates.
```

Output withdrawal semantics:

```text
OutputRevision.status="withdrawn" blocks new BindingDeclarations against the Output.
Existing BindingResolutions targeting the withdrawn revision become status="withdrawn" or "stale".
The runtime binding is NOT silently deleted. Consumers MUST remove, rebind, or accept a degraded state, surfaced as OutputWithdrawn / BindingSourceWithdrawn conditions.
```

`PublicationContract` is preserved as **one class of Output contract**.
`publication.<...>@v<n>` descriptor IDs continue to identify Output contracts;
the Core noun is `Output`.

### 10.2 OutputProjection (discovery / catalog)

MCP registry entries, FileHandler discovery, and UI catalog views are
**projections of Output**, not Bindings. Catalog visibility is metadata only:

```text
Visible in catalog != linked / authorized != injected into runtime.
```

Projection failures surface as `OutputProjectionFailed` /
`RepairOutputProjectionRequired` conditions; they MUST NOT be interpreted as
binding failures.

---

## 11. Bindings

Bindings are explicit. Three Core records describe a binding lifecycle:

```text
BindingDeclaration   — consumer-side explicit injection request (declared shape)
BindingResolution    — resolved policy + grant + approval + revision (planned)
BindingSetRevision   — immutable per-component snapshot consumed by AppRelease
```

`BindingValueResolution` remains for value-level resolution (secret version
selection, etc.) and is captured per-value inside a BindingSetRevision:

```text
BindingSetRevision      = binding structure snapshot
BindingValueResolution  = actual resolved value / version snapshot
```

AccessMode (what is obtained from the source) and InjectionMode (how it is
delivered to the component) are different. Canonical access modes are
contract-scoped:

```yaml
access:
  contract: resource.sql.postgres@v1
  mode: database-url
```

Authoring shorthand MAY omit the contract only when the source is unambiguous;
ambiguous shorthand MUST block resolution.

### 11.1 BindingDeclaration

```ts
interface CoreBindingDeclaration {
  // app.binding:<component>/<bindingName>
  address: string;
  componentAddress: string;
  bindingName: string;
  source:
    | {
      kind: "resource";
      resource: string; // ObjectAddress of a ResourceClaim / ResourceInstance
      access: { contract: string; mode: string };
    }
    | {
      kind: "output";
      output: string; // ObjectAddress of an OutputDeclaration
      field: string;
    }
    | {
      kind: "secret";
      secret: string;
    }
    | {
      kind: "provider-output";
      materialization: string; // ObjectAddress of a provider materialization
      field: string;
    };
  inject: {
    mode:
      | "env"
      | "secret-ref"
      | "runtime-binding"
      | "service-binding"
      | "mount"
      | "internal-url";
    target: string;
  };
}
```

Authoring example (consumer side):

```yaml
components:
  web:
    contracts:
      runtime: { ref: runtime.js-worker@v1 }
      artifact: { ref: artifact.js-module@v1 }
      http: { ref: interface.http@v1 }
    bindings:
      SEARCH_MCP_URL:
        from:
          output: output:search-agent/search
          field: url
        inject:
          mode: env
          target: SEARCH_MCP_URL
```

Resource binding remains a separate source kind — resource credentials are
**not** Outputs by default:

```yaml
resources:
  db:
    contract: resource.sql.postgres@v1
components:
  api:
    bindings:
      DATABASE_URL:
        from:
          resource: db
          access:
            contract: resource.sql.postgres@v1
            mode: database-url
        inject:
          mode: env
          target: DATABASE_URL
```

Built-in credential Outputs MUST default to `secret-ref` injection. Raw env
injection of a credential field requires explicit Output-contract permission
plus `CredentialOutputRequiresApproval` policy approval; otherwise resolution
MUST emit `RawCredentialInjectionDenied`:

```yaml
components:
  web:
    bindings:
      TAKOS_API_ENDPOINT:
        from: { output: builtin:takos.api-key@v1, field: endpoint }
        inject: { mode: env, target: TAKOS_API_ENDPOINT }
      TAKOS_API_KEY:
        from: { output: builtin:takos.api-key@v1, field: apiKey }
        inject: { mode: secret-ref, target: TAKOS_API_KEY }
```

### 11.2 BindingResolution

Plan / Apply produce one BindingResolution for each BindingDeclaration. The
resolution carries everything needed for runtime injection to be authorized:

```ts
interface CoreBindingResolution {
  bindingDeclarationAddress: string;
  // OutputRevision id, ResourceAccessPath id, secret version, or provider
  // materialization id depending on source.kind.
  resolvedSourceRevision?: string;
  policyDecisionId: string;
  approvalRecordId?: string;
  grantRef?: string;
  sensitivity: "public" | "internal" | "secret" | "credential";
  status: "ready" | "blocked" | "stale" | "withdrawn" | "unavailable";
  blockers?: string[];
  warnings?: string[];
  digest: string;
}
```

Binding material MUST pass: source contract permits access; provider supports
access; Output / source descriptor permits injection at the requested mode;
runtime / provider support the injection mode; policy permits the resulting
sensitivity; grant exists; no injection target collision. Binding target
collisions MUST block resolution unless the runtime descriptor explicitly
supports ordered merge and every binding declares precedence.

A BindingResolution against a withdrawn or unavailable source MUST surface
`BindingSourceWithdrawn` / `BindingSourceUnavailable` and MUST NOT silently
delete the existing runtime binding. Required consumer action is recorded as
`BindingRebindRequired`.

Core default allowed resolution policies are `latest-at-activation` and
`pinned-version`. `latest-at-invocation` MAY be used only if the runtime
contract and PolicySpec explicitly permit it. If a referenced
secret / credential version is revoked, the implementation MUST surface
`SecretVersionRevoked` / `SecretResolutionFailed` on the Deployment and MUST
plan repair or re-resolution explicitly through a new Deployment.

### 11.3 BindingSetRevision

```ts
interface CoreBindingSetRevision {
  id: string;
  componentAddress: string;
  structureDigest: string;
  bindingDeclarations: CoreBindingDeclaration[];
  bindingResolutions: CoreBindingResolution[];
  bindingValueResolutions?: CoreBindingValueResolution[];
  digest: string;
}
```

BindingSetRevision is **immutable** once produced. Output changes MUST NOT
mutate existing BindingSetRevisions; instead a new BindingSetRevision is
produced for a rebind plan. Changing binding structure (target, source,
access, injection) requires a new AppRelease — i.e. a new Deployment.

### 11.4 Legacy `DeploymentBinding` form

For source-level compatibility, `Deployment.desired.bindings` continues to
record the structural binding shape. The `source` enum accepts `"output"` as
the canonical value and `"publication"` as a retained legacy alias:

```ts
type DeploymentBinding = {
  bindingName: string;
  componentAddress: string;
  source: "resource" | "output" | "publication" | "secret" | "provider-output";
  sourceAddress: string;
  access?: { contract: string; mode: string };
  injection: { mode: string; target: string };
  sensitivity: "public" | "internal" | "secret" | "credential";
  enforcement: "enforced" | "advisory" | "unsupported";
  resolutionPolicy:
    | "latest-at-activation"
    | "pinned-version"
    | "latest-at-invocation";
  resolvedVersion?: string;
  resolvedAt?: string;
  grantRef?: string;
};
```

`Deployment.desired.bindings` is the immutable structural snapshot of
BindingDeclarations for the Deployment; per-component BindingResolutions and
BindingSetRevisions are produced during planning and pinned into the
generated AppRelease.

### 11.5 Conformance assertions

Conformant implementations MUST exercise:

```text
- Output does not imply Binding.
- OutputProjection (catalog / discovery) does not imply Binding.
- A new field added to an OutputRevision MUST NOT be injected into an existing
  BindingSetRevision; injection requires a new BindingDeclaration in a new
  AppRelease.
- An OutputRevision change creates a rebind candidate or a rebind Plan; it
  never mutates a BindingSetRevision in place.
- A withdrawn OutputRevision stalls dependent BindingResolutions
  (status=withdrawn|stale, blockers reference OutputWithdrawn /
  BindingSourceWithdrawn) but MUST NOT silently delete the existing runtime
  binding.
- Secret / credential Output fields default to secret-ref injection. Raw env
  injection requires an explicit Output-contract permission and PolicySpec
  approval; absent either, resolution emits CredentialOutputRequiresApproval
  or RawCredentialInjectionDenied.
- A resource credential MUST NOT be exported as an Output unless the
  descriptor explicitly allows credential output AND policy approves it.
```

Condition reason catalog updates (additions):

```text
OutputWithdrawn
OutputUnavailable
OutputResolutionFailed
OutputProjectionFailed
BindingRebindRequired
BindingSourceWithdrawn
BindingSourceUnavailable
CredentialOutputRequiresApproval
RawCredentialInjectionDenied
```

The legacy `Publication*` reasons (`PublicationWithdrawn`,
`PublicationUnavailable`, `PublicationResolutionFailed`,
`PublicationProjectionFailed`, `PublicationConsumerRebindRequired`,
`PublicationConsumerGrantMissing`, `PublicationOutputInjectionDenied`,
`PublicationRouteUnavailable`, `PublicationAuthUnavailable`) remain in the
catalog as aliases for source-level compatibility but new code MUST emit the
`Output*` / `Binding*` / `Credential*` forms above.

---

## 12. Resources and ResourceInstance

`ResourceInstance` and `MigrationLedger` are the only records outside Deployment
/ ProviderObservation / GroupHead that Core retains as independent records. They
carry durable state across Deployments.

```ts
type ResourceInstance = {
  id: string; // resource.instance:<id>
  contract: string;
  groupOwner?: string;
  status: "preparing" | "ready" | "retired" | "failed";
  createdAt: string;
};
```

Resource access is selected by: resource contract, consumer shape, requested
AccessMode / InjectionMode, provider support, policy, grant, and selected access
path. Access paths are recorded inline through
`Deployment.desired.bindings[*].access` / `.injection`, plus the supplementary
access path record below.

```ts
interface CoreResourceAccessPath {
  bindingName: string;
  componentAddress: string;
  access: { contract: string; mode: string };
  injection: { mode: string; target: string };
  stages: CoreAccessPathStage[];
  networkBoundary: "internal" | "provider-internal" | "external";
  enforcement: "enforced" | "advisory" | "unsupported";
  limitations?: string[];
}

interface CoreAccessPathStage {
  kind: string;
  role?: "access-mediator" | "resource-host" | "credential-source";
  providerTarget?: string;
  owner?: "takos" | "provider" | "operator";
  lifecycle?: "per-component" | "per-resource" | "shared";
  readiness?: "required" | "optional";
  credentialBoundary?: "none" | "provider-credential" | "resource-credential";
  credentialVisibility?:
    | "consumer-runtime"
    | "mediator-only"
    | "provider-only"
    | "control-plane-only"
    | "none";
}
```

If multiple valid access paths exist, selection order is:

```text
1. explicit EnvSpec selection
2. explicit PolicySpec selection or preference
3. strongest enforcement level
4. lowest credential visibility / sensitivity exposure
5. provider priority / cost / locality rule
6. otherwise resolution blocked with alternatives
```

External-boundary access paths MUST also satisfy
`Deployment.desired.runtime_network_policy`. Migrations recorded in
`MigrationLedger` are not reversed by rollback (§ 15).

### 12.1 Resource and Output separation (hard invariant)

```text
Resource sharing uses ResourceBinding / ResourceAccessPath.
Typed output sharing uses OutputDeclaration / OutputRevision / BindingDeclaration.
Resource credentials are NOT Output fields by default.
```

A credential Output MAY exist only if its Output contract explicitly permits
credential output AND PolicySpec approves it. Such Outputs MUST default to
`secret-ref` injection and MUST be backed by `OutputValue.secretRef`.

`ImportDeclaration` and `ExportLink` are NOT Core objects. Authoring
conveniences MAY surface import-style sugar, but Core records only
OutputDeclaration / OutputRevision / BindingDeclaration / BindingResolution /
BindingSetRevision. Permission, compatibility, and resolution responsibilities
formerly attributed to a separate "Link" object are folded into
BindingResolution (`policyDecisionId`, `approvalRecordId`, `grantRef`,
`resolvedSourceRevision`, `status`).

---

## 13. Deployment record

`Deployment` is the central record of Core. Every other concept is either an
input to a Deployment, a field of a Deployment, or a separate observation /
pointer that references a Deployment.

```ts
type Deployment = {
  id: string;
  group_id: string;
  space_id: string;
  input: DeploymentInput;
  resolution: {
    descriptor_closure: CoreDescriptorClosure;
    resolved_graph: ResolvedGraph;
  };
  desired: {
    routes: DeploymentRoute[];
    bindings: DeploymentBinding[];
    resources: DeploymentResourceClaim[];
    runtime_network_policy: DeploymentRuntimeNetworkPolicy;
    activation_envelope: DeploymentActivationEnvelope;
  };
  status:
    | "preview"
    | "resolved"
    | "applying"
    | "applied"
    | "failed"
    | "rolled-back";
  conditions: DeploymentCondition[];
  policy_decisions?: DeploymentPolicyDecision[];
  approval?: DeploymentApproval;
  rollback_target?: string | null;
  created_at: string;
  applied_at?: string;
  finalized_at?: string;
};

type DeploymentRoute = {
  id: string;
  exposureAddress: string;
  routeDescriptorId: string;
  match: Record<string, unknown>;
  transport?: { security?: string; tls?: Record<string, unknown> };
};

type DeploymentResourceClaim = {
  claimAddress: string;
  contract: string;
  bindingNames: string[];
  resourceInstanceId?: string;
};

type DeploymentRuntimeNetworkPolicy = {
  policyDigest: string;
  defaultEgress: "allow" | "deny" | "deny-by-default";
  egressRules?: DeploymentEgressRule[];
  serviceIdentity?: Record<string, unknown>;
};

type DeploymentActivationEnvelope = {
  primary_assignment: { componentAddress: string; weight: number };
  assignments?: {
    componentAddress: string;
    weight: number;
    labels?: Record<string, string>;
  }[];
  route_assignments?: {
    routeId: string;
    protocol?: string;
    assignments: { componentAddress: string; weightPermille: number }[];
  }[];
  rollout_strategy?: {
    kind: "immediate" | "blue-green" | "canary" | string;
    steps?: unknown[];
  };
  non_routed_defaults?: {
    events?: { componentAddress: string; reason?: string };
    outputs?: { componentAddress: string; reason?: string };
    // legacy alias for `outputs`
    publications?: { componentAddress: string; reason?: string };
  };
  envelopeDigest: string;
};

type DeploymentCondition = {
  type: string; // e.g. "DescriptorPinned", "ProviderMaterializing"
  status: "true" | "false" | "unknown";
  reason?: string;
  message?: string;
  observed_generation: number;
  last_transition_time: string;
  scope?: { kind: "operation" | "phase" | "deployment"; ref?: string };
};
```

### State machine

```text
preview                   in-memory only, no DB record
  -> resolved             record persisted, descriptor_closure pinned
  -> applying             provider operations in-flight
  -> applied              GroupHead advanced
  -> rolled-back          GroupHead points back to a previous Deployment
                          (no new Deployment is created for rollback itself)

any state -> failed       terminal failure; conditions[] explain why
```

Transition rules:

```text
preview -> resolved:
  Persist Deployment with full input, resolution, desired, and any resolution-gate policy_decisions[].

resolved -> applying:
  Begin provider operations. Each operation contributes a DeploymentCondition entry with scope.kind="operation".
  Phase boundaries contribute scope.kind="phase" conditions.

applying -> applied:
  All required operations succeeded. applied_at set. GroupHead advanced (§ 15).

applying / resolved -> failed:
  At least one required operation or policy gate failed. conditions[] explain. No GroupHead advancement.

applied -> rolled-back:
  Triggered via § 15. Reflected by GroupHead motion; the rollback_target Deployment becomes current.
```

`Deployment.desired` is immutable once `Deployment.status` is `applied`. While
`applying`, only operation status reflected in `conditions[]` MAY change.

Apply executes operations against the desired state with idempotent operation
keys. Default key:
`deploymentId + operationKind + objectAddress +
desiredDigest`. Operation kinds
are stable strings such as `descriptor.resolve`, `component.project`,
`resource.bind`, `resource.migrate`, `resource.restore`, `binding.create`,
`binding.resolve`, `binding.rebind`, `runtime.deploy`, `router.prepare`,
`output.resolve`, `output.rebind`, `output.project`,
`access-path.materialize`, `activation.commit`, `provider.materialize`,
`provider.observe`, `repair.plan`. The legacy `publication.resolve` /
`publication.rebind` operation kinds are retained as aliases of
`output.resolve` / `output.rebind` for source-level compatibility but new
implementations MUST emit the `output.*` form. Operation-level state lives
entirely in `Deployment.conditions[]` with `scope.kind="operation"`. Provider
materialization failure MUST NOT mutate `Deployment.desired`; repair or rollback
creates a new Deployment.

Activation preview MUST verify: exposure target exists and is exposureEligible;
InterfaceDescriptor is compatible with RouteDescriptor; router
provider/materialization supports required protocol/listener semantics;
assignment semantics are supported or blocked; health/probe model is declared or
explicitly unknown; transport/security policy is supported;
runtime_network_policy covers every assigned component and primary/candidate
selector used. For non-routed groups, `desired.routes` MAY be empty and the
activation envelope SHOULD record a single assignment with weight 100 for the
primary component.

Serving status uses condition types `ActivationCommitted`,
`ServingMaterializing`, `ServingConverged`, `ServingDegraded`.
`ServingConverged` MUST require ProviderObservation evidence (§ 14) for the
materializations required by the current routes, runtime network policy, and
activation envelope. For non-HTTP protocols, the descriptor or provider profile
MUST define what observation is sufficient; protocols without observable health
MAY remain `unknown`.

---

## 14. ProviderObservation {#provider-observation}

ProviderObservation is a separate, append-only stream of observations against
provider state. It is never canonical. The canonical desired state is
`Deployment.desired`.

```ts
type ProviderObservation = {
  id: string;
  deployment_id: string; // the Deployment whose desired state was observed against
  provider_id: string;
  object_address: string;
  observed_state: "present" | "missing" | "drifted" | "unknown";
  drift_status?:
    | "provider-object-missing"
    | "config-drift"
    | "status-drift"
    | "security-drift"
    | "ownership-drift"
    | "cache-drift";
  observed_digest?: string;
  observed_at: string;
};
```

```text
ProviderObservation MUST NOT mutate Deployment.desired.
ProviderObservation MAY trigger a new Deployment (e.g. repair) but MUST NOT replace fields of an existing one.
ProviderObservation digests reference desired digests recorded in Deployment.resolution / desired; mismatches surface as drift_status="config-drift" or "status-drift".
ProviderObservation visibility against retired Deployments is permitted; a retired Deployment does not invalidate prior observations.
```

---

## 15. GroupHead and rollback

`GroupHead` is the strongly consistent pointer that selects the current
Deployment for a group.

```ts
type GroupHead = {
  group_id: string;
  current_deployment_id: string;
  previous_deployment_id?: string | null;
  generation: number;
  advanced_at: string;
};
```

```text
GroupHead.current_deployment_id MUST advance atomically (invariant 11).
A GroupHead MUST NOT point to a Deployment whose status is not in {applied, rolled-back}.
GroupHead.previous_deployment_id MUST point to a Deployment whose desired state, descriptor_closure, and manifest_snapshot remain retained for the rollback window.
Advancing GroupHead is the canonical activation commit. ActivationCommitted is recorded as a Deployment condition on the new current Deployment.
```

### Rollback

Rollback is a pointer move, not a new Deployment. Given a GroupHead `H`:

```text
1. Select target_deployment_id = H.previous_deployment_id (default) or an explicit retained Deployment id.
2. Validate target Deployment is retained (manifest_snapshot, descriptor_closure, desired).
3. Atomically swap: H.current_deployment_id <- target_deployment_id; H.previous_deployment_id <- prior current; generation += 1.
4. Mark the previously current Deployment as rolled-back via a status transition. No new Deployment is created.
```

Rollback MUST reuse retained `Deployment.input.manifest_snapshot` and the
retained `descriptor_closure`. Rollback MUST NOT reverse migrations or restore
durable resource contents (invariant 12). Restore-to-new-instance is a resource
operation that requires a new Deployment with updated bindings.

Repair is expressed as a new Deployment whose `rollback_target` MAY reference a
prior healthy Deployment. Repair MUST NOT mutate canonical state of any existing
Deployment.

---

## 16. CLI surface

Core defines the contract; the canonical CLI surface that exercises it is:

```text
takos deploy <manifest>           default: resolve + apply (Heroku-like sugar)
takos deploy --preview            in-memory preview, no DB record
takos deploy --resolve-only       create resolved Deployment, do not apply
takos apply <deployment-id>       advance a resolved Deployment to applied
takos diff <deployment-id>        show resolved expansion + diff vs current GroupHead
takos approve <deployment-id>     attach an approval to a resolved Deployment
takos rollback [<group>]          flip GroupHead to previous_deployment_id
```

The default `takos deploy <manifest>` MUST be equivalent to:

```text
1. POST /api/public/v1/deployments with mode="resolve"  -> deployment_id
2. POST /api/public/v1/deployments/:id/apply
```

When PolicySpec records a `require-approval` decision in
`Deployment.policy_decisions[]`, `takos apply` MUST refuse until
`Deployment.approval` is attached or PolicySpec break-glass is permitted.

---

## 17. API surface

A single endpoint family covers the lifecycle, all under public v1.

```text
POST /api/public/v1/deployments
  body:     { manifest, mode: "preview"|"resolve"|"apply"|"rollback", target_id?, group?, env? }
  response: { deployment_id, status, conditions, expansion_summary }

GET  /api/public/v1/deployments/:id
GET  /api/public/v1/deployments?group=&status=
GET  /api/public/v1/groups/:group_id/head

POST /api/public/v1/deployments/:id/apply
POST /api/public/v1/deployments/:id/approve
POST /api/public/v1/groups/:group_id/rollback

GET  /api/public/v1/deployments/:id/observations
```

Mode behavior:

```text
mode="preview":   synchronous resolution against in-memory state. No record persisted. deployment_id="preview:<digest>".
mode="resolve":   persist a Deployment with status="resolved". descriptor_closure pinned.
mode="apply":     resolve (if no target_id) and apply in one call.
mode="rollback":  operate on group + optional target_id. Atomically flips GroupHead.

apply / approve / rollback endpoints are idempotent with respect to deployment_id and group_id.
```

The removed public paths (`/api/public/v1/deploy/plans`,
`/api/public/v1/deploy/applies`,
`/api/public/v1/spaces/:spaceId/group-deployment-snapshots/*`,
`/api/deploy/plans`, `/api/deploy/apply-runs`) are not part of the current
surface and MUST NOT be reintroduced.

---

```text
Core has no domain kinds.
Core defines Deployment / ProviderObservation / GroupHead.
Descriptors define meaning.
Deployments pin descriptors.
Apply uses pinned meaning.
Output is a producer-side typed value declaration.
Binding is a consumer-side explicit injection request.
BindingResolution records policy / grant / approval / compatibility / source revision.
BindingSetRevision is the immutable runtime binding snapshot used by AppRelease.
Output does not imply Binding. Binding does not imply raw env.
Resource credentials are not Outputs by default.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
Providers materialize; they do not define.
Observed provider state is never canonical.
```
