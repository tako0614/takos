export {
  getPlatform,
  getPlatformConfig,
  getPlatformServices,
} from "./accessors.ts";

export type { PlatformContext, PlatformContextVariables } from "./context.ts";
export { getPlatformContext, setPlatformContext } from "./context.ts";

export type {
  ControlPlatform,
  PlatformConfig,
  PlatformObjects,
  PlatformQueues,
  PlatformRoutingService,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
} from "./platform-config.ts";
