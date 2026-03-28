import type { Context } from 'hono';
import type { ControlPlatform } from './platform-config.ts';

export type PlatformContextVariables<TBindings extends object = object> = {
  platform?: ControlPlatform<TBindings>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must accept any Variables shape from callers
export type PlatformContext<TBindings extends object = object> = Context<{
  Bindings: TBindings & { PLATFORM?: ControlPlatform<TBindings> };
  Variables: any;
}>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Hono Context regardless of Variables shape
export function setPlatformContext<TBindings extends object>(
  c: Context<{ Bindings: TBindings; Variables: any }>,
  platform: ControlPlatform<TBindings>,
): void {
  c.set('platform', platform as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Hono Context regardless of Variables shape
export function getPlatformContext<TBindings extends object>(
  c: Context<{ Bindings: TBindings; Variables: any }>,
): ControlPlatform<TBindings> | undefined {
  const platform = c.get('platform') as ControlPlatform<TBindings> | undefined;
  if (platform) return platform;
  return (c.env as { PLATFORM?: ControlPlatform<TBindings> }).PLATFORM;
}
