# Takos Deploy v2 v1.0 Conformance Tests

This catalog defines acceptance tests for implementations. Tests are grouped by conformance surface.

## Severity

```text
MUST    required for the relevant conformance surface
SHOULD  strongly recommended
MAY     optional
```

---

## Core conformance MUST tests

### Descriptor and Plan

- Plan MUST include a DescriptorClosure.
- Apply MUST use the Plan DescriptorClosure.
- Apply MUST NOT re-fetch descriptor URLs or remote contexts to reinterpret meaning.
- A descriptor digest change MUST make Plan stale or force revalidation according to read-set stalenessImpact.
- Ambiguous alias expansion MUST block Plan.
- Descriptor denied by PolicySpec MUST block Plan.

- Descriptors MUST be declarative; descriptors that contain arbitrary executable behavior MUST be rejected.
- Provider capability descriptors MUST NOT reinterpret contract semantics.

### ObjectAddress

- Every Plan diff object MUST have an ObjectAddress.
- Operation idempotency key MUST include object address or equivalent stable reference.
- Rename MUST NOT be inferred by name similarity.

### Activation

- ActivationRecord MUST be immutable.
- GroupActivationPointer MUST select current ActivationRecord.
- GroupActivationPointer advancement MUST be the canonical activation commit.
- ActivationRecord assignment weights MUST sum to 100.
- primaryAppReleaseId MUST be included in assignments.
- Provider convergence failure MUST NOT mutate ActivationRecord.
- RouterConfig change MUST create a new ActivationRecord.
- RuntimeNetworkPolicy change MUST create a new ActivationRecord.

- Route-specific or protocol-specific assignments, if supported, MUST be represented in ActivationRecord or an ActivationRecord-owned extension digest and MUST NOT exist only in provider state.

### Provider state

- ProviderMaterialization MUST be separate from ProviderObservation.
- Observed provider state MUST NOT become canonical desired state.
- Missing provider object MUST create condition/repair path, not silent canonical mutation.

### Rollback

- Rollback MUST NOT restore durable ResourceInstance state by default.
- Rollback MUST NOT reverse migrations by default.
- Rollback MUST use retained artifact, not source rebuild.
- Rollback MUST require descriptor digests needed to interpret retained release.

---

## Binding conformance MUST tests

- Publication output MUST NOT be injected automatically.
- New publication output MUST NOT be injected into existing BindingSetRevision.
- Resource credential MUST NOT be publication output by default.
- Provider-assigned output MUST NOT be directly injectable.
- Env target collision MUST block Plan unless runtime explicitly supports merge and precedence is declared.
- Secret or credential raw env injection MUST require contract support, grant, policy, and approval.
- BindingSetRevision structure MUST be immutable.
- BindingValueResolution MUST record resolved secret/credential version when available.
- SecretVersionRevoked MUST mark affected bindings degraded or require repair.

---

## Resource access conformance MUST tests

- ResourceAccessPath MUST be shown in Plan for each resource binding.
- AccessMode MUST be contract-scoped in canonical graph.
- Multiple valid ResourceAccessPaths MUST be selected by EnvSpec/PolicySpec or Plan MUST block with alternatives.
- ResourceAccessPath with external networkBoundary MUST satisfy RuntimeNetworkPolicy.
- Credential visibility MUST be represented for each access path stage that handles credentials.

---

## Router conformance MUST tests

- RouterConfig MUST be protocol-agnostic.
- InterfaceDescriptor and RouteDescriptor compatibility MUST be checked before activation.
- Weighted assignment unsupported by descriptor/provider MUST block Plan.
- ServingConverged MUST be separate from ActivationCommitted.
- Provider/router convergence failure MUST create ServingDegraded or equivalent condition.

---

## Publication conformance MUST tests

- PublicationResolution change MUST NOT mutate existing PublicationConsumerBinding.
- Publication withdrawal MUST prevent new consumers and stall/degrade existing consumers.
- PublicationProjection MUST NOT be ProviderMaterialization.
- Withdrawn publication MUST NOT remain discoverable as ready.
- Ambiguous short publication address MUST block Plan.

---

## Security conformance MUST tests

- Provider target credentials MUST NOT be visible to component runtime or build runtime.
- Credential injection MUST be auditable.
- Policy deny MUST NOT be overridden by approval unless break-glass is explicitly defined.
- ApprovalRecord MUST be valid only for matching subjectDigest.
- Descriptor policy bootstrap trust MUST not depend on the policy descriptor currently being evaluated.

---

## SHOULD tests

- Plan SHOULD show descriptor trust and policy decision summary.
- Plan SHOULD show materialization slot mapping.
- Plan SHOULD show BindingResolutionReport.
- Plan SHOULD show ResourceAccessPath limitations.
- Implementation SHOULD retain descriptors in Takos-controlled or immutable storage during rollback window.
- ProviderObservation SHOULD classify drift reason.

---

## MAY tests

- JSON-LD descriptors MAY be supported.
- Provider-fronted materialization MAY be supported.
- Route-specific assignments MAY be supported, but canonical desired state must be in ActivationRecord or ActivationRecord-owned extension digest.
- Advanced canary / shadow traffic MAY be supported by non-Core modules.
