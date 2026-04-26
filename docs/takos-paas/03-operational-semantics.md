# 03. Operational Semantics

## 1. Purpose

This document defines how Takos Deploy v2 behaves under rollout, canary, long-running operations, trust revocation, side effects, dependencies, repair, GC, and audit.

## 2. Operation taxonomy

Plan and Apply use stable operation names.

Examples:

```text
resource.bind
resource.create
resource.restore
resource.migrate.expand
resource.migrate.data
resource.migrate.contract
grant.create
grant.revoke
binding-set.create
workload.build
workload.deploy
event-subscription.create
event-subscription.switch
app-release.prepare
network-config.prepare
runtime-network-policy.prepare
activation.preview
activation.create
provider.materialize
provider.observe
publication.rebind
repair.rematerialize
```

Operation semantics:

```ts
interface OperationSemantics {
  kind: string;
  idempotencyScope: "group" | "resource" | "provider-target" | "global";
  retryPolicy: "safe" | "conditional" | "manual-only";
  partialSuccess: "none" | "allowed-with-observation" | "ledgered";
  compensation: "none" | "delete-materialization" | "new-plan-required";
}
```

`activation.create` is idempotent by Plan and target assignment digest. It must not create duplicate active assignments.

`resource.migrate.*` uses MigrationLedger and checksums. Partial progress must be ledgered.

`provider.materialize` is retryable when the provider operation idempotency key and materialization reference are known.

## 3. RolloutRun

ActivationRecord is one desired assignment. RolloutRun owns the rollout sequence.

```ts
interface RolloutRun {
  id: string;
  groupId: string;
  planId: string;
  status: "created" | "running" | "paused" | "succeeded" | "failed" | "cancelled";
  currentActivationRecordId?: string;
  currentStepIndex: number;
  steps: RolloutStep[];
  gates: RolloutGate[];
}

interface RolloutStep {
  assignments: ActivationAssignment[];
  duration?: string;
  requireApproval?: boolean;
}

interface RolloutGate {
  type: "metric" | "manual" | "time" | "condition";
  status: "pending" | "passed" | "failed";
}
```

RolloutRun creates a new ActivationRecord for each step. It never mutates an existing ActivationRecord.

## 4. Canary semantics

Core canary is HTTP-only.

```text
Weighted ActivationRecord assignments apply to HTTP ingress traffic only.
Queue, schedule, publication, and default event delivery resolve through primaryAppReleaseId unless an explicit extension says otherwise.
```

### 4.1 Cross-release compatibility

When multiple AppReleases receive HTTP traffic at the same time, they must be mutually compatible for side effects.

```ts
interface CrossReleaseCompatibilityReport {
  assignedAppReleaseIds: string[];
  resourceCompatibility: CompatibilityFinding[];
  dataContractCompatibility: CompatibilityFinding[];
  eventCompatibility: CompatibilityFinding[];
  objectStoreCompatibility: CompatibilityFinding[];
  publicationCompatibility: CompatibilityFinding[];
  internalServiceCompatibility: CompatibilityFinding[];
  result: "compatible" | "requires-approval" | "blocked";
}
```

This checks more than DB schema. It checks queue messages, object-store conventions, publication values, internal service contracts, idempotency assumptions, and candidate side effects.

### 4.2 CanarySideEffectPolicy

```ts
interface CanarySideEffectPolicy {
  mode: "allow" | "gated" | "read-only" | "shadow-only";
  forbid?: Array<
    | "queue:new-schema"
    | "object-store:new-prefix"
    | "publication:new-version"
    | "external-api:new-destination"
    | "db:semantic-write-change"
  >;
  enforcement?: CanarySideEffectEnforcement[];
}

interface CanarySideEffectEnforcement {
  kind:
    | "binding-wrapper"
    | "egress-policy"
    | "plan-only"
    | "runtime-context"
    | "unsupported";
  target: string;
}
```

Runtime context may expose:

```text
TAKOS_CANARY=true | false
TAKOS_ACTIVATION_ASSIGNMENT=primary | candidate
```

Plan must show which side-effect guards are enforced and which are advisory.

## 5. Shadow traffic

Shadow traffic is not live canary.

```text
live-canary:
  candidate serves users and may produce user-visible responses.

shadow:
  candidate receives mirrored requests but its response is discarded.
  side effects are forbidden unless explicitly gated.
```

```ts
interface TrafficExperiment {
  mode: "shadow" | "live-canary";
  sourceAppReleaseId: string;
  candidateAppReleaseId: string;
  sampleRate: number;
  sideEffects: "forbidden" | "allowed" | "gated";
}
```

## 6. DataContract

DataContract describes payload shape.

It may be used for:

```text
queue messages
publication values
object-store payload families
internal service requests/responses
webhook payloads
```

Cross-release compatibility may use DataContract evidence.

```yaml
dataContracts:
  userCreated:
    contract: event.user-created@v1
    compatibleWith: ">=1 <3"
```

## 7. Event subscriptions

Queue, schedule, and internal event subscriptions belong to AppRelease.

By default:

```text
queue/schedule delivery targets primaryAppReleaseId
HTTP candidate traffic does not automatically activate candidate event subscriptions
```

Activation preview must validate event subscription switching.

Event profiles define:

```text
at-least-once behavior
visibility timeout
in-flight message behavior
partial ack
DLQ
consumer overlap support
schedule overlap policy
```

## 8. ChangeSetPlan and DependencyGraph

A group-local Plan may have multi-group consequences. Publication consumers, service grants, shared resources, and migration dependencies can cross group boundaries.

ChangeSetPlan orchestrates multiple group Plans. It is not a distributed transaction.

```ts
interface ChangeSetPlan {
  id: string;
  spaceId: string;
  groupPlans: string[];
  dependencyGraphId: string;
  activationPolicy: ChangeSetActivationPolicy;
  status: "valid" | "invalid" | "stale" | "expired" | "superseded";
}

interface ChangeSetActivationPolicy {
  mode: "ordered" | "parallel-after-barrier" | "manual-gated";
  failure: "stop" | "continue-independent" | "compensating-plans-required";
}
```

DependencyGraph:

```ts
interface DependencyGraph {
  id: string;
  nodes: string[];
  edges: Array<{
    from: string;
    to: string;
    kind: "publication" | "service" | "shared-resource" | "migration";
  }>;
}
```

Blocked cycles:

```text
deployment-time publication binding cycle
activation dependency cycle
shared resource migration cycle
```

Runtime call cycles may be allowed if they do not create deployment-time or activation-time cycles.

## 9. Publication propagation and consume bindings

Publication is a typed output/interface exposed by a producer. Consumption is an explicit binding created by a consumer.

```text
PublicationDeclaration:
  producer declares a typed output

PublicationBinding:
  resolved producer output value for an AppRelease / NetworkConfig / built-in provider

PublicationConsumerBinding:
  consumer binds selected outputs into its BindingSetRevision
```

Publications are never injected automatically into every workload in a space. A consumer must explicitly bind the publication and its selected outputs.

### 9.1 Publication addresses

Space-wide short names are not sufficient for durable operation. Publications have stable addresses.

```text
publication:<group>/<name>
publication:<group>/<name>#<output>
builtin:takos.oauth-client@v1
builtin:takos.api-key@v1
```

Short names may be accepted only when unambiguous according to policy. Plan must block ambiguous publication references.

### 9.2 Explicit output injection

Publication consume uses explicit injection by default.

```yaml
consumes:
  SEARCH_MCP:
    publication: publication:search-agent/search
    outputs:
      url:
        inject:
          env: SEARCH_MCP_URL
    mode: explicit-only
```

`consume.env` style alias maps are legacy shorthand. They must not cause newly-added publication outputs to appear in a consumer runtime without an updated Plan. Secret outputs require explicit injection and approval unless policy says otherwise.

### 9.3 Rebind Plans

Producer publication changes may create dependent consumer Plans.

Examples that require rebind evaluation:

```text
output added / removed
output type changed
secret output added
route-derived URL changed
PublicationContract major version changed
DataContract compatibility range changed
```

Consumer rebind is represented as a Plan. Takos must not silently mutate consumer runtime bindings without a Plan unless policy explicitly allows automatic rebind for that publication contract and output class.

Producer activation may be blocked by policy until required consumer compatibility or rebind Plans are accepted. For multi-group updates, ChangeSetPlan orchestrates producer and consumer group Plans.

### 9.4 Managed registry projections

Some publication contracts create projections into runtime registries, such as MCP server registry, file-handler discovery, UI surface registry, or webhook endpoint catalogs.

These projections are materialized state, not canonical state.

```text
Canonical:
  PublicationDeclaration / PublicationBinding / PublicationConsumerBinding

Materialized projection:
  MCP registry entry
  FileHandler discovery entry
  UI surface registry entry
```

Managed projections must expose conditions.

```text
PublicationReady
RouteResolved
AuthReady
ProjectionReady
ConsumerBindingsReady
```

A registry entry must not appear healthy if its route, auth secret, provider materialization, or publication binding is unresolved.

### 9.5 Auth and secret outputs

Publication contracts may expose secret outputs or auth metadata. Secret values are not ordinary strings.

```ts
interface PublicationSecretOutput {
  outputName: string;
  secretName: string;
  resolution: "latest-at-activation" | "pinned-version";
  rollbackPolicy: "re-resolve" | "reuse-pinned-version";
  owner: "producer" | "builtin-provider";
}
```

`authSecretRef`-style metadata must resolve through SecretBindingRef or PublicationSecretOutput. Consumer workloads must not receive raw secret values unless the publication contract, injection declaration, grant, and policy all allow it.

### 9.6 Grants

Publication consumption requires a grant. Space role alone is not enough for cross-app invocation or credential-bearing outputs.

```ts
interface PublicationConsumerGrant {
  consumerGroupId: string;
  publicationAddress: string;
  actions: string[];
  scopes?: unknown;
  expiresAt?: string;
}
```

Examples:

```text
mcp:invoke
file-handler:open
ui-surface:embed
credential:read
```

## 10. Long-running operations

Long-running migration, build, data migration, provider operation, or artifact mirror operations must not hold broad group locks.

Apply must use scoped locks and phase-boundary revalidation.

## 11. AutoRollbackPolicy

Automatic rollback is never implicit.

```ts
interface AutoRollbackPolicy {
  enabled: boolean;
  allowedReasons: Array<
    | "health-check-failed"
    | "materialization-failed"
    | "canary-metric-failed"
  >;
  forbiddenIf: Array<
    | "migration-applied"
    | "resource-binding-changed"
    | "trust-revoked"
    | "secret-rotated"
  >;
}
```

Automatic rollback must create a new ActivationRecord. It must not mutate or delete an existing ActivationRecord.

## 12. RepairPlan

Repair is a Plan intent.

Repair handles:

```text
trust revocation
provider package upgrade
rematerialization
drift
resource rebind
materialization failure
restore fallout
```

```text
repair is not special magic; it is a Plan intent.
```

## 13. ProtectedReference and GC

GC must not delete objects with protected references.

```ts
interface ProtectedReference {
  refType: string;
  refId: string;
  reason:
    | "current-activation"
    | "rollback-window"
    | "prepared-plan"
    | "migration-resume"
    | "audit-retention"
    | "materialization-record"
    | "package-resolution"
    | "supply-chain-record";
  expiresAt?: string;
}
```

Protected references cover:

```text
AppRelease
NetworkConfig
RuntimeNetworkPolicy
ActivationRecord
WorkloadRevision
BindingSetRevision
PreparedArtifact
ProviderPackage digest
ResourceContractPackage digest
DataContractPackage digest
NativeSchema digest
Migration checkpoint
ProviderMaterialization
AuditEvent
```

## 14. Audit events

Security-sensitive operations require append-only audit events:

```text
provider credential use
package trust changes
approval / invalidation
GroupActivationPointer advancement
resource deletion / restore
native raw binding enablement
provider package execution
support access
trust revocation repair
provider materialization failure
auto rollback creation
```

Audit events should include actor, operation, object address, Plan id, ApplyRun id, ActivationRecord id, provider target, timestamp, and stable reason code.

## 15. Approval invalidation

Approvals are tied to the exact risk subject they approve.

```ts
interface ApprovalRecord {
  planId: string;
  approvalType: string;
  subjectDigest: string;
  approvedBy: string;
  approvedAt: string;
}
```

If the risk subject changes, approval is invalid.

## 16. PlacementDecision

ResolvedGraph may record placement decisions.

```ts
interface PlacementDecision {
  objectAddress: string;
  providerTarget: string;
  region?: string;
  rationale: string[];
}
```

This supports data residency, locality, latency, and provider target rationale.


---
