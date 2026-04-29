// Takos Deploy v2 Core v1.0 TypeScript types.
// This file is intentionally implementation-neutral. Concrete descriptor schemas,
// provider APIs, runtime contracts, resource contracts, and authoring shorthands live outside Core.

export type ObjectAddress = string;
export type DescriptorId = string; // canonical URI
export type Digest = `sha256:${string}` | string;

export type LifecycleDomain =
  | "revisioned-runtime"
  | "durable-state"
  | "declaration-output"
  | "payload-schema"
  | "external-reference"
  | string;

export type ChangeEffect =
  | "app-release"
  | "router-config"
  | "runtime-network-policy"
  | "resource-instance"
  | "binding-set"
  | "publication-binding"
  | "provider-materialization"
  | "plan-only";

export interface AppSpec {
  apiVersion: string;
  kind: "App";
  name: string;
  components: Record<string, ComponentSpec>;
  exposures?: Record<string, ExposureSpec>;
  consumes?: Record<string, ConsumeSpec>;
  publications?: Record<string, PublicationSpec>;
  requirements?: Record<string, unknown>;
}

export interface EnvSpec {
  apiVersion: string;
  kind: "Environment";
  providerTargets?: Record<string, ProviderTargetSpec>;
  router?: Record<string, unknown>;
  runtimeNetworkPolicy?: Record<string, unknown>;
  accessPathPreferences?: Record<string, unknown>;
}

export interface PolicySpec {
  apiVersion: string;
  kind: "Policy";
  descriptorPolicy?: Record<string, unknown>;
  bindingPolicy?: Record<string, unknown>;
  routerPolicy?: Record<string, unknown>;
  resourcePolicy?: Record<string, unknown>;
  approvals?: Record<string, unknown>;
}

export interface ComponentSpec {
  contracts: Record<string, ContractInstanceSpec>;
  consumes?: Record<string, ConsumeSpec>;
  requirements?: Record<string, unknown>;
  previousAddresses?: ObjectAddress[];
}

export interface ContractInstanceSpec {
  ref: string; // authoring alias or canonical URI
  config?: unknown;
}

export interface ExposureSpec {
  target: {
    component: string;
    contract: string;
  };
  visibility?: "public" | "internal" | string;
}

export interface ConsumeSpec {
  resource?: string;
  publication?: string;
  secret?: string;
  access?: AccessModeRef | string;
  inject?: InjectionTarget;
  outputs?: Record<string, { inject: InjectionTarget }>;
}

export interface AccessModeRef {
  contract: string;
  mode: string;
}

export interface InjectionTarget {
  mode: string;
  target: string;
}

export interface PublicationSpec {
  contract: string;
  source?: unknown;
  outputs?: Record<string, unknown>;
}

export interface ProviderTargetSpec {
  provider: string;
  region?: string;
  config?: Record<string, unknown>;
}

export interface DescriptorResolution {
  id: DescriptorId;
  alias?: string;
  documentUrl?: string;
  mediaType: string;
  rawDigest: Digest;
  expandedDigest?: Digest;
  contextDigests?: Digest[];
  canonicalization?: {
    algorithm: string;
    version: string;
  };
  policyDecisionId: string;
  resolvedAt: string;
}

export interface DescriptorDependency {
  fromDescriptorId: DescriptorId;
  toDescriptorId: DescriptorId;
  reason:
    | "jsonld-context"
    | "schema"
    | "compatibility-rule"
    | "permission-scope"
    | "resolver"
    | "shape-derivation"
    | "access-mode"
    | "policy"
    | string;
}

export interface DescriptorClosure {
  id: string;
  digest: Digest;
  resolutions: DescriptorResolution[];
  dependencies?: DescriptorDependency[];
  createdAt: string;
}

export interface ChangeEffectRule {
  path: string; // JSON pointer
  effect: ChangeEffect;
}

export interface ResolvedGraph {
  id: string;
  digest: Digest;
  appSpecDigest: Digest;
  envSpecDigest: Digest;
  policySpecDigest: Digest;
  descriptorClosureDigest: Digest;
  components: ResolvedComponent[];
  projections?: ProjectionRecord[];
}

export interface ResolvedComponent {
  address: ObjectAddress;
  contractInstances: ResolvedContractInstance[];
  shapeRefs?: string[];
}

export interface ResolvedContractInstance {
  address: ObjectAddress;
  localName: string;
  descriptorId: DescriptorId;
  descriptorDigest: Digest;
  configDigest?: Digest;
  lifecycleDomain?: LifecycleDomain;
  changeEffects?: ChangeEffectRule[];
}

export interface ProjectionRecord {
  projectionType: string;
  objectAddress: ObjectAddress;
  sourceComponentAddress: ObjectAddress;
  sourceContractInstance: string;
  descriptorResolutionId: string;
  digest: Digest;
}

export interface Plan {
  id: string;
  intent:
    | "deploy"
    | "update"
    | "rollback"
    | "restore"
    | "repair"
    | "uninstall"
    | "rebind"
    | "network-update"
    | string;
  groupId: string;
  descriptorClosureId: string;
  resolvedGraphDigest: Digest;
  status: "valid" | "invalid" | "stale" | "expired" | "superseded";
  approvalState: "not_required" | "required" | "approved" | "rejected" | "expired";
  readSet: PlanReadSetEntry[];
  operations: PlannedOperation[];
  policyDecisions: PolicyDecisionRecord[];
  bindingReports?: BindingResolutionReport[];
  blockers?: string[];
  warnings?: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface PlanReadSetEntry {
  objectType: string;
  objectId: string;
  version?: string | number;
  digest?: Digest;
  stalenessImpact: "must-replan" | "must-revalidate" | "warning-only";
}

export interface PlannedOperation {
  kind: string;
  objectAddress: ObjectAddress;
  desiredDigest?: Digest;
  dependsOn?: string[];
  risk?: "safe" | "attention" | "dangerous" | "blocked";
}

export interface ApplyRun {
  id: string;
  planId: string;
  groupId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted" | "stalled";
  phases: ApplyPhase[];
  startedAt?: string;
  finishedAt?: string;
}

export interface ApplyPhase {
  id: string;
  applyRunId: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  revalidationRequired: boolean;
}

export interface OperationRun {
  id: string;
  applyRunId: string;
  phaseId: string;
  kind: string;
  objectAddress: ObjectAddress;
  idempotencyKey: string;
  status: "pending" | "running" | "succeeded" | "failed" | "retrying" | "cancelled";
  desiredDigest?: Digest;
}

export interface AppRelease {
  id: string;
  groupId: string;
  resolvedGraphDigest: Digest;
  componentRevisionRefs: string[];
  bindingSetRevisionRefs: string[];
  status: "preparing" | "ready" | "failed" | "retired";
}

export interface RouterConfig {
  id: string;
  groupId: string;
  routeRefs: string[];
  status: "preparing" | "ready" | "failed" | "retired";
}

export interface RuntimeNetworkPolicy {
  id: string;
  groupId: string;
  policyDigest: Digest;
  status: "preparing" | "ready" | "failed" | "retired";
}

export interface ActivationRecord {
  id: string;
  groupId: string;
  routerConfigId: string;
  runtimeNetworkPolicyId: string;
  primaryAppReleaseId: string;
  assignments: ActivationAssignment[];
  createdAt: string;
}

export interface ActivationAssignment {
  appReleaseId: string;
  weight: number;
  labels?: Record<string, string>;
}

export interface GroupActivationPointer {
  groupId: string;
  currentActivationRecordId: string;
  generation: number;
  updatedAt: string;
}

export interface BindingSetRevision {
  id: string;
  groupId: string;
  componentAddress: ObjectAddress;
  structureDigest: Digest;
  inputs: BindingResolutionInput[];
}

export interface BindingValueResolution {
  bindingSetRevisionId: string;
  bindingName: string;
  sourceAddress: string;
  resolutionPolicy: "latest-at-activation" | "pinned-version" | "latest-at-invocation";
  resolvedVersion?: string;
  resolvedAt: string;
  sensitivity: "public" | "internal" | "secret" | "credential";
}

export interface BindingResolutionReport {
  componentAddress: ObjectAddress;
  bindingSetRevisionId?: string;
  inputs: BindingResolutionInput[];
  blockers: string[];
  warnings: string[];
}

export interface BindingResolutionInput {
  bindingName: string;
  source: "resource" | "publication" | "secret" | "provider-output";
  sourceAddress: string;
  access?: AccessModeRef;
  injection: InjectionTarget;
  sensitivity: "public" | "internal" | "secret" | "credential";
  enforcement: "enforced" | "advisory" | "unsupported";
}

export interface ResourceInstance {
  id: string;
  groupId?: string;
  contractId: DescriptorId;
  contractDigest: Digest;
  origin: "managed" | "imported-managed" | "imported-bind-only" | "external";
  sharingMode: "exclusive" | "shared-readonly" | "shared-managed";
  status: "preparing" | "ready" | "failed" | "retired" | "orphaned";
}

export interface ResourceBinding {
  id: string;
  claimAddress: ObjectAddress;
  instanceId: string;
  role: "owner" | "consumer" | "readonly-consumer" | "schema-owner" | "bind-only" | string;
}

export interface ResourceAccessPath {
  id: string;
  resourceBindingId: string;
  componentAddress: ObjectAddress;
  access: AccessModeRef;
  injection: InjectionTarget;
  stages: AccessPathStage[];
  networkBoundary: "internal" | "provider-internal" | "external";
  enforcement: "enforced" | "advisory" | "unsupported";
  limitations?: string[];
}

export interface AccessPathStage {
  kind: string;
  role?: "access-mediator" | "resource-host" | "credential-source";
  materializationRef?: string;
  providerTarget?: string;
  owner?: "takos" | "provider" | "operator";
  lifecycle?: "per-component" | "per-resource" | "shared";
  readiness?: "required" | "optional";
  credentialBoundary?: "none" | "provider-credential" | "resource-credential";
  credentialVisibility?: "consumer-runtime" | "mediator-only" | "provider-only" | "control-plane-only" | "none";
}

export interface PublicationResolution {
  id: string;
  publicationAddress: ObjectAddress;
  resolverDescriptorId: DescriptorId;
  inputDigests: Digest[];
  outputDigest: Digest;
  values: Record<string, PublicationOutputValue>;
}

export type PublicationOutputValue =
  | { valueType: "url"; value: string }
  | { valueType: "endpoint"; host: string; port?: number; protocol?: string }
  | { valueType: "secret-ref"; secretRef: string }
  | { valueType: "json"; value: unknown }
  | { valueType: "string"; value: string };

export interface PublicationConsumerBinding {
  id: string;
  consumerGroupId: string;
  publicationAddress: ObjectAddress;
  bindingSetRevisionId: string;
  outputs: Record<string, InjectionTarget>;
}

export interface PublicationProjection {
  publicationAddress: string;
  projectionKind: string;
  status: "ready" | "degraded" | "failed" | "withdrawn";
  conditions: Condition[];
}

export interface ProviderMaterialization {
  id: string;
  role: "router" | "runtime" | "resource" | "access";
  desiredObjectRef: string;
  providerTarget: string;
  objectAddress: ObjectAddress;
  createdByOperationId: string;
}

export interface ProviderObservation {
  materializationId: string;
  observedState: "present" | "missing" | "drifted" | "unknown";
  driftReason?:
    | "provider-object-missing"
    | "config-drift"
    | "status-drift"
    | "security-drift"
    | "ownership-drift"
    | "cache-drift";
  observedDigest?: Digest;
  observedAt: string;
}

export interface PolicyDecisionRecord {
  id: string;
  gateGroup: "resolution" | "planning" | "execution" | "recovery";
  gate:
    | "descriptor-resolution"
    | "authoring-expansion"
    | "graph-projection"
    | "provider-selection"
    | "binding-resolution"
    | "access-path-selection"
    | "operation-planning"
    | "activation-preview"
    | "apply-phase-revalidation"
    | "repair-planning"
    | "rollback-planning"
    | string;
  decision: "allow" | "deny" | "require-approval";
  ruleRef?: string;
  subjectAddress?: ObjectAddress;
  subjectDigest: Digest;
  decidedAt: string;
}

export interface ApprovalRecord {
  policyDecisionId: string;
  subjectDigest: Digest;
  approvedBy: string;
  approvedAt: string;
}

export interface Condition {
  type: string;
  status: boolean | "true" | "false" | "unknown";
  reason: string;
  message?: string;
  observedAt?: string;
}
