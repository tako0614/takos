# Takos Deploy v3 v1.0 Condition Reason Catalog

This catalog gives stable reason names for CLI, API, UI, controllers, and audit.
PaaS also validates the same catalog on status projection and runtime readiness
surfaces. v3 surfaces these reasons exclusively through `Deployment.conditions[]`
(see [`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md) § 13).

The source of truth is `CORE_CONDITION_REASONS` exported by
`takos-paas-contract`. PaaS API responses and controller/status DTOs that expose
`condition.reason` must use only these values. External repos such as
`takos-cli` and `takos-app` consume the exported contract or OpenAPI schema;
they are not validated from the PaaS repository. Runtime-agent work failure text
such as `failureReason` remains free-form diagnostics and is not a Core
condition reason unless it is projected into a `Deployment.conditions[].reason`
field.

## Descriptor / Deployment resolution

```text
PlanStale
ReadSetChanged
DescriptorPinned
DescriptorChanged
DescriptorUnavailable
DescriptorUntrusted
DescriptorCompatibilityUnknown
DescriptorAliasAmbiguous
DescriptorContextChanged
DescriptorBootstrapTrustMissing
ResolvedGraphChanged
```

## Policy / Approval

```text
PolicyDenied
ApprovalRequired
ApprovalMissing
ApprovalInvalidated
BreakGlassRequired
BreakGlassDenied
```

## Binding / Secret

```text
BindingCollision
BindingResolutionFailed
BindingTargetUnsupported
InjectionModeUnsupported
AccessModeUnsupported
SecretResolutionFailed
SecretVersionRevoked
CredentialVisibilityUnsupported
CredentialRawEnvDenied
```

## Resource access

```text
AccessPathUnsupported
AccessPathAmbiguous
AccessPathMaterializationFailed
AccessPathExternalBoundaryRequiresPolicy
AccessPathCredentialBoundaryFailed
ResourceCompatibilityFailed
ResourceBindingFailed
ResourceRestoreUnsupported
ResourceRebindRequired
```

## Router / Activation

```text
ActivationCommitted
ActivationPreviewFailed
ActivationAssignmentInvalid
ActivationPrimaryMissing
RouterConfigIncompatible
RouteDescriptorIncompatible
InterfaceDescriptorIncompatible
RouterAssignmentUnsupported
RouterProtocolUnsupported
ServingMaterializing
ServingConverged
ServingDegraded
ServingConvergenceUnknown
```

## Provider materialization / observation

```text
ProviderMaterializing
ProviderMaterializationFailed
ProviderObjectMissing
ProviderConfigDrift
ProviderStatusDrift
ProviderSecurityDrift
ProviderOwnershipDrift
ProviderCacheDrift
ProviderRateLimited
ProviderCredentialDenied
ProviderPartialSuccess
ProviderOperationTimedOut
```

## Publication

```text
PublicationWithdrawn
PublicationUnavailable
PublicationResolutionFailed
PublicationProjectionFailed
PublicationRouteUnavailable
PublicationAuthUnavailable
PublicationConsumerRebindRequired
PublicationConsumerGrantMissing
PublicationOutputInjectionDenied
```

## Rollback / Repair / Artifact

```text
RollbackIncompatible
RollbackDescriptorUnavailable
RollbackArtifactUnavailable
RollbackResourceIncompatible
RepairPlanRequired
RepairMaterializationRequired
RepairAccessPathRequired
RepairPublicationProjectionRequired
ArtifactUnavailable
ArtifactRetentionMissing
```

## Runtime / Readiness

```text
RuntimeNotReady
RuntimeReadinessUnknown
RuntimeLiveRebindUnsupported
RuntimeShutdownFailed
RuntimeDrainTimeout
```
