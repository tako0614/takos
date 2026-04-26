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
