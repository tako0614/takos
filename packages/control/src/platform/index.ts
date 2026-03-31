export {
  getPlatform,
  getPlatformConfig,
  getPlatformServices,
} from './accessors.ts';

export type {
  PlatformContextVariables,
  PlatformContext,
} from './context.ts';
export {
  setPlatformContext,
  getPlatformContext,
} from './context.ts';

export type {
  PlatformSource,
  PlatformServiceBinding,
  WorkersDispatchDeployProviderConfig,
  OciDeployProviderConfig,
  EcsDeployProviderConfig,
  CloudRunDeployProviderConfig,
  K8sDeployProviderConfig,
  PlatformDeployProviderConfig,
  PlatformDeployProviderRegistry,
  PlatformConfig,
  PlatformRoutingService,
  PlatformQueues,
  PlatformObjects,
  PlatformServices,
  ControlPlatform,
} from './platform-config.ts';
