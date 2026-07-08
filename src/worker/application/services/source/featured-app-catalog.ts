/**
 * Featured app catalog orchestration and public API surface.
 *
 * Implementation is split across:
 * - `featured-app-catalog-types.ts` — shared types
 * - `featured-app-validation.ts` — pure validators / normalizers
 * - `featured-app-catalog-internal.ts` — error classes, cache, deps
 * - `featured-app-resolution.ts` — env / DB / fallback catalog resolution
 *   and status reporting
 * - `featured-app-preinstall-jobs.ts` — operator-enabled preinstall Capsule lifecycle
 *   (apply / save / clear / enqueue / process)
 */

export {
  clearFeaturedAppCatalogCache,
  featuredAppCatalogDeps,
  hasFeaturedAppCatalogEnvOverride,
  invalidateCatalogCache,
  isFeaturedAppCatalogConfigError,
  isFeaturedAppCatalogInvalidError,
} from "./featured-app-catalog-internal.ts";

export {
  getFeaturedAppReconcileStatus,
  resolveFeaturedAppCatalog,
  resolveFeaturedAppCatalogForBootstrap,
  resolveFeaturedAppInstallConfig,
  resolveStaticFeaturedAppCatalog,
} from "./featured-app-resolution.ts";

export {
  applyFeaturedAppInstallation,
  clearFeaturedAppCatalogEntries,
  enqueueFeaturedAppPreinstallJob,
  preinstallFeaturedAppsForSpace,
  processFeaturedAppPreinstallJobs,
  saveFeaturedAppCatalogEntries,
} from "./featured-app-preinstall-jobs.ts";

export type {
  FeaturedAppServiceBindingSummary,
  FeaturedAppServiceBindingType,
  FeaturedAppCatalogEntry,
  FeaturedAppCatalogEnv,
  FeaturedAppCatalogStatus,
  FeaturedAppCatalogStatusSource,
  FeaturedAppInstallConfig,
  FeaturedAppPreinstallJobsStatus,
  FeaturedAppPreinstallJobStatus,
  FeaturedAppPreinstallJobSummary,
  FeaturedAppReconcileStatus,
  FeaturedAppRuntimeMode,
} from "./featured-app-catalog-types.ts";
