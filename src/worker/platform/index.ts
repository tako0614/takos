export {
  getPlatform,
  getPlatformConfig,
  getPlatformServices,
} from "./accessors.ts";

export type { PlatformContext, PlatformContextVariables } from "./context.ts";
export { getPlatformContext, setPlatformContext } from "./context.ts";

export type {
  CloudRunDeployBackendConfig,
  ControlPlatform,
  EcsDeployBackendConfig,
  K8sDeployBackendConfig,
  OciDeployBackendConfig,
  PlatformConfig,
  PlatformDeployBackendConfig,
  PlatformDeployBackendRegistry,
  PlatformObjects,
  PlatformQueues,
  PlatformRoutingService,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
  WorkersDispatchDeployBackendConfig,
} from "./platform-config.ts";
