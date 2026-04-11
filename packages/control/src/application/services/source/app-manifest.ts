// Re-export types from the flat-schema source of truth.
export type {
  AppCompute,
  AppConsume,
  AppContainer,
  AppDeploymentBuildSource,
  AppFileHandler,
  AppManifest,
  AppManifestOverride,
  AppMcpServer,
  AppPublication,
  AppResource,
  AppRoute,
  AppService,
  AppStorage,
  AppTriggers,
  AppWorker,
  BuildConfig,
  BundleDoc,
  ComputeKind,
  HealthCheck,
  QueueTrigger,
  ScheduleTrigger,
  StorageType,
  VolumeMount,
} from "./app-manifest-types.ts";

// Re-export parsing
export {
  parseAppManifestText,
  parseAppManifestYaml,
} from "./app-manifest-parser/index.ts";

// Re-export template engine
export {
  resolveTemplates,
  type TemplateContext,
  validateTemplateReferences,
} from "./app-manifest-template.ts";

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
