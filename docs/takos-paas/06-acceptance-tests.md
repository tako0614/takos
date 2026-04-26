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
