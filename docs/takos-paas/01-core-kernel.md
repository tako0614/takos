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
