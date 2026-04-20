// Re-export types from the flat-schema source of truth.
export type {
  AppCompute,
  AppConsume,
  AppManifest,
  AppManifestOverride,
  AppPublication,
  AppRoute,
  AppTriggers,
  BuildConfig,
  BundleDoc,
  ComputeKind,
  GroupDeploymentSnapshotBuildSource,
  HealthCheck,
  ScheduleTrigger,
  VolumeMount,
} from "./app-manifest-types.ts";

// Re-export parsing
export {
  parseAppManifestText,
  parseAppManifestYaml,
} from "./app-manifest-parser/index.ts";

// Re-export validation
export {
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from "./app-manifest-validation.ts";

// Re-export bundle generation and packaging
export {
  appManifestToBundleDocs,
  buildBundlePackageData,
  buildParsedPackageFromDocs,
  extractBuildSourcesFromManifestJson,
  selectAppManifestPathFromRepo,
} from "./app-manifest-bundle.ts";
