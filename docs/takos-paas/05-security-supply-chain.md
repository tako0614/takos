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
