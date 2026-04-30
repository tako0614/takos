# Takos Deploy v3 Core Contract v1.0

**Status:** v1.0 core contract for Deployment-centric design\
**Scope:** Core semantics only\
**Non-goal:** This document does not specify plugin loading, package managers,
descriptor registry APIs, billing, concrete JavaScript Worker / container / SQL
implementations, or concrete cloud provider APIs.

Takos Deploy v3 is a deployment meaning system organized around three records:

```text
Deployment            — input + resolution + desired state + status
ProviderObservation   — observed provider state (separate from canonical)
GroupHead             — group-scoped pointer to the current Deployment
```

All other meta-records that previous Core revisions tracked separately are
collapsed into a field of `Deployment`, or onto one of the other two records.
See § 18 for the full v2 → v3 mapping.

Core defines no domain kinds. Core does not define `js-worker`, `container`,
`sql`, `queue`, `mcp-server`, `file-handler`, `Cloudflare`, `Cloud Run`,
`Docker`, or `Kubernetes`. Concrete meanings are supplied by descriptors.

```text
Core has no domain kinds.
Core defines Deployment / ProviderObservation / GroupHead.
Descriptors define meaning.
Deployments pin descriptors.
Apply uses pinned meaning.
Bindings are explicit.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
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
1.  Core MUST NOT assign built-in meaning to workload, resource, publication, or provider names.
2.  Every concrete meaning used by Deployment.resolution MUST come from descriptor resolutions.
3.  Apply MUST use the descriptor_closure fixed in Deployment.resolution. Apply MUST NOT reinterpret descriptor URLs, aliases, or remote contexts at execution time.
4.  Publication MUST NOT imply injection.
5.  Resource credentials MUST NOT be publication outputs by default.
6.  Provider-assigned outputs MUST NOT be directly injectable.
7.  Binding material MUST be explicitly selected in Deployment.desired.bindings.
8.  Deployment.desired is immutable once Deployment.status is `applied`.
9.  ProviderObservation is observed provider state and MUST NOT be canonical.
10. Deployment.desired.activation_envelope records a desired routed serving envelope, not proof of router/provider convergence.
11. GroupHead.current_deployment_id advancement MUST be strongly consistent.
12. Rollback MUST reuse Deployment.input.manifest_snapshot and the retained descriptor_closure of the rollback target. Rollback MUST NOT reverse migrations or restore durable resource contents.
```

These twelve invariants are the load-bearing semantics of Core.
Implementations MAY surface additional checks but MUST NOT relax any of these.

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
protocols and their matching, assignment, health, and materialization
semantics are descriptor-defined.

---

## 4. AppSpec, EnvSpec, and PolicySpec

A Deployment is produced from a manifest snapshot combining AppSpec, EnvSpec,
and PolicySpec inputs. The combined snapshot is recorded as
`Deployment.input.manifest_snapshot` and is the immutable input to resolution.

**AppSpec** declares application meaning (components, named contract instances,
exposures, consume / publication declarations, application-level requirements).
AppSpec MUST NOT silently encode environment provider choices unless a
descriptor explicitly marks the configuration as application behavior.

**EnvSpec** binds application meaning to an environment (provider targets,
route / listener / domain / transport security choices, runtime network policy,
materialization preferences, access path preferences). EnvSpec MUST NOT
redefine AppSpec meaning.

**PolicySpec** constrains and defaults behavior (allow / deny / require
approval / defaults / limits / credential and trust policy). Policy precedence
is `deny > require-approval > allow`. Approval MUST NOT override deny unless
PolicySpec explicitly defines break-glass behavior. Policy defaults MAY
influence resolution choices captured in `Deployment.resolution.resolved_graph`.

```ts
type DeploymentInput = {
  manifest_snapshot: string;     // canonical bytes / digest reference
  source_kind: "git" | "registry" | "inline" | "store" | string;
  source_ref?: string;           // commit SHA, registry digest, store address
  env?: string;                  // selected environment label
  group?: string;                // requested group (overrides manifest default)
};
```

`Deployment.input` is immutable from the moment a Deployment record is
persisted (i.e. from `status: "resolved"` onward).

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
instance form before resolution finalizes, and their expansion descriptor
digest MUST be included in `Deployment.resolution.descriptor_closure`.

---

## 6. Descriptors and descriptor_closure

Descriptors define meaning. A descriptor is identified by a canonical URI and
fixed by digest. Aliases are authoring conveniences; canonical descriptor
identity is the URI; execution truth is the digest.

```ts
interface CoreDescriptorResolution {
  id: string;                   // canonical URI
  alias?: string; documentUrl?: string;
  mediaType: string; rawDigest: string;
  expandedDigest?: string; contextDigests?: string[];
  canonicalization?: { algorithm: string; version: string };
  policyDecisionId?: string;    // optional reference into Deployment.policy_decisions
  resolvedAt: string;
}

interface CoreDescriptorClosure {
  resolutions: CoreDescriptorResolution[];
  dependencies?: CoreDescriptorDependency[];
  closureDigest: string;        // stable digest over the sorted resolutions
  createdAt: string;
}

interface CoreDescriptorDependency {
  fromDescriptorId: string; toDescriptorId: string;
  reason:
    | "jsonld-context" | "schema" | "compatibility-rule" | "permission-scope"
    | "resolver" | "shape-derivation" | "access-mode" | "policy" | string;
}
```

If a descriptor declares an internal canonical id, it MUST match the expected
id unless PolicySpec explicitly allows aliasing.

Rules for `Deployment.resolution.descriptor_closure`:

```text
descriptor_closure MUST include every descriptor that can affect shape derivation, provider matching, binding resolution, access path selection, publication resolution, policy evaluation, or operation planning.
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
    | "descriptor-resolution" | "authoring-expansion" | "graph-projection"
    | "provider-selection" | "binding-resolution" | "access-path-selection"
    | "operation-planning" | "activation-preview" | "apply-phase-revalidation"
    | "repair-planning" | "rollback-planning" | string;
  decision: "allow" | "deny" | "require-approval";
  ruleRef?: string; subjectAddress?: string; subjectDigest: string;
  decidedAt: string;
};

type DeploymentApproval = {
  approved_by: string; approved_at: string;
  policy_decision_id: string;   // refers into Deployment.policy_decisions
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
  digest: string;                // stable digest of the canonical graph
  components: ResolvedComponent[];
  projections: GraphProjection[];
};

type GraphProjection = {
  projectionType: string;        // e.g. "runtime-claim", "exposure-target"
  objectAddress: string; sourceComponentAddress: string;
  sourceContractInstance: string; descriptorResolutionId: string;
  digest: string;
};
```

The graph MAY be flat internally, but SHOULD expose deterministic projections
for controllers. Controllers SHOULD consume projections rather than
reinterpret raw descriptors. Projection families (runtime claim, resource
claim, exposure target, publication declaration, binding request, access path
request, etc.) are compiler outputs for controller routing, not authoring
kinds.

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
publication:search-agent%2Fsearch
deployment:dep_123
group:checkout-prod
```

Addresses are case-sensitive. Path separators inside names MUST be
percent-encoded. Renames MUST NOT be inferred by similarity; they require
`previousAddress` or explicit adoption metadata. Cross-contract rename is a
dangerous change unless an explicit migration/rebind plan exists.

---

## 10. Interface, exposure, route, router, and publication

Boundaries:

```text
Interface:    component-side reachable surface
Exposure:     app-level intent to expose a component interface
Route:        environment binding of an exposure to a listener / match / transport
Router:       materialized routing layer
Publication:  typed output that says what an endpoint or value means
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

Routes are recorded in `Deployment.desired.routes`. Each route references an
exposure target whose descriptor declares `exposureEligible=true` (or
equivalent), plus a route descriptor that defines listener, matching, and
transport/security shape.

Core is protocol-agnostic. A routable interface/route descriptor MAY define
HTTP, TCP, UDP, WebSocket, gRPC, QUIC, or internal-only routing. Core MUST NOT
assume that every route is HTTP or that every serving channel supports
weighted assignment, request mirroring, header/path matching, TLS termination,
connection draining, or health probing — those are descriptor-defined and
provider-validated. If a channel descriptor does not support weighted
assignment, the Deployment MUST record a single assignment with weight 100 or
resolution MUST be blocked.

Publication is typed output. Publication output descriptors MUST define value
type and sensitivity. A change in publication resolution MUST NOT mutate
existing consumer bindings; it creates a rebind candidate requiring a new
Deployment with updated `desired.bindings`.

---

## 11. Bindings

Bindings are recorded in `Deployment.desired.bindings` — a structural,
immutable shape tying consumer targets to typed sources.

AccessMode (what is obtained from the source) and InjectionMode (how it is
delivered to the component) are different. Canonical access modes are
contract-scoped:

```yaml
access:
  contract: resource.sql.postgres@v1
  mode: database-url
```

Authoring shorthand MAY omit the contract only when the source is
unambiguous; ambiguous shorthand MUST block resolution.

```ts
type DeploymentBinding = {
  bindingName: string; componentAddress: string;
  source: "resource" | "publication" | "secret" | "provider-output";
  sourceAddress: string;
  access?: { contract: string; mode: string };
  injection: { mode: string; target: string };
  sensitivity: "public" | "internal" | "secret" | "credential";
  enforcement: "enforced" | "advisory" | "unsupported";
  resolutionPolicy: "latest-at-activation" | "pinned-version" | "latest-at-invocation";
  resolvedVersion?: string; resolvedAt?: string; grantRef?: string;
};
```

Binding material MUST pass: source contract permits access; provider supports
access; output descriptor permits injection; runtime / provider support
injection; policy permits sensitivity and injection; grant exists; no
injection target collision. Binding target collisions MUST block resolution
unless the runtime descriptor explicitly supports ordered merge and every
binding declares precedence.

Core default allowed resolution policies are `latest-at-activation` and
`pinned-version`. `latest-at-invocation` MAY be used only if the runtime
contract and PolicySpec explicitly permit it.

If a referenced secret/credential version is revoked, the implementation MUST
surface a condition (e.g. `SecretVersionRevoked`, `SecretResolutionFailed`) on
the Deployment and MUST plan repair or re-resolution explicitly through a new
Deployment. Changing binding structure (target, source, access, injection)
requires a new Deployment.

---

## 12. Resources and ResourceInstance

`ResourceInstance` and `MigrationLedger` are the only records outside
Deployment / ProviderObservation / GroupHead that Core retains as independent
records. They carry durable state across Deployments.

```ts
type ResourceInstance = {
  id: string;                   // resource.instance:<id>
  contract: string; groupOwner?: string;
  status: "preparing" | "ready" | "retired" | "failed";
  createdAt: string;
};
```

Resource access is selected by: resource contract, consumer shape, requested
AccessMode / InjectionMode, provider support, policy, grant, and selected
access path. Access paths are recorded inline through
`Deployment.desired.bindings[*].access` / `.injection`, plus the supplementary
access path record below.

```ts
interface CoreResourceAccessPath {
  bindingName: string; componentAddress: string;
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
    | "consumer-runtime" | "mediator-only" | "provider-only"
    | "control-plane-only" | "none";
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

---

## 13. Deployment record

`Deployment` is the central record of Core. Every other concept is either an
input to a Deployment, a field of a Deployment, or a separate observation /
pointer that references a Deployment.

```ts
type Deployment = {
  id: string; group_id: string; space_id: string;
  input: DeploymentInput;
  resolution: { descriptor_closure: CoreDescriptorClosure; resolved_graph: ResolvedGraph };
  desired: {
    routes: DeploymentRoute[];
    bindings: DeploymentBinding[];
    resources: DeploymentResourceClaim[];
    runtime_network_policy: DeploymentRuntimeNetworkPolicy;
    activation_envelope: DeploymentActivationEnvelope;
  };
  status: "preview" | "resolved" | "applying" | "applied" | "failed" | "rolled-back";
  conditions: DeploymentCondition[];
  policy_decisions?: DeploymentPolicyDecision[];
  approval?: DeploymentApproval;
  rollback_target?: string | null;
  created_at: string; applied_at?: string; finalized_at?: string;
};

type DeploymentRoute = {
  id: string; exposureAddress: string; routeDescriptorId: string;
  match: Record<string, unknown>;
  transport?: { security?: string; tls?: Record<string, unknown> };
};

type DeploymentResourceClaim = {
  claimAddress: string; contract: string;
  bindingNames: string[]; resourceInstanceId?: string;
};

type DeploymentRuntimeNetworkPolicy = {
  policyDigest: string;
  defaultEgress: "allow" | "deny" | "deny-by-default";
  egressRules?: DeploymentEgressRule[];
  serviceIdentity?: Record<string, unknown>;
};

type DeploymentActivationEnvelope = {
  primary_assignment: { componentAddress: string; weight: number };
  assignments?: { componentAddress: string; weight: number; labels?: Record<string, string> }[];
  route_assignments?: {
    routeId: string; protocol?: string;
    assignments: { componentAddress: string; weightPermille: number }[];
  }[];
  rollout_strategy?: { kind: "immediate" | "blue-green" | "canary" | string; steps?: unknown[] };
  non_routed_defaults?: {
    events?: { componentAddress: string; reason?: string };
    publications?: { componentAddress: string; reason?: string };
  };
  envelopeDigest: string;
};

type DeploymentCondition = {
  type: string;                  // e.g. "DescriptorPinned", "ProviderMaterializing"
  status: "true" | "false" | "unknown";
  reason?: string; message?: string;
  observed_generation: number; last_transition_time: string;
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
keys. Default key: `deploymentId + operationKind + objectAddress +
desiredDigest`. Operation kinds are stable strings such as
`descriptor.resolve`, `component.project`, `resource.bind`,
`resource.migrate`, `resource.restore`, `binding.create`, `runtime.deploy`,
`router.prepare`, `publication.resolve`, `publication.rebind`,
`access-path.materialize`, `activation.commit`, `provider.materialize`,
`provider.observe`, `repair.plan`. Operation-level state lives entirely in
`Deployment.conditions[]` with `scope.kind="operation"`. Provider
materialization failure MUST NOT mutate `Deployment.desired`; repair or
rollback creates a new Deployment.

Activation preview MUST verify: exposure target exists and is
exposureEligible; InterfaceDescriptor is compatible with RouteDescriptor;
router provider/materialization supports required protocol/listener
semantics; assignment semantics are supported or blocked; health/probe model
is declared or explicitly unknown; transport/security policy is supported;
runtime_network_policy covers every assigned component and primary/candidate
selector used. For non-routed groups, `desired.routes` MAY be empty and the
activation envelope SHOULD record a single assignment with weight 100 for the
primary component.

Serving status uses condition types `ActivationCommitted`,
`ServingMaterializing`, `ServingConverged`, `ServingDegraded`.
`ServingConverged` MUST require ProviderObservation evidence (§ 14) for the
materializations required by the current routes, runtime network policy, and
activation envelope. For non-HTTP protocols, the descriptor or provider
profile MUST define what observation is sufficient; protocols without
observable health MAY remain `unknown`.

---

## 14. ProviderObservation {#provider-observation}

ProviderObservation is a separate, append-only stream of observations against
provider state. It is never canonical. The canonical desired state is
`Deployment.desired`.

```ts
type ProviderObservation = {
  id: string;
  deployment_id: string;        // the Deployment whose desired state was observed against
  provider_id: string; object_address: string;
  observed_state: "present" | "missing" | "drifted" | "unknown";
  drift_status?:
    | "provider-object-missing" | "config-drift" | "status-drift"
    | "security-drift" | "ownership-drift" | "cache-drift";
  observed_digest?: string; observed_at: string;
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
  generation: number; advanced_at: string;
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
durable resource contents (invariant 12). Restore-to-new-instance is a
resource operation that requires a new Deployment with updated bindings.

Repair is expressed as a new Deployment whose `rollback_target` MAY reference
a prior healthy Deployment. Repair MUST NOT mutate canonical state of any
existing Deployment.

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

The previous public paths (`/api/public/v1/deploy/plans`,
`/api/public/v1/deploy/applies`,
`/api/public/v1/spaces/:spaceId/group-deployment-snapshots/*`,
`/api/deploy/plans`, `/api/deploy/apply-runs`) are removed in v3. This is a
breaking change. Migration mapping is in § 18.

---

## 18. Migration from v2 {#v2-migration}

This section is the **only** place in the Core spec where v2 record names
appear as record names. They are listed here purely to anchor the migration.

| v2 record / concept            | v3 location                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| Plan                           | Deployment with status `resolved` (and beyond)                       |
| ApplyRun                       | Deployment status transition `applying` -> `applied`                 |
| ApplyPhase                     | Deployment.conditions[] entries with `scope.kind="phase"`            |
| OperationRun                   | Deployment.conditions[] entries with `scope.kind="operation"`        |
| RolloutRun                     | Deployment.desired.activation_envelope.rollout_strategy              |
| AppRelease                     | Deployment itself; the Deployment is the release                     |
| ActivationRecord               | Deployment.desired.activation_envelope                               |
| GroupActivationPointer         | GroupHead                                                            |
| BindingSetRevision             | Deployment.desired.bindings                                          |
| BindingValueResolution         | resolutionPolicy / resolvedVersion / resolvedAt on each binding      |
| RouterConfig                   | Deployment.desired.routes (+ activation_envelope.route_assignments)  |
| RuntimeNetworkPolicy           | Deployment.desired.runtime_network_policy                            |
| DescriptorClosure              | Deployment.resolution.descriptor_closure                             |
| ResolvedGraph                  | Deployment.resolution.resolved_graph                                 |
| CoreProjectionRecord           | Deployment.resolution.resolved_graph.projections                     |
| CorePolicyDecisionRecord       | Deployment.policy_decisions[]                                        |
| CoreApprovalRecord             | Deployment.approval                                                  |
| ProviderMaterialization        | Deployment.conditions[] on the desired side                          |
| ProviderObservation            | ProviderObservation (retained as a separate stream)                  |
| ResourceInstance               | retained as an independent record                                    |
| MigrationLedger                | retained as an independent record                                    |
| ObjectAddress                  | retained unchanged                                                   |

Public API path mapping:

| v2 path                                                                  | v3 path                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `POST /api/public/v1/deploy/plans`                                       | `POST /api/public/v1/deployments` with `mode="resolve"`  |
| `POST /api/public/v1/deploy/applies`                                     | `POST /api/public/v1/deployments/:id/apply`              |
| `GET  /api/public/v1/deploy/plans/:id`                                   | `GET  /api/public/v1/deployments/:id`                    |
| `GET  /api/public/v1/spaces/:spaceId/group-deployment-snapshots`         | `GET  /api/public/v1/deployments?group=&status=`         |
| `GET  /api/public/v1/spaces/:spaceId/group-deployment-snapshots/current` | `GET  /api/public/v1/groups/:group_id/head`              |
| `POST /api/public/v1/spaces/:spaceId/group-deployment-snapshots/rollback`| `POST /api/public/v1/groups/:group_id/rollback`          |

CLI mapping:

| v2 CLI                          | v3 CLI                                              |
| ------------------------------- | --------------------------------------------------- |
| `takos deploy --plan <manifest>`| `takos deploy --resolve-only <manifest>`            |
| `takos deploy --apply <plan>`   | `takos apply <deployment-id>`                       |
| `takos deploy <manifest>`       | `takos deploy <manifest>` (now resolve+apply sugar) |
| `takos rollback --activation`   | `takos rollback [<group>]`                          |

DB migration is covered separately (Phase 2). It collapses `deploy_plans`,
`deploy_activation_records`, `deploy_operation_records`, and
`deploy_group_activation_pointers` into `deployments` + `group_heads`, joining
on group + activation generation. History is preserved as Deployment rows
with synthesized `resolution` / `desired` payloads.

---

```text
Core has no domain kinds.
Core defines Deployment / ProviderObservation / GroupHead.
Descriptors define meaning.
Deployments pin descriptors.
Apply uses pinned meaning.
Bindings are explicit.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
Providers materialize; they do not define.
Observed provider state is never canonical.
```
