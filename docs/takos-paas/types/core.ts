// Takos Deploy v2 Core v1.0 TypeScript surface.
//
// The implementation contract in takos-paas is the source of truth. This docs
// file intentionally re-exports that contract instead of maintaining a parallel
// handwritten model that can drift.

import type {
  CoreAccessModeRef,
  CoreAccessPathStage,
  CoreActivationAssignment,
  CoreActivationNonHttpDefaults,
  CoreActivationRecord,
  CoreApplyPhase,
  CoreAppRelease,
  CoreApprovalRecord,
  CoreAppSpec,
  CoreBindingResolutionInput,
  CoreBindingResolutionReport,
  CoreBindingSetRevision,
  CoreBindingValueResolution,
  CoreComponentSpec,
  CoreConsumeSpec,
  CoreContractInstanceSpec,
  CoreDefaultAppReleaseAssignment,
  CoreDescriptorClosure,
  CoreDescriptorDependency,
  CoreDescriptorResolution,
  CoreEnvSpec,
  CoreExposureSpec,
  CoreGroupActivationPointer,
  CoreInjectionTarget,
  CorePlan,
  CorePlannedOperation,
  CorePlanReadSetEntry,
  CorePolicyDecisionRecord,
  CorePolicySpec,
  CoreProjectionRecord,
  CoreProviderMaterialization,
  CoreProviderObservation,
  CoreProviderTargetSpec,
  CorePublicationResolution,
  CorePublicationSpec,
  CoreResolvedComponent,
  CoreResolvedContractInstance,
  CoreResolvedGraph,
  CoreResourceAccessPath,
  CoreRouteActivationAssignment,
  CoreRouteAppReleaseAssignment,
  CoreRouterConfig,
  CoreRuntimeNetworkPolicy,
} from "../../../paas/packages/paas-contract/src/core-v1.ts";

export type {
  CoreAccessModeRef,
  CoreAccessPathStage,
  CoreActivationAssignment,
  CoreActivationNonHttpDefaults,
  CoreActivationRecord,
  CoreApplyPhase,
  CoreAppRelease,
  CoreApprovalRecord,
  CoreApprovalState,
  CoreBindingResolutionInput,
  CoreBindingResolutionReport,
  CoreBindingSetRevision,
  CoreBindingValueResolution,
  CoreComponentSpec,
  CoreConditionReason,
  CoreConsumeSpec,
  CoreContractInstanceSpec,
  CoreDefaultAppReleaseAssignment,
  CoreDescriptorClosure,
  CoreDescriptorDependency,
  CoreDescriptorResolution,
  CoreEnforcement,
  CoreEnvSpec,
  CoreExposureSpec,
  CoreGroupActivationPointer,
  CoreInjectionTarget,
  CoreMaterializationStatus,
  CoreNetworkBoundary,
  CorePlan,
  CorePlanIntent,
  CorePlannedOperation,
  CorePlanReadSetEntry,
  CorePlanStatus,
  CorePolicyDecision,
  CorePolicyDecisionRecord,
  CorePolicySpec,
  CoreProjectionRecord,
  CoreProviderMaterialization,
  CoreProviderObservation,
  CoreProviderTargetSpec,
  CorePublicationResolution,
  CorePublicationSpec,
  CoreResolvedComponent,
  CoreResolvedContractInstance,
  CoreResolvedGraph,
  CoreResourceAccessPath,
  CoreRouteActivationAssignment,
  CoreRouteAppReleaseAssignment,
  CoreRouterConfig,
  CoreRuntimeNetworkPolicy,
  CoreSensitivity,
  CoreStalenessImpact,
  DescriptorId,
  Digest,
  IsoTimestamp,
  JsonObject,
  ObjectAddress,
} from "../../../paas/packages/paas-contract/src/index.ts";

export type AppSpec = CoreAppSpec;
export type EnvSpec = CoreEnvSpec;
export type PolicySpec = CorePolicySpec;
export type ComponentSpec = CoreComponentSpec;
export type ContractInstanceSpec = CoreContractInstanceSpec;
export type ExposureSpec = CoreExposureSpec;
export type ConsumeSpec = CoreConsumeSpec;
export type AccessModeRef = CoreAccessModeRef;
export type InjectionTarget = CoreInjectionTarget;
export type PublicationSpec = CorePublicationSpec;
export type ProviderTargetSpec = CoreProviderTargetSpec;
export type DescriptorResolution = CoreDescriptorResolution;
export type DescriptorDependency = CoreDescriptorDependency;
export type DescriptorClosure = CoreDescriptorClosure;
export type ResolvedGraph = CoreResolvedGraph;
export type ResolvedComponent = CoreResolvedComponent;
export type ResolvedContractInstance = CoreResolvedContractInstance;
export type ProjectionRecord = CoreProjectionRecord;
export type Plan = CorePlan;
export type PlanReadSetEntry = CorePlanReadSetEntry;
export type PlannedOperation = CorePlannedOperation;
export type PolicyDecisionRecord = CorePolicyDecisionRecord;
export type ApprovalRecord = CoreApprovalRecord;
export type ActivationRecord = CoreActivationRecord;
export type ActivationAssignment = CoreActivationAssignment;
export type RouteActivationAssignment = CoreRouteActivationAssignment;
export type RouteAppReleaseAssignment = CoreRouteAppReleaseAssignment;
export type ActivationNonHttpDefaults = CoreActivationNonHttpDefaults;
export type DefaultAppReleaseAssignment = CoreDefaultAppReleaseAssignment;
export type GroupActivationPointer = CoreGroupActivationPointer;
export type BindingSetRevision = CoreBindingSetRevision;
export type BindingValueResolution = CoreBindingValueResolution;
export type BindingResolutionReport = CoreBindingResolutionReport;
export type BindingResolutionInput = CoreBindingResolutionInput;
export type ResourceAccessPath = CoreResourceAccessPath;
export type AccessPathStage = CoreAccessPathStage;
export type ProviderMaterialization = CoreProviderMaterialization;
export type ProviderObservation = CoreProviderObservation;
export type AppRelease = CoreAppRelease;
export type RouterConfig = CoreRouterConfig;
export type RuntimeNetworkPolicy = CoreRuntimeNetworkPolicy;
export type PublicationResolution = CorePublicationResolution;
export type ApplyPhase = CoreApplyPhase;

export type LifecycleDomain = string;
export type ChangeEffect = string;
