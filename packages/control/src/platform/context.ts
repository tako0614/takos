import type { Context } from 'hono';
import type { ControlPlatform } from './platform-config.ts';

export type PlatformContextVariables<TBindings extends object = object> = {
  platform?: ControlPlatform<TBindings>;
};

export type PlatformContext<TBindings extends object = object> = Context<{
  Bindings: TBindings & { PLATFORM?: ControlPlatform<TBindings> };
  Variables: any;
}>;

export function setPlatformContext<TBindings extends object>(
  c: Context<{ Bindings: TBindings; Variables: any }>,
  platform: ControlPlatform<TBindings>,
): void {
  c.set('platform', platform as never);
}

export function getPlatformContext<TBindings extends object>(
  c: Context<{ Bindings: TBindings; Variables: any }>,
): ControlPlatform<TBindings> | undefined {
  const platform = c.get('platform') as ControlPlatform<TBindings> | undefined;
  if (platform) return platform;
  return (c.env as { PLATFORM?: ControlPlatform<TBindings> }).PLATFORM;
}
