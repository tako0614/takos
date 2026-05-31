/**
 * Default app distribution orchestration and public API surface.
 *
 * Implementation is split across:
 * - `default-app-distribution-types.ts` — shared types
 * - `default-app-validation.ts` — pure validators / normalizers
 * - `default-app-distribution-internal.ts` — error classes, cache, deps
 * - `default-app-resolution.ts` — env / DB / fallback distribution resolution
 *   and status reporting
 * - `default-app-preinstall-jobs.ts` — preinstall Installation lifecycle
 *   (apply / save / clear / enqueue / process)
 */

export {
  clearDefaultAppDistributionCache,
  defaultAppDistributionDeps,
  hasDefaultAppDistributionEnvOverride,
  invalidateDistributionCache,
  isDefaultAppDistributionConfigError,
  isDefaultAppDistributionInvalidError,
} from "./default-app-distribution-internal.ts";

export {
  getDefaultAppReconcileStatus,
  resolveDefaultAppDistribution,
  resolveDefaultAppDistributionForBootstrap,
  resolveDefaultAppInstallConfig,
  resolveStaticDefaultAppDistribution,
} from "./default-app-resolution.ts";

export {
  applyDefaultAppInstallation,
  clearDefaultAppDistributionEntries,
  enqueueDefaultAppPreinstallJob,
  preinstallDefaultAppsForSpace,
  processDefaultAppPreinstallJobs,
  saveDefaultAppDistributionEntries,
} from "./default-app-preinstall-jobs.ts";

export type {
  DefaultAppBindingSummary,
  DefaultAppBindingType,
  DefaultAppDistributionEntry,
  DefaultAppDistributionEnv,
  DefaultAppDistributionStatus,
  DefaultAppDistributionStatusSource,
  DefaultAppInstallConfig,
  DefaultAppPreinstallJobsStatus,
  DefaultAppPreinstallJobStatus,
  DefaultAppPreinstallJobSummary,
  DefaultAppReconcileStatus,
  DefaultAppRuntimeMode,
} from "./default-app-distribution-types.ts";
