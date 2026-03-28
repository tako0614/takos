// Re-export types
export type {
  AppManifest,
  AppContainer,
  AppWorker,
  AppEnvConfig,
  AppRoute,
  AppDeploymentBuildSource,
  BundleDoc,
  HealthCheck,
  LifecycleHook,
  LifecycleHooks,
  UpdateStrategy,
  ServiceBinding,
} from './app-manifest-types';

// Re-export parsing
export {
  parseAppManifestYaml,
  parseAppManifestText,
} from './app-manifest-parser';

// Re-export template engine
export {
  resolveTemplates,
  validateTemplateReferences,
  type TemplateContext,
} from './app-manifest-template';

// Re-export validation
export {
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from './app-manifest-validation';

// Re-export bundle generation and packaging
export {
  appManifestToBundleDocs,
  buildBundlePackageData,
  buildParsedPackageFromDocs,
  extractBuildSourcesFromManifestJson,
  selectAppManifestPathFromRepo,
} from './app-manifest-bundle';
