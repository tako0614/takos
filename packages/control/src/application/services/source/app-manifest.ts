// Re-export types
export type {
  AppManifest,
  AppContainer,
  AppService,
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
  EnvironmentOverrides,
  Volume,
  WorkerScaling,
  ResourceLimits,
} from './app-manifest-types.ts';

// Re-export parsing
export {
  parseAppManifestYaml,
  parseAppManifestText,
} from './app-manifest-parser/index.ts';

// Re-export template engine
export {
  resolveTemplates,
  validateTemplateReferences,
  type TemplateContext,
} from './app-manifest-template.ts';

// Re-export validation
export {
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from './app-manifest-validation.ts';

// Re-export bundle generation and packaging
export {
  appManifestToBundleDocs,
  buildBundlePackageData,
  buildParsedPackageFromDocs,
  extractBuildSourcesFromManifestJson,
  selectAppManifestPathFromRepo,
} from './app-manifest-bundle.ts';
