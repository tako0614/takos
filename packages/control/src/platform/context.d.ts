import type { Context } from 'hono';
import type { ControlPlatform } from './platform-config.ts';
export type PlatformContextVariables<TBindings extends object = object> = {
    platform?: ControlPlatform<TBindings>;
};
export type PlatformContext<TBindings extends object = object> = Context<{
    Bindings: TBindings & {
        PLATFORM?: ControlPlatform<TBindings>;
    };
    Variables: any;
}>;
export declare function setPlatformContext<TBindings extends object>(c: Context<{
    Bindings: TBindings;
    Variables: any;
}>, platform: ControlPlatform<TBindings>): void;
export declare function getPlatformContext<TBindings extends object>(c: Context<{
    Bindings: TBindings;
    Variables: any;
}>): ControlPlatform<TBindings> | undefined;
//# sourceMappingURL=context.d.ts.map