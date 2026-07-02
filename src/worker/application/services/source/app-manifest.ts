// Re-export types from the flat-schema source of truth.
export type {
  AppCompute,
  AppConsume,
  AppManifest,
  AppManifestOverride,
  AppPublication,
  AppPublicationAuth,
  AppRoute,
  AppServiceBinding,
  AppServiceBindingInject,
  AppTriggers,
  ComputeKind,
  HealthCheck,
  ScheduleTrigger,
  VolumeMount,
} from "./app-manifest-types.ts";

// Re-export parsing
export {
  assertManifestInputDoesNotUseBuildMetadata,
  parseAppManifestObject,
  parseAppManifestRecord,
  parseAppManifestText,
  parseAppManifestYaml,
} from "./app-manifest-parser/index.ts";

export {
  APP_DEPLOYMENT_OUTPUT_KEY,
  APP_DEPLOYMENT_OUTPUT_KEYS,
  RUNTIME_PROJECTION_CAPABILITIES,
  TAKOS_APP_AUTH_KINDS,
  TAKOS_APP_CONTRACT_VERSION,
  TAKOS_APP_PUBLICATION_TYPES,
  TAKOS_APP_SERVICE_BINDING_CAPABILITIES,
  TAKOS_APP_SERVICE_GRANT_SCOPES,
} from "./app-interface-contract.ts";

export type {
  AppDeploymentOutputKey,
  TakosAppAuthKind,
  TakosAppContractVersion,
  TakosAppPublicationType,
  TakosAppServiceBindingCapability,
  TakosAppServiceGrantScope,
  RuntimeProjectionCapability,
} from "./app-interface-contract.ts";

export {
  APP_MANIFEST_OUTPUT_KEYS,
  parseOpenTofuAppManifestOutputs,
  selectInstallableSourcePathFromRepo,
} from "./opentofu-app-manifest.ts";

// Re-export validation
export {
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from "./app-manifest-validation.ts";
