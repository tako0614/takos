import type { ControlPlatform, PlatformConfig, PlatformServices } from './platform-config.ts';
import type { Context } from 'hono';

export function getPlatform<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): ControlPlatform<TBindings> {
  const platform = c.get('platform') as ControlPlatform<TBindings> | undefined;
  if (platform) return platform;
  const envPlatform = (c.env as { PLATFORM?: ControlPlatform<TBindings> }).PLATFORM;
  if (envPlatform) return envPlatform;
  throw new Error('Platform context missing. Entry points must inject PLATFORM explicitly.');
}

export function getPlatformConfig<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): PlatformConfig {
  return getPlatform(c).config;
}

export function getPlatformServices<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): PlatformServices {
  return getPlatform(c).services;
}
