# 07. Settled Operational Semantics

This section fixes the operational decisions that are easy to leave ambiguous after the core architecture is defined.

The goal is not to add new primitives. The goal is to decide how the existing primitives behave at the edges: convergence, publication withdrawal, credential lifecycle, emergency rollback, idempotency, module conformance, and user-facing readiness.

## 1. Canonical activation vs observed serving

ActivationRecord is canonical desired HTTP serving assignment. It is not proof that a provider, gateway, proxy, cache, registry projection, or DNS layer has converged.

User-facing status must distinguish canonical activation from observed convergence.

```text
ActivationCommitted:
  GroupActivationPointer references an ActivationRecord.
  Takos canonical desired state has advanced.

ServingConverged:
  provider/gateway/cache observation agrees with the current ActivationRecord.

ServingDegraded:
  ActivationRecord exists, but provider materialization, gateway, DNS, or route cache has not converged.
```

Summary status must be layered rather than collapsed into one `ready` bit.

```ts
interface GroupSummaryStatus {
  desired: "ready" | "reconciling" | "stalled" | "degraded";
  serving: "not-activated" | "activation-committed" | "converged" | "degraded";
  dependencies: "ready" | "pending" | "degraded";
  security: "ready" | "warning" | "blocked";
}
```

Rules:

```text
1. ActivationCommitted does not imply ServingConverged.
2. ServingConverged requires ProviderMaterialization and observed provider state to match the current ActivationRecord.
3. Publication projections and consumer bindings affect dependencies status, not ActivationRecord itself.
4. Trust revocation or secret revocation affects security status.
```

## 2. Condition ownership

Conditions must have stable owners. Multiple controllers must not write the same condition type for the same object without an ownership rule.

```ts
interface ConditionOwnership {
  conditionType: string;
  owner:
    | "plan-controller"
    | "apply-controller"
    | "activation-controller"
    | "route-controller"
    | "provider-observer"
    | "publication-controller"
    | "projection-controller"
    | "security-controller"
    | "resource-controller"
    | "event-controller";
}
```

Default ownership:

```text
ActivationCommitted      -> activation-controller
ServingConverged         -> provider-observer
MaterializationFailed    -> provider-observer
RouteResolved            -> route-controller
PublicationReady         -> publication-controller
ProjectionReady          -> projection-controller
ConsumerBindingsReady    -> publication-controller
TrustRevoked             -> security-controller
SecretRevoked            -> security-controller
ResourceReady            -> resource-controller
MigrationRunning         -> resource-controller
EventSubscriptionReady   -> event-controller
```

## 3. RuntimeNetworkPolicy selector grammar

RuntimeNetworkPolicy rules must be workload-scoped and assignment-aware. This prevents candidate releases from broadening egress or service permissions for primary releases during canary.

```ts
interface RuntimeSelector {
  workload?: string;             // ObjectAddress, e.g. app.workload:api
  workloadLabels?: Record<string, string>;
  assignment?: "primary" | "candidate" | "all";
}
```

Assignment is computed from ActivationRecord:

```text
primary:
  appReleaseId == ActivationRecord.primaryAppReleaseId

candidate:
  appReleaseId is assigned in ActivationRecord but is not primaryAppReleaseId

all:
  both primary and candidate assignments
```

Example:

```yaml
egressRules:
  - match:
      workload: app.workload:api
      assignment: primary
    allow:
      - scheme: https
        host: api.stripe.com
        ports: [443]

  - match:
      workload: app.workload:api
      assignment: candidate
    allow:
      - scheme: https
        host: sandbox.stripe.com
        ports: [443]
```

Policy rule:

```text
A rule without match.assignment applies to all assignments only if PolicySpec allows broad egress rules.
```

## 4. Egress enforcement report

Egress rules must report whether enforcement is real.

```ts
interface EgressPolicySatisfactionReport {
  ruleId: string;
  providerTarget: string;
  enforcement: "enforced" | "advisory" | "unsupported";
  limitations: string[];
}
```

If PolicySpec requires enforced egress, advisory or unsupported rules must block the Plan.

```text
denyPrivateNetworks=true with unsupported enforcement -> Plan blocked
external-api allowlist with advisory enforcement -> warning or block according to PolicySpec
```

## 5. Canary side-effect enforcement

Canary checks are not just Plan assertions. Each side-effect class must declare its enforcement level.

```ts
interface CanarySideEffectEnforcement {
  sideEffect:
    | "queue:new-schema"
    | "object-store:new-prefix"
    | "publication:new-version"
    | "external-api:new-destination"
    | "internal-service:new-contract"
    | "db:semantic-write-change";

  enforcement: "enforced" | "advisory" | "plan-only" | "unsupported";

  enforcementPoint:
    | "binding-wrapper"
    | "runtime-network-policy"
    | "service-identity"
    | "publication-resolver"
    | "plan-validation"
    | "unsupported";
}
```

Default expectations:

```text
queue emit:
  enforceable by queue binding wrapper when queue profile supports DataContract checks

object-store write:
  enforceable by object-store binding wrapper for prefix/key-family rules

external API call:
  enforceable by RuntimeNetworkPolicy when provider target supports enforced egress

internal service call:
  enforceable by WorkloadIdentity + ServiceGrant

publication version change:
  enforceable by PublicationResolver / PublicationBinding

DB semantic write change:
  plan-only by default; requires author assertion and optional test evidence
```

DB semantic side-effect compatibility is not fully inferable by Takos. Takos may validate migration compatibility and SQL access mode, but app-level write semantics require explicit assertion or configured tests.

## 6. Shadow traffic vs live canary

Live canary and shadow traffic are separate modes.

```text
live canary:
  candidate release can serve user response and may produce allowed side effects.

shadow traffic:
  candidate release observes mirrored requests.
  candidate response is discarded.
  side effects are forbidden unless explicitly gated.
```

Shadow traffic must not be represented as an ActivationRecord assignment. It is represented as TrafficExperiment.

```ts
interface TrafficExperiment {
  mode: "shadow" | "live-canary";
  sourceAppReleaseId: string;
  candidateAppReleaseId: string;
  sampleRate: number;
  sideEffects: "forbidden" | "allowed" | "gated";
}
```

## 7. Publication rebind policy

Publication changes must not silently mutate existing consumer BindingSetRevisions.

Automatic rebind is allowed only by policy and still creates a new BindingSetRevision.

```ts
interface PublicationRebindPolicy {
  default: "plan-required" | "automatic-if-safe";
  allowAutomaticFor: Array<
    | "non-secret-output-added"
    | "route-url-change-same-contract"
    | "backward-compatible-data-contract"
  >;
  requireApprovalFor: Array<
    | "secret-output-added"
    | "credential-output"
    | "major-contract-change"
    | "data-contract-breaking-change"
  >;
}
```

Rules:

```text
1. New publication outputs are never injected into existing consumer BindingSetRevisions.
2. Automatic rebind may create a new BindingSetRevision only if policy allows it.
3. Secret outputs always require explicit injection and approval unless PolicySpec explicitly says otherwise.
4. Producer activation may be blocked by policy until required consumer rebind Plans are accepted.
```

## 8. Publication withdrawal

Removing a PublicationDeclaration from the producer manifest withdraws the publication. It does not automatically rewrite consumer specs.

```text
Publication withdrawn:
  new consumers cannot bind
  existing consumer bindings become Stalled / PublicationWithdrawn
  consumer must deploy, rebind, or remove the consume edge
```

Secret-bearing publication withdrawal must also evaluate credential lifecycle.

```ts
interface PublicationWithdrawalPolicy {
  existingConsumers: "stall" | "auto-remove-if-policy-allows";
  credentialOutputs: "revoke" | "retain-disabled" | "retain-until-consumer-unbind";
}
```

Producer uninstall must withdraw all managed publications and create dependent consumer rebind/remove Plans when consumers exist.

## 9. Built-in credential publication lifecycle

Built-in publications such as `takos.api-key@v1` and `takos.oauth-client@v1` may create credentials or client registrations. They need lifecycle rules.

```ts
interface BuiltinCredentialPublicationLifecycle {
  onConsumerUnbind: "revoke" | "disable" | "retain";
  onConsumerUninstall: "revoke" | "disable" | "retain";
  onRollback: "re-resolve" | "reuse-pinned-version";
  rotation: "supported" | "unsupported";
}
```

Default:

```text
onConsumerUnbind: revoke
onConsumerUninstall: revoke
onRollback: re-resolve
rotation: supported when provider supports it
```

Generated credentials must be represented as secret-ref outputs by default.

## 10. Secret publication output boundary

Secret publication outputs are not plain strings by default.

```text
Preferred output value type:
  secret-ref

Exceptional output value type:
  raw secret string, only if contract and policy allow credential:read
```

A consumer binding resolves a secret-ref through SecretBindingRef.

```ts
interface PublicationOutputInjection {
  inject: {
    env?: string;
    binding?: string;
    secretRef?: string;
  };
  valueType: "string" | "url" | "json" | "secret-ref" | "service";
}
```

Raw secret-to-env injection requires:

```text
PublicationContract allows raw credential output
PublicationConsumerGrant includes credential:read
PolicySpec permits raw secret injection
Plan approval is present
```

## 11. PublicationProjection

Publication projection is distinct from ProviderMaterialization.

```text
ProviderMaterialization:
  provider infrastructure object reference

PublicationProjection:
  internal registry/discovery projection derived from publication state
```

```ts
interface PublicationProjection {
  publicationAddress: string;
  projectionKind:
    | "mcp-registry"
    | "file-handler-discovery"
    | "ui-surface-registry"
    | "webhook-catalog";
  status: "ready" | "degraded" | "failed";
  conditions: Condition[];
}
```

Examples:

```text
MCP registry entry
FileHandler discovery entry
UI surface registry entry
Webhook endpoint catalog entry
```

Projection health must account for route resolution, auth secret resolution, provider materialization, and publication binding readiness.

## 12. PublicationContract portability impact

Publication contracts may themselves be provider-native.

```ts
interface PublicationContractDescriptor {
  ref: string;
  portabilityImpact: "portable" | "provider-native-required";
}
```

Rules:

```text
1. portable AppSpec may use only portable publication contracts.
2. provider-native publication contracts require portability.mode = provider-native.
3. Plan must show provider-native publication dependencies.
```

## 13. Contract revocation impact on publications and data contracts

Trust revocation applies to PublicationContractPackage and DataContractPackage as well as ProviderPackage and ResourceContractPackage.

```text
PublicationContract revoked:
  producer publication condition -> ContractRevoked
  consumer binding condition -> ConsumesRevokedContract
  new binding Plans -> blocked
  repair Plan required

DataContract revoked:
  producer/consumer compatibility evidence invalidated
  new canary Plans using the contract -> blocked
  active groups -> Degraded / DataContractRevoked
```

Revocation must not mutate active ActivationRecord. It records conditions and blocks new unsafe Plans.

## 14. DataContract required conditions

DataContract is required when payload shape crosses a deployment or trust boundary.

Required:

```text
cross-group publication
queue/event consumed by another workload or group
canary candidate may emit events or payloads
internal service consumed across group boundary
object-store payload consumed by another app or release
webhook payload consumed by external systems
```

Optional:

```text
single workload internal implementation detail
same-release private local payload
non-shared debug output
```

When required DataContract is missing, Plan must block or require explicit policy override.

## 15. ChangeSetPlan partial success

ChangeSetPlan is orchestration, not a distributed transaction.

```text
ChangeSetPlan coordinates group-local Plans.
Each group advances its own GroupActivationPointer.
Global atomic activation is not guaranteed.
```

```ts
interface ChangeSetPlanStatus {
  status:
    | "valid"
    | "running"
    | "partially-applied"
    | "succeeded"
    | "failed"
    | "cancelled";
  completedGroupPlans: string[];
  failedGroupPlans: string[];
}
```

Failure strategies:

```text
stop:
  stop at first failed dependency barrier

continue-independent:
  continue group Plans that do not depend on the failed group

compensating-plans-required:
  stop and require explicit repair / rollback / rebind Plans
```

## 16. Emergency rollback during long Apply

Long-running Apply operations must not prevent emergency rollback by default, but rollback is allowed only when safety checks pass.

Emergency rollback can acquire ActivationLock if:

```text
1. target AppRelease is compatible with current ResourceInstance state.
2. current ResourceMigrationLock is not in a non-resumable activation-blocking phase.
3. current ApplyRun can be interrupted by policy.
4. target ActivationRecord / NetworkConfig / RuntimeNetworkPolicy passes preview validation.
```

The interrupted ApplyRun must transition to one of:

```text
interrupted
cancelled
stalled
failed
```

It must not continue to ActivationRecord creation after emergency rollback unless explicitly resumed and revalidated.

## 17. Operation idempotency key derivation

Each OperationSemantics must define idempotency key derivation.

Default form:

```text
idempotencyKey = applyRunId + operationKind + objectAddress + desiredDigest
```

Special cases:

```text
migration operation:
  resourceInstanceId + migrationId + checksum

activation.create:
  groupId + activationRecordDigest

provider.materialize:
  providerTarget + providerObjectKind + objectAddress + desiredDigest

publication.rebind:
  consumerGroupId + publicationAddress + bindingDigest

resource.restore:
  resourceInstanceId + restoreSourceDigest + targetMode
```

A retry must reuse the same idempotency key. Changing the desired digest creates a new operation.

## 18. Provider operation failure reasons

Provider operation failures must use stable reason codes.

```text
ProviderCredentialDenied
ProviderRateLimited
ProviderPartialSuccess
ProviderObjectConflict
ProviderPackageExecutionFailed
ProviderPackageTrustRevokedDuringRun
ProviderOperationTimedOut
ProviderUnsupportedOperation
ProviderObservedDrift
```

Every ProviderOperation failure must include:

```text
provider target
provider package digest
operation kind
idempotency key
retryability
observed provider reference if known
```

## 19. Resource restore and rebind

Restore is not rollback. Restore is a ResourceInstance operation.

When restore creates a new instance and ResourceBinding changes, runtime bindings change too.

```text
Resource restore-to-new-instance
  -> new ResourceInstance
  -> ResourceBinding switch
  -> new BindingSetRevision
  -> usually new AppRelease
  -> new ActivationRecord after compatibility checks
```

NetworkConfig may be reused if HTTP ingress does not change.

Plan must show:

```text
ResourceBinding old instance -> restored instance
BindingSetRevision changes
AppRelease required or not
rollback/restore limitations
```

## 20. Module conformance tiers

Takos Deploy v2 implementations may claim module conformance.

```text
Core Conformant:
  Plan / Apply / Activation / ResourceInstance / ProviderMaterialization basics

Registry Conformant:
  ProviderPackage / ResourceContractPackage / DataContractPackage / PublicationContractPackage / PackageResolution

Publication Module Conformant:
  PublicationBinding / PublicationConsumerBinding / PublicationProjection / grants / withdrawal

Provider-Native Module Conformant:
  providerNative config / NativeSchema / ProviderPackage execution / ProviderMaterialization

Canary Module Conformant:
  weighted HTTP ActivationRecord / RolloutRun / side-effect policy

ChangeSet Module Conformant:
  multi-group orchestration / DependencyGraph / partial success semantics

Security Module Conformant:
  Provider execution isolation / trust revocation / secret handling / audit / redaction
```

Implementations must advertise supported modules. Optional modules must not be silently assumed.

## 21. Acceptance test severity

Acceptance tests must be classified.

```text
MUST:
  required for the claimed conformance tier

SHOULD:
  recommended; failure must be documented

MAY:
  optional extension behavior
```

Examples:

```text
MUST for Core:
  Plan stale rejection
  ActivationRecord immutability
  provider state not canonical
  rollback does not restore DB

MUST for Publication Module:
  no implicit publication injection
  ambiguous short publication blocked
  publication withdrawal stalls consumers

MUST for Security Module:
  build cannot read provider credential
  provider package cannot read tenant secret
  trust revoked package blocks new Plans

SHOULD for Canary Module:
  candidate DB semantic side-effect assertion checked
  shadow traffic forbids side effects
```
