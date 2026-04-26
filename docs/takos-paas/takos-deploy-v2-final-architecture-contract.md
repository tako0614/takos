# Takos Deploy v2 Final Architecture Contract

This kit is the final-form architecture package for Takos Deploy v2.

The design goal is simple:

```text
Takos Deploy v2 is not a cloud abstraction layer.
It is a deployment meaning system.
```

Takos Core owns meaning and safety. ProviderPackages own typed native power and materialization.

## Documents

1. `01-core-kernel.md`  
   The small core: AppSpec, EnvSpec, PolicySpec, Plan, Apply, AppRelease, NetworkConfig, RuntimeNetworkPolicy, ActivationRecord, ResourceInstance, and ProviderMaterialization.

2. `02-registry-and-packages.md`  
   ProviderPackage, ResourceContractPackage, DataContractPackage, NativeSchema, PackageResolution, trust, revocation, conformance, provider targets, and provider-native configuration.

3. `03-operational-semantics.md`  
   RolloutRun, ChangeSetPlan, DependencyGraph, operation semantics, scoped locks, phase-boundary revalidation, canary side effects, shadow traffic, repair, restore, GC, and audit.

4. `04-runtime-contracts.md`  
   Worker, container, job, event subscriptions, Direct Workload Deploy, bindings, service identity, resource access, and readiness.

5. `05-security-supply-chain.md`  
   ProviderPackage execution isolation, credential boundaries, SupplyChainRecord, artifact mirroring, trust revocation, egress enforcement, secret resolution, redaction, and audit requirements.

6. `06-acceptance-tests.md`  
   Test catalog for Plan, Apply, Activation, resource contracts, provider-native materialization, canary side effects, multi-group dependencies, security, rollback, restore, and GC.

7. `takos-deploy-v2-final-architecture-contract.md`  
   A combined single-file version of the same specification.

## Design compass

```text
AppSpec declares app meaning.
EnvSpec binds meaning to an environment.
PolicySpec constrains meaning.
ResourceContractPackages define durable resource meaning.
DataContractPackages define payload meaning.
ProviderPackages materialize meaning into real infrastructure.
PackageResolution pins refs to digests.
Plan computes safe change.
Apply executes change with scoped locks and phase revalidation.
AppRelease owns runtime revisions.
NetworkConfig owns HTTP ingress.
RuntimeNetworkPolicy owns workload-scoped egress and service identity.
ActivationRecord records desired HTTP serving assignment.
ResourceInstance carries durable state.
ProviderMaterialization records where Takos tried to make infrastructure real.
Observed provider state is never canonical.
```


---

# 01. Takos Deploy v2 Core Kernel

## 1. Purpose

Takos Deploy v2 is a manifest-driven, provider-extensible deployment system.

It compiles app intent and environment binding into a resolved graph, produces a Plan, executes that Plan through Apply, and advances an immutable ActivationRecord that records the desired HTTP serving assignment.

The core deliberately separates four kinds of truth:

```text
App meaning       -> AppSpec / AppGraph / AppRelease
Environment       -> EnvSpec / NetworkConfig / RuntimeNetworkPolicy
Durable state     -> ResourceInstance / MigrationLedger
Provider reality  -> ProviderMaterialization / ObservedProviderState
```

Provider state is observed. It is never canonical.

## 2. Core invariants

```text
1. Takos Core owns meaning and safety.
2. ProviderPackages own typed native power and materialization.
3. ProviderPackages may materialize Takos objects. They must not redefine Takos object semantics.
4. ActivationRecord is immutable.
5. GroupActivationPointer selects the current ActivationRecord.
6. ActivationRecord records desired HTTP serving assignment, not proof of provider convergence.
7. Weighted ActivationRecord assignments apply to HTTP ingress only.
8. Queue, schedule, internal events, and publications resolve through primaryAppReleaseId unless an explicit extension says otherwise.
9. ResourceInstance carries durable state outside AppRelease rollback.
10. Rollback reactivates a compatible prior assignment. It does not reverse migrations, restore DB data, restore object contents, restore queue contents, or restore secret values.
11. AppSpec in portable mode must not contain providerNative blocks.
12. Runtime egress and service identity are RuntimeNetworkPolicy concerns, not HTTP ingress route concerns.
```

## 3. Input specifications

### 3.1 AppSpec

AppSpec declares app meaning.

It includes:

```text
workloads
resource claims
exposures
publications
event declarations
data contract declarations
runtime requirements
schema requirements
```

Portable AppSpec is provider-independent. Provider-specific operational tuning belongs in EnvSpec. Provider-native AppSpec is allowed only when app behavior truly requires a provider package or native schema.

Example:

```yaml
apiVersion: apps.takos.dev/v1
kind: App

name: notes

portability:
  mode: portable

workloads:
  api:
    kind: container
    image:
      ref: ghcr.io/acme/notes-api@sha256:abc123
    endpoints:
      http:
        protocol: http
        port: 8080
    consumes:
      DATABASE_URL:
        resource: db
        access: database-url
        permissions:
          - action: sql:read
          - action: sql:write

resources:
  db:
    contract: sql.postgres@v1
    requirements:
      features:
        - sql.postgres.extension.pgvector@v1
      operational:
        isolation: exclusive
    schema:
      name: notes-db
      version: 4
      compatibleWith: ">=3 <5"
      migrations:
        engine: postgres@16
        strategy: expand-contract
        expand:
          path: ./db/migrations/expand
        data:
          path: ./db/migrations/data
          mode: resumable
          gateRelease: true
        contract:
          path: ./db/migrations/contract
          afterReleaseStableFor: 7d
          requireApproval: true

exposures:
  web:
    endpoint: api.http
    visibility: public
```

### 3.2 EnvSpec

EnvSpec binds app meaning to an environment.

It includes:

```text
provider targets
provider mappings
routes and domains
TLS policy
release policy
runtime network policy defaults
provider-native environment config
placement requirements
```

Example:

```yaml
providerTargets:
  cloudrun-jp:
    provider: google.cloudrun@v1
    region: asia-northeast1
    credentialRef:
      name: gcp-prod-cloudrun-deployer
      scope: provider-target

  neon-prod:
    provider: neon.postgres@v1
    region: aws-ap-northeast-1

providerMappings:
  workloadProfiles:
    container-http-serverless@v1:
      target: cloudrun-jp

  networkProfiles:
    network-http-provider-url@v1:
      target: cloudrun-jp

  resourceContracts:
    sql.postgres@v1:
      target: neon-prod

providerNative:
  google.cloudrun.service@v1:
    workloads:
      api:
        required: false
        fallback: ignore
        values:
          minInstances: 1
```

### 3.3 PolicySpec

PolicySpec constrains all inputs.

Policy precedence:

```text
operator policy
> environment policy
> space policy
> catalog policy
```

AppSpec, EnvSpec, DirectDeploy input, and CLI/UI patches are not policy layers. They are evaluated against the effective policy.

Policy decides:

```text
allowed providers
allowed native schemas
native field approvals
resource deletion rules
secret binding rules
egress enforcement requirements
artifact mirroring requirements
auto rollback rules
trust requirements
```

## 4. Graphs

### 4.1 AppGraph

AppGraph normalizes AppSpec into stable Takos meaning.

It includes provider-native requirements if the app is provider-native, but it does not resolve provider targets or provider-assigned outputs.

### 4.2 ResolvedGraph

ResolvedGraph resolves AppGraph against EnvSpec, PolicySpec, ProviderTargets, PackageResolution, and capability support.

ResolvedGraph contains:

```text
selected provider targets
package digests
resolved native schemas
derived access mode requirements
resource satisfaction reports
placement decisions
operation prerequisites
```

ResolvedGraph does not contain provider-assigned output values such as generated URLs, allocated IPs, provider object ids, or created database ids. Those belong in ProviderMaterialization, ResourceInstance status, and publication resolution records.

## 5. Plan

Plan is not a casual dry-run. Plan is a state-fenced proposal.

Plan records:

```text
intent
read set
diff
risk classification
approval requirements
operation graph
resource satisfaction reports
feature realization reports
cross-release compatibility reports
prepared artifacts, if mode is prepared
```

### 5.1 Plan modes

```text
StaticPlan:
  Does not execute build commands.
  Validates structure, references, policy, capabilities, and expected operations.

PreparedPlan:
  May execute sandboxed build/lint/analysis.
  May produce prepared artifacts, provenance, SBOM, and artifact digests.
```

### 5.2 Plan read set

```ts
interface PlanReadSetEntry {
  objectType: string;
  objectId: string;
  version?: string | number;
  digest?: string;
  stalenessImpact: "must-replan" | "must-revalidate" | "warning-only";
}
```

Every read set entry must include either `version` or `digest`.

Provider-native and registry-backed Plans must include read set entries for:

```text
ProviderPackage digest
ResourceContractPackage digest
DataContractPackage digest, when used
NativeSchema digest
CapabilityProfile support
ProviderPackageTrustRecord
ResourceContractTrustRecord
DataContractTrustRecord
ProviderTarget
PolicySpec
MigrationLedger
ResourceInstance state
```

## 6. Apply

Apply executes a Plan. Apply is idempotent at operation boundaries.

Apply uses scoped locks instead of holding one broad lock for the whole run:

```text
GroupSpecLock:
  short critical sections for spec and pointer decisions

ResourceMigrationLock:
  ResourceInstance migration and restore

ActivationLock:
  GroupActivationPointer advancement

NetworkLock:
  provider or gateway materialization when required
```

Long-running operations must not hold a broad group lock.

### 6.1 Apply sequence

```text
1. verify approvals
2. acquire short GroupSpecLock
3. validate Plan read set
4. release broad lock before long-running work
5. prepare ResourceBinding and ResourceInstance
6. acquire ResourceMigrationLock for required resources
7. run expand migrations
8. run gateRelease data migrations
9. create Grants
10. create BindingSetRevision
11. build or deploy WorkloadRevision
12. create EventSubscriptionRevision
13. evaluate readiness
14. prepare AppRelease
15. prepare NetworkConfig
16. prepare RuntimeNetworkPolicy
17. validate activation preview:
    - HTTP materialization
    - event subscription switch
    - publication resolver
    - provider acceptance
    - RuntimeNetworkPolicy enforcement
18. acquire ActivationLock
19. create immutable ActivationRecord
20. advance GroupActivationPointer
21. release ActivationLock
22. materialize provider state
23. observe convergence
24. record Conditions and AuditEvents
```

### 6.2 Phase-boundary revalidation

Long-running Apply must revalidate at phase boundaries:

```text
before migrations
before workload deploy
before AppRelease ready
before activation preview
before ActivationRecord creation
```

`must-replan` stops the ApplyRun. `must-revalidate` runs validation again. `warning-only` records a warning and may continue.

## 7. AppRelease

AppRelease owns runtime revisions.

It includes:

```text
WorkloadRevision
BindingSetRevision
EventSubscriptionRevision
AppPublication values
Resource requirements
Readiness observations
SupplyChainRecord references
```

It does not own routes, domains, ingress policy, DB data, object contents, queue contents, or provider state.

## 8. NetworkConfig

NetworkConfig owns HTTP ingress.

It includes:

```text
HTTP routes
hosts
domains
TLS policy
ingress IP leases
gateway bindings
blocking route readiness
```

It does not own egress. Egress belongs to RuntimeNetworkPolicy.

Blocking routes must pass pre-activation readiness before ActivationRecord creation:

```text
exposure exists
selected provider target supports required network profile
domain ownership verified, if required
TLS available or pre-issued, if required
gateway or materializer accepts preview
```

Non-blocking routes may remain pending and surface Conditions.

## 9. RuntimeNetworkPolicy

RuntimeNetworkPolicy owns workload-scoped egress, private network control, service identity, outbound identity, and internal service grants.

Rules must be scoped to workload and activation context.

```ts
interface RuntimeNetworkRule {
  match: {
    appReleaseId?: string;
    workloadAddress?: string;
    activationRole?: "primary" | "candidate";
  };
  allow: EgressDestination[];
}
```

`activationRole` is computed:

```text
primaryAppReleaseId -> primary
assigned but not primary -> candidate
```

RuntimeNetworkPolicy must include an EgressPolicySatisfactionReport for each rule.

```ts
interface EgressPolicySatisfactionReport {
  ruleId: string;
  providerTarget: string;
  enforcement: "enforced" | "advisory" | "unsupported";
  limitations: string[];
}
```

If PolicySpec requires enforcement, advisory or unsupported egress rules block the Plan.

## 10. ActivationRecord

ActivationRecord is immutable.

It records the canonical desired HTTP serving assignment. It is not proof that provider traffic has converged.

```ts
interface ActivationRecord {
  id: string;
  groupId: string;
  networkConfigId: string;
  runtimeNetworkPolicyId: string;
  primaryAppReleaseId: string;
  assignments: ActivationAssignment[];
  createdAt: string;
}

interface ActivationAssignment {
  appReleaseId: string;
  weight: number;
}
```

Invariants:

```text
1. assignments weight must sum to 100.
2. every assigned AppRelease must be ready and not retired.
3. NetworkConfig must be compatible with every assigned AppRelease.
4. RuntimeNetworkPolicy must be compatible with every assigned AppRelease.
5. primaryAppReleaseId must be one of the assigned AppReleases.
6. Weighted assignments apply to HTTP ingress only.
7. Event delivery and publication resolution use primaryAppReleaseId unless an explicit extension says otherwise.
```

## 11. GroupActivationPointer

The current serving assignment is selected by GroupActivationPointer.

```ts
interface GroupActivationPointer {
  groupId: string;
  currentActivationRecordId: string;
  generation: number;
  updatedAt: string;
}
```

Every rollout step creates a new immutable ActivationRecord and advances the pointer.

```text
act_1: rel_old 100%
act_2: rel_old 90%, rel_new 10%
act_3: rel_old 50%, rel_new 50%
act_4: rel_new 100%
```

## 12. ProviderMaterialization

ProviderMaterialization is a Takos-side materialization reference.

It records where Takos attempted to make infrastructure real.

It is not observed provider state.

```text
Canonical Takos records:
  ActivationRecord
  AppRelease
  NetworkConfig
  RuntimeNetworkPolicy
  ResourceInstance
  MigrationLedger

Canonical materialization references:
  ProviderMaterialization records

Observed provider state:
  never canonical
```

Materialization failure must not mutate or delete ActivationRecord. It records Conditions and ProviderOperations. If automatic rollback is allowed, it creates a new ActivationRecord.

## 13. ResourceInstance and ResourceBinding

ResourceClaim requests a ResourceContract. ResourceBinding connects a claim to an instance. ResourceInstance carries durable state.

```ts
interface ResourceInstance {
  id: string;
  contract: string;
  origin: "managed" | "imported-managed" | "imported-bind-only" | "external";
  sharingMode: "exclusive" | "shared-readonly" | "shared-managed";
  providerMaterializationId?: string;
  lifecycle: ResourceLifecycle;
  schemaOwner?: {
    groupId: string;
    resourceClaimName: string;
  };
}

interface ResourceBinding {
  claimAddress: string;
  instanceId: string;
  role:
    | "owner"
    | "consumer"
    | "readonly-consumer"
    | "schema-owner"
    | "bind-only";
}
```

`origin` describes where the resource came from. `sharingMode` describes sharing rules. `role` describes this app's relationship to the instance.

Migration authority follows the origin/sharing/role matrix:

```text
managed + exclusive:
  Takos may create, migrate, and delete according to lifecycle and policy.

imported-managed + exclusive:
  Takos may observe or migrate only if credential, schemaOwner, and policy allow.

imported-bind-only:
  Takos may bind only. No observe, migration, or delete.

external:
  Opaque. Takos does not own lifecycle, schema, or migration.

shared-readonly:
  Consumers cannot migrate.

shared-managed:
  Only schemaOwner or operator-approved migration may migrate.
```

## 14. Rollback, restore, repair

Rollback is activation, not reverse apply.

```text
Rollback may activate a previous compatible ActivationRecord or AppRelease/NetworkConfig pair.
Rollback must not reverse migrations, restore DB data, restore object contents, restore queue contents, or restore secret values.
```

Restore is a ResourceInstance operation. Repair is a Plan intent.

```text
Plan.intent:
  deploy
  update
  rollback
  restore
  repair
  uninstall
  rebind
  network-update
  publication-rebind
```

Repair handles drift, trust revocation, materialization failure, provider package upgrade, and resource rebind.


---

# 02. Registry, Packages, Contracts, and Native Power

## 1. Purpose

This document defines how Takos Deploy v2 extends without changing the core semantics.

It covers:

```text
ProviderPackage
ResourceContractPackage
DataContractPackage
NativeSchema
CapabilityProfile
PackageResolution
TrustRecord
Conformance
ProviderTarget
Provider-native configuration
```

## 2. PackageResolution

Human-readable refs are not execution truth. They must resolve to digests.

```ts
interface PackageResolution {
  ref: string;
  kind:
    | "provider-package"
    | "resource-contract-package"
    | "data-contract-package"
    | "native-schema"
    | "capability-profile";
  digest: string;
  registry: string;
  trustRecordId?: string;
  resolvedAt: string;
}
```

ResolvedGraph includes PackageResolution records.

```text
ref is human-facing.
digest is execution-facing.
PackageResolution is reproducibility-facing.
```

## 3. Immutability and versioning

Descriptors identified by `ref + digest` are immutable.

A registry may publish a new digest under the same major ref only if the update is backward-compatible according to the package policy. Breaking changes require a new major version.

Examples:

```text
sql.postgres@v1 -> backward-compatible descriptor updates only
sql.postgres@v2 -> breaking contract update
```

This rule applies to:

```text
ResourceContractDescriptor
DataContractDescriptor
ProviderPackageDescriptor
NativeSchemaDescriptor
CapabilityProfileDescriptor
```

## 4. ResourceContractPackage

ResourceContractPackage defines durable resource meaning.

ProviderPackage may support a ResourceContract. ProviderPackage must not define ResourceContract semantics.

```ts
interface ResourceContractPackage {
  ref: string;
  digest: string;
  publisher: string;
  descriptors: ResourceContractDescriptor[];
}

interface ResourceContractDescriptor {
  ref: string;
  category: "database" | "object-store" | "queue" | string;
  actionNamespace: string;
  accessModes: AccessModeDescriptor[];
  schemaModel?: "none" | "sql" | "opaque" | string;
  migrationEngines?: string[];
  permissions: PermissionDescriptor[];
  features?: ResourceFeatureDescriptor[];
  operationalRequirements?: OperationalRequirementDescriptor[];
  conformanceSuite?: string;
}
```

`category` is UI and control-plane metadata. It must not define resource semantics. Plan validation must use descriptors and provider support, not category.

### 4.1 Permission descriptor

```ts
interface PermissionDescriptor {
  action: string;
  supportedScopes: ScopeDescriptor[];
  defaultEnforcement: "enforced" | "advisory" | "unsupported";
}
```

Examples:

```text
sql.postgres@v1:
  sql:read, sql:write, sql:ddl
  scopes: schema, table

object-store.s3@v1:
  object:get, object:put, object:delete, object:list
  scopes: bucket, prefix

queue.at-least-once@v1:
  queue:send, queue:consume
  scopes: queue
```

### 4.2 Resource feature descriptor

Feature requirements prevent contract-name explosion.

```ts
interface ResourceFeatureDescriptor {
  ref: string;
  appliesToContracts: string[];
  requiredAccessModes?: string[];
  requiredMigrationEngines?: string[];
  requiredPermissions?: string[];
  lifecycleEffect?: "resource-instance" | "in-place-materialization" | "plan-only";
}
```

Example:

```text
Base contract:
  sql.postgres@v1

Feature:
  sql.postgres.extension.pgvector@v1
```

AppSpec requests the feature:

```yaml
resources:
  db:
    contract: sql.postgres@v1
    requirements:
      features:
        - sql.postgres.extension.pgvector@v1
```

Provider-native configuration may be used to realize that feature, but the app-visible requirement belongs in ResourceContract requirements.

### 4.3 Operational requirement descriptor

Operational requirements are typed. Unknown keys are invalid unless explicitly allowed by policy.

```ts
interface OperationalRequirementDescriptor {
  ref: string;
  key: string;
  type: "string" | "number" | "boolean" | "enum" | "object";
  allowedValues?: string[];
  appMayRequest: boolean;
  policyMayConstrain: boolean;
  providerMaySatisfy: boolean;
}
```

Examples:

```text
backup
dataResidency
durability
isolation
retention
availability
```

## 5. DataContractPackage

ResourceContract defines resource capability. DataContract defines payload shape.

DataContracts are used for:

```text
queue messages
publication values
object-store payload families
internal service requests/responses
webhook payloads
```

```ts
interface DataContractPackage {
  ref: string;
  digest: string;
  publisher: string;
  descriptors: DataContractDescriptor[];
}

interface DataContractDescriptor {
  ref: string;
  schemaRef?: string;
  compatibility:
    | "backward-compatible"
    | "forward-compatible"
    | "exact"
    | "custom";
  compatibleWith?: string;
  breakingChangePolicy: "new-major-version";
}
```

DataContracts make cross-release compatibility testable.

## 6. ProviderPackage

ProviderPackage materializes Takos meaning into real infrastructure.

It may define native schemas, capability support, materializers, limitations, and credential requirements. It must not redefine Takos Core semantics.

```ts
interface ProviderPackage {
  ref: string;
  digest: string;
  publisher: string;
  signatureRef?: string;
  capabilities: ProviderCapabilitySupport;
  nativeSchemas: NativeSchemaDescriptor[];
  materializers: MaterializerDescriptor[];
  limitations?: string[];
}
```

Trust is not self-declared by the package. It is assigned by registry/operator trust records.

```ts
interface ProviderPackageTrustRecord {
  providerPackageRef: string;
  providerPackageDigest: string;
  trustLevel: "official" | "verified" | "local" | "untrusted";
  verifiedBy: string;
  verifiedAt: string;
}
```

## 7. Capability and resource support

Capability support is descriptor-based, not a string list.

```ts
interface CapabilityProfileSupport {
  profile: string;
  version: string;
  limits?: Record<string, unknown>;
  accessModes?: string[];
  regions?: string[];
  conformance: ConformanceResult;
  limitations?: string[];
}

interface ResourceContractSupport {
  contract: string;
  accessModes: string[];
  features?: string[];
  migrationEngines?: string[];
  restoreModes?: Array<
    | "none"
    | "backup-to-new-instance"
    | "backup-in-place"
    | "pitr-to-new-instance"
    | "pitr-in-place"
  >;
  limits?: Record<string, unknown>;
  regions?: string[];
  conformance: ConformanceResult;
  limitations?: string[];
}
```

## 8. NativeSchema

Native config is typed, versioned, policy-governed, and Plan-visible.

```text
ProviderNative config may influence materialization, activation strategy, and provider-specific behavior.
It must not redefine Plan, Apply, ActivationRecord, AppRelease, NetworkConfig, RuntimeNetworkPolicy, ResourceInstance, MigrationLedger, or PublicationBinding semantics.
```

```ts
interface NativeSchemaDescriptor {
  ref: string;
  appliesTo: Array<"app" | "env" | "policy">;
  fields: NativeSchemaFieldDescriptor[];
  lifecycleRules?: NativeSchemaLifecycleRule[];
}

interface NativeSchemaFieldDescriptor {
  path: string;
  allowedLocations: Array<"app" | "env" | "policy">;
  mergeStrategy:
    | "app-requires"
    | "env-overrides"
    | "policy-defaults"
    | "policy-limits"
    | "policy-deny";
  impact: NativeFeatureImpact[];
  lifecycleEffect:
    | "app-release"
    | "network-config"
    | "runtime-network-policy"
    | "resource-instance"
    | "event-subscription"
    | "in-place-materialization"
    | "plan-only";
}
```

Schema-level lifecycle rules may override or combine field effects when field combinations matter.

## 9. ProviderTarget

ProviderTarget selects a provider package family and environment location.

```yaml
providerTargets:
  cloudrun-jp:
    provider: google.cloudrun@v1
    region: asia-northeast1
    credentialRef:
      name: gcp-prod-cloudrun-deployer
      scope: provider-target
```

ProviderTarget does not pin package digest. ResolvedGraph and ProviderMaterialization pin digests through PackageResolution.

## 10. ProviderMapping

Mappings use refs, not ad-hoc keys.

```yaml
providerMappings:
  workloadProfiles:
    container-http-serverless@v1:
      target: cloudrun-jp

  networkProfiles:
    network-http-provider-url@v1:
      target: cloudrun-jp

  resourceContracts:
    sql.postgres@v1:
      target: neon-default

  resourceClaims:
    app.resource:mainDb:
      target: neon-prod
    app.resource:analyticsDb:
      target: analytics-postgres
```

Resolution order:

```text
claim-level mapping
-> contract-level mapping
-> selector-style mapping, if configured
-> operator default
-> unresolved means Plan blocked
```

## 11. Satisfaction reports

Resource satisfaction is reported explicitly.

```ts
interface ResourceSatisfactionReport {
  claimAddress: string;
  contract: string;
  providerTarget: string;
  supported: boolean;
  accessModes: Record<string, "supported" | "unsupported">;
  features: Record<string, "supported" | "unsupported" | "requires-native-config" | "requires-migration">;
  operational: Record<string, "satisfied" | "unsatisfied" | "policy-defaulted">;
  restoreModes: string[];
  limitations: string[];
}

interface ResourceFeatureRealization {
  feature: string;
  realization:
    | "already-supported"
    | "enable-through-native-config"
    | "enable-through-migration"
    | "unsupported";
  requiredNativeSchema?: string;
  requiredApproval?: string;
}
```

## 12. Trust revocation

Trust revocation does not mutate active state automatically.

It marks affected groups as Degraded or TrustRevoked, blocks new Plans using revoked packages, and allows repair Plans according to policy.

```ts
interface TrustRevocationImpact {
  affectedGroups: string[];
  blockedOperations: string[];
  allowedRepairStrategies: Array<
    | "upgrade-package"
    | "rematerialize"
    | "migrate-provider"
    | "operator-override"
  >;
}
```


---

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

## 9. Publication propagation

Producer publication changes may create dependent consumer Plans.

Producer activation may be blocked by policy until consumer compatibility or rebind Plans are accepted.

Consumer rebind is represented as a Plan. Takos must not silently mutate consumer runtime bindings without a Plan unless policy explicitly allows automatic rebind.

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

# 04. Runtime Contracts

## 1. Purpose

This document defines how workloads, bindings, events, service identity, Direct Workload Deploy, and readiness fit into Takos Deploy v2.

## 2. Workload contracts

Core workload kinds:

```text
js-worker
container
job
```

Compose is an input format, not a core workload kind.

```text
compose.yaml -> generated container workload(s)
```

## 3. JS worker

A JS worker uses a runtime contract.

```yaml
workloads:
  web:
    kind: js-worker
    runtime:
      contract: takos-worker@v1
      profile: worker-portable-small@v1
      features:
        - web.fetch
        - web.crypto.subtle
```

Provider-native worker features are explicit.

```yaml
portability:
  mode: provider-native

workloads:
  web:
    kind: js-worker
    providerNative:
      cloudflare.workers.compatibility@v1:
        required: true
        fallback: block
        values:
          compatibilityDate: "2026-04-25"
          flags:
            - nodejs_compat
          providesRuntimeFeatures:
            - node.buffer
            - node.crypto
```

Portable worker does not receive raw provider objects unless policy explicitly permits native binding in provider-native mode.

## 4. Container

Container contract must define:

```text
image or build source
digest pinning
prepared artifact reuse
entrypoint/command policy
env and secret injection
readiness
shutdown signal
timeout
resource limits
logs
network identity
```

In shared tenancy, the following are blocked unless a provider-native policy explicitly allows them:

```text
privileged
host network
host port
hostPath mount
Docker socket mount
devices
dangerous cap_add
```

## 5. Job

Job contract must define:

```text
input
idempotency key
checkpoint
retry
timeout
parallelism
grant scope
logs/events
cancel behavior
exit status
```

DataMigrationJob is a controlled job with MigrationJob metadata, checkpoint, ledger, and optional release gate.

## 6. Direct Workload Deploy

Direct Workload Deploy is a user-facing shortcut.

It accepts:

```text
worker bundle
worker source + build command
container image
Dockerfile
compose service
```

It compiles into generated AppSpec and EnvSpec. It never bypasses Plan, Apply, ActivationRecord, policy, readiness, audit, or package resolution.

Once a group is manifest-managed, direct workload deploy must not silently mutate AppSpec.

Allowed outcomes:

```text
block and ask for manifest update
write manifest explicitly
apply an explicit CLI patch according to policy
```

## 7. BindingSetRevision

BindingSetRevision is immutable in structure and resolution policy.

It does not always imply immutable secret values.

```ts
interface SecretBindingRef {
  bindingName: string;
  secretName: string;
  resolution: "latest-at-activation" | "pinned-version";
  pinnedVersionId?: string;
  rollbackPolicy: "re-resolve" | "reuse-pinned-version";
}
```

Default:

```text
resolution: latest-at-activation
rollbackPolicy: re-resolve
```

Rollback does not restore old secret values by default.

## 8. Resource access

Resource access is declared by consume edges and migrations.

Required access modes are derived from:

```text
workload consume edges
migration declarations
publication/resource operation requirements
```

Explicit `requireAccessModes` may add constraints.

```yaml
resources:
  db:
    contract: sql.postgres@v1
    requirements:
      requireAccessModes:
        - database-url
```

## 9. Native binding

Native binding exposes provider raw resource interface.

Rules:

```text
portable:
  native-binding forbidden

provider-native:
  native-binding allowed only if policy permits
```

Plan must show enforcement impact. If raw binding bypasses Takos grant enforcement, scope enforcement may be downgraded to advisory and require approval.

## 10. Workload identity and service grants

Internal calls must carry Takos-issued identity.

```ts
interface WorkloadIdentity {
  workloadAddress: string;
  appReleaseId: string;
  audience: string[];
}

interface ServiceGrant {
  caller: string;
  target: string;
  actions: string[];
  scope?: unknown;
}
```

Service binding / internal-url must verify caller identity and grant.

URL knowledge alone is not authorization.

## 11. EventSubscriptionRevision

Event subscriptions belong to AppRelease.

Types:

```text
queue
schedule
internal-event
```

Queue delivery profile must define:

```text
at-least-once delivery
visibility timeout
max retries
batch size
partial ack
DLQ
consumer overlap support
```

Schedule delivery profile must define:

```text
cron expression
timezone
delivery: at-least-once
overlap policy: forbid | allow | skip-if-running
```

During canary, event subscriptions target primaryAppReleaseId unless an explicit event canary extension is used.

## 12. Readiness

Readiness is declaration plus observation.

```ts
interface ReadinessObservation {
  objectAddress: string;
  status: "ready" | "not-ready" | "unknown";
  reason?: string;
  observedAt: string;
}
```

Examples:

```text
worker ready:
  bundle deployed
  bindings resolved
  runtime can accept request

container ready:
  image pulled
  process running
  healthcheck passing
  endpoint reachable

resource ready:
  instance available
  migration ledger readable
  required grants/bindings available
```


---

# 05. Security and Supply Chain

## 1. Purpose

This document defines security boundaries, provider execution isolation, secret handling, trust revocation, artifact provenance, mirroring, egress enforcement, redaction, and audit requirements.

## 2. ProviderPackage execution environment

ProviderPackage execution is isolated from workload runtime and build runtime.

```ts
interface ProviderExecutionEnvironment {
  packageDigest: string;
  providerTarget: string;
  credentialRefs: string[];
  networkPolicy: string;
  auditRequired: true;
}
```

Rules:

```text
ProviderPackage may access only ProviderCredentialRefs assigned to its ProviderTarget.
ProviderPackage must not access tenant runtime secrets.
ProviderPackage must not access build secrets unless explicitly granted.
ProviderPackage must emit audit events for credential use.
ProviderPackage execution must be sandboxed according to trust level and policy.
```

ProviderPackage is not just metadata. It is infrastructure-authorized execution logic.

## 3. Provider credential boundary

Provider credentials are distinct from runtime secrets and build secrets.

```text
Provider credentials:
  used by ProviderPackage to materialize infrastructure

Runtime secrets:
  injected into workloads through BindingSetRevision

Build secrets:
  allowed only for build, never provider operations by default
```

Provider credentials must be scoped, auditable, rotatable, and unavailable to workloads.

## 4. SupplyChainRecord

SupplyChainRecord connects source, build, artifact, and package resolution.

```ts
interface SupplyChainRecord {
  sourceDigest?: string;
  buildInputDigest?: string;
  buildEnvironmentDigest?: string;
  artifactDigest?: string;
  packageResolutionDigest: string;
  providerPackageDigests: string[];
  resourceContractPackageDigests: string[];
  dataContractPackageDigests?: string[];
  nativeSchemaDigests: string[];
  provenanceRef?: string;
  signatureRefs?: string[];
}
```

WorkloadRevision, PreparedPlan, ProviderMaterialization, and AppRelease may reference SupplyChainRecord.

## 5. PreparedArtifact

Prepared artifacts are immutable and content-addressed.

```ts
interface PreparedArtifactRef {
  digest: string;
  storageRef: string;
  expiresAt: string;
  sourceDigest: string;
  buildInputDigest: string;
  buildEnvironmentDigest: string;
  resolvedGraphDigest: string;
  packageResolutionDigest: string;
  provenanceRef?: string;
  signatureRef?: string;
}
```

Apply may reuse a PreparedArtifact only if:

```text
Plan read set is valid
sourceDigest matches
buildInputDigest matches
buildEnvironmentDigest matches
resolvedGraphDigest matches
packageResolutionDigest matches
artifact digest verifies
artifact has not expired
approval state is valid
```

## 6. External artifact mirroring

External image digest may disappear from external registry. Production policy may require mirroring.

```yaml
artifactPolicy:
  mirrorExternalImages: true
  retainForRollbackWindow: true
```

WorkloadRevision should record:

```text
source artifact ref
source artifact digest
mirrored artifact ref
retention deadline
provenance
package resolution digest
```

## 7. Trust revocation

Trust revocation does not mutate active state automatically.

It creates Conditions and blocks new Plans using revoked packages. Repair Plans may be created.

Revocation states:

```text
PackageDeprecated
PackageVulnerable
PackageRevoked
PackageUnsupported
TrustRevoked
```

Repair strategies:

```text
upgrade-package
rematerialize
migrate-provider
operator-override
```

## 8. Egress security

RuntimeNetworkPolicy may include:

```text
denyPrivateNetworks
DNS resolution policy
redirect policy
source identity
egress lease
provider target enforcement
```

Egress enforcement must be reported:

```text
enforced
advisory
unsupported
```

If policy requires enforcement, advisory or unsupported egress rule blocks Plan.

## 9. Secret lifecycle

Secret resolution is explicit.

```text
latest-at-activation:
  resolved when AppRelease/BindingSet activates

pinned-version:
  explicitly pinned
```

Rollback default is `re-resolve`. Rollback does not restore old secret values.

Revoked secrets used by active BindingSetRevision must produce Conditions and may trigger repair Plan.

## 10. Redaction and observability

Logs, traces, events, and support access must follow redaction policy.

Minimum redaction:

```yaml
headers:
  - Authorization
  - Cookie
env:
  - "*SECRET*"
  - "*TOKEN*"
  - "*KEY*"
```

Support access requires explicit consent window and append-only audit.

## 11. Audit integrity

Security-sensitive audit events are append-only.

Recommended event fields:

```text
actor
operation
objectAddress
planId
applyRunId
activationRecordId
providerTarget
providerCredentialRef
packageDigest
timestamp
reasonCode
```

Optional hash chaining may be used for stronger tamper evidence.

## 12. Threat model checkpoints

Minimum acceptance checks:

```text
build does not receive runtime secrets
build cannot access provider credentials
ProviderPackage cannot read runtime secrets
worker cannot read another tenant's secret
container cannot use host network in shared tenancy
egress denyPrivateNetworks blocks metadata IPs
internal service call without identity is rejected
unsupported grant scope warns or blocks according to policy
native raw binding requires approval
trust revoked package blocks new Plans
```


---

# 06. Acceptance Tests

This catalog defines testable behavior for Takos Deploy v2.

## 1. Plan and Apply

```text
Plan read set changed with must-replan -> Apply rejected.
Plan read set changed with must-revalidate -> validation reruns before phase transition.
PreparedArtifact packageResolutionDigest changed -> Apply rejected.
Long migration does not hold GroupSpecLock for entire duration.
Phase-boundary revalidation blocks revoked ProviderPackage.
Approval subjectDigest changes -> approval invalid.
```

## 2. Activation

```text
All-at-once activation creates immutable ActivationRecord.
Canary step creates new ActivationRecord.
GroupActivationPointer advances to new ActivationRecord.
Provider materialization failure does not mutate ActivationRecord.
Automatic rollback creates a new ActivationRecord.
Weighted assignments apply only to HTTP ingress.
primaryAppReleaseId controls event and publication default resolution.
```

## 3. Provider materialization

```text
ProviderMaterialization records provider target, package digest, provider object ref, and materialization status.
Observed provider drift does not change canonical Takos records.
Materialization retry uses idempotency key.
Trust revocation marks group Degraded and blocks new Plans.
RepairPlan can rematerialize with trusted package.
```

## 4. Resource contracts

```text
sql.postgres@v1 resolves through ResourceContractPackage PackageResolution.
Provider supports base contract but lacks required feature -> Plan blocked or requires feature realization.
pgvector feature can be realized through native config -> Plan shows feature realization and approval if required.
Cross-contract previousNames is dangerous and requires rebind/migration/restore Plan.
imported-bind-only resource cannot migrate.
shared-readonly resource cannot migrate.
```

## 5. Migration and restore

```text
Applied migration checksum changed -> Plan blocked.
Expand migration success followed by build failure leaves ActivationRecord unchanged.
Rollback after migration does not reverse DB state.
Restore creates ResourceInstance operation, not rollback.
Restore mode unsupported by provider -> Plan blocked.
```

## 6. Canary side effects

```text
Candidate emits new queue DataContract while primary consumer is old -> Plan blocked unless policy allows.
Candidate requires new egress destination -> RuntimeNetworkPolicy scopes access to candidate only.
Shadow traffic forbids side effects.
Canary side-effect guard reports enforcement point.
DB semantic write change with plan-only enforcement requires approval.
```

## 7. Events

```text
Queue consumer belongs to AppRelease.
Canary HTTP traffic does not automatically activate candidate queue consumer.
Schedule event targets primaryAppReleaseId.
Event subscription switch preview runs before ActivationRecord creation.
In-flight message behavior follows queue profile.
```

## 8. Publications and dependencies

```text
Producer breaking publication change creates dependent consumer Plan.
Consumer binding does not silently update without Plan unless policy allows automatic rebind.
Deployment-time publication binding cycle is blocked.
ChangeSetPlan is orchestration, not distributed transaction.
```

## 9. Runtime security

```text
Internal service call without WorkloadIdentity is rejected.
ServiceGrant is required for internal service call.
RuntimeNetworkPolicy denies private network egress when policy requires.
Egress enforcement advisory when policy requires enforced -> Plan blocked.
```

## 10. Direct deploy

```text
Direct image deploy compiles to generated AppSpec/EnvSpec.
Direct deploy never bypasses Plan/Apply/Activation.
Manifest-managed group cannot be silently mutated by direct deploy.
Direct native env flag writes EnvSpec, not AppSpec.
```

## 11. GC and retention

```text
GC refuses object with ProtectedReference.
Old WorkloadRevision retained during rollback window.
PreparedArtifact expires after policy TTL.
ProviderPackage digest retained while referenced by active or rollback-window materialization.
```

## 12. Security and supply chain

```text
Build runtime cannot access provider credentials.
ProviderPackage execution cannot access tenant runtime secrets.
Provider credential use creates audit event.
PreparedArtifact cannot be reused if packageResolutionDigest differs.
External image mirroring retains image through rollback window.
Native raw binding requires policy approval.
```
