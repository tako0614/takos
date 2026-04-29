# Takos Deploy v2 v1.0 Condition Reason Catalog

This catalog gives stable reason names for CLI, API, UI, controllers, and audit.

## Descriptor / Plan

```text
PlanStale
ReadSetChanged
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
