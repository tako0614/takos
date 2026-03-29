export { createCommonEnvDeps, type CommonEnvDeps } from './service';
export { TAKOS_ACCESS_TOKEN_ENV_NAME } from './takos-builtins';
export { runCommonEnvScheduledMaintenance } from './maintenance';

// Space env operations
export {
  listSpaceCommonEnv,
  upsertSpaceCommonEnv,
  ensureSystemCommonEnv,
  deleteSpaceCommonEnv,
} from './space-env-ops';

// Service link operations
export {
  ensureRequiredServiceLinks,
  listServiceCommonEnvLinks,
  listServiceManualLinkNames,
  listServiceBuiltins,
} from './service-link-ops';

// Manual link operations
export {
  upsertServiceTakosAccessTokenConfig,
  deleteServiceTakosAccessTokenConfig,
  deleteServiceTakosAccessTokenConfigs,
  setServiceManualLinks,
  patchServiceManualLinks,
  markRequiredKeysLocallyOverriddenForService,
} from './manual-link-ops';
