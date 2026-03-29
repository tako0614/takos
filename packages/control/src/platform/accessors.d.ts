import type { ControlPlatform, PlatformConfig, PlatformServices } from './platform-config.ts';
import type { Context } from 'hono';
export declare function getPlatform<TBindings extends object>(c: Context<{
    Bindings: TBindings;
    Variables: any;
}>): ControlPlatform<TBindings>;
export declare function getPlatformConfig<TBindings extends object>(c: Context<{
    Bindings: TBindings;
    Variables: any;
}>): PlatformConfig;
export declare function getPlatformServices<TBindings extends object>(c: Context<{
    Bindings: TBindings;
    Variables: any;
}>): PlatformServices;
//# sourceMappingURL=accessors.d.ts.map