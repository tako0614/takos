// Re-export types from the flat-schema source of truth.
export type {
  AppCompute,
  AppConsume,
  AppManifest,
  AppManifestOverride,
  AppPublication,
  AppRoute,
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
  APP_MANIFEST_OUTPUT_KEYS,
  parseOpenTofuAppManifestOutputs,
  selectInstallableSourcePathFromRepo,
} from "./opentofu-app-manifest.ts";

// Re-export validation
export {
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from "./app-manifest-validation.ts";
