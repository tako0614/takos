import type { ControlPlatform, PlatformConfig, PlatformServices, PlatformServiceBinding } from './platform-config.ts';
import type { Context } from 'hono';
import type {
  DurableNamespaceBinding,
  ObjectStoreBinding,
  QueueBinding,
  SqlDatabaseBinding,
} from '../shared/types/bindings.ts';

export function getPlatform<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): ControlPlatform<TBindings> {
  const platform = c.get('platform') as ControlPlatform<TBindings> | undefined;
  if (platform) return platform;
  const envPlatform = (c.env as { PLATFORM?: ControlPlatform<TBindings> }).PLATFORM;
  if (envPlatform) return envPlatform;
  throw new Error('Platform context missing. Entry points must inject PLATFORM explicitly.');
}

export function getPlatformBindings<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): TBindings {
  return getPlatform(c).bindings;
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

export function getPlatformService<
  TBindings extends object,
  TKey extends keyof PlatformServices,
>(
  c: Context<{ Bindings: TBindings; Variables: any }>,
  key: TKey,
): PlatformServices[TKey] {
  return getPlatformServices(c)[key];
}

export function getPlatformSqlBinding<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): SqlDatabaseBinding | undefined {
  return getPlatformServices(c).sql?.binding;
}

export function getPlatformSessionStore<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): DurableNamespaceBinding | undefined {
  return getPlatformServices(c).notifications.sessionStore;
}

export function getPlatformRunNotifier<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): DurableNamespaceBinding | undefined {
  return getPlatformServices(c).notifications.runNotifier;
}

export function getPlatformRuntimeHost<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): PlatformServiceBinding | undefined {
  return getPlatformServices(c).hosts.runtimeHost;
}

export function getPlatformExecutorHost<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): PlatformServiceBinding | undefined {
  return getPlatformServices(c).hosts.executorHost;
}

export function getPlatformBrowserHost<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): PlatformServiceBinding | undefined {
  return getPlatformServices(c).hosts.browserHost;
}

export function getPlatformGitObjects<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): ObjectStoreBinding | undefined {
  return getPlatformServices(c).objects.gitObjects;
}

export function getPlatformTenantSource<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): ObjectStoreBinding | undefined {
  return getPlatformServices(c).objects.tenantSource;
}

export function getPlatformWorkflowQueue<
  TBindings extends object,
>(c: Context<{ Bindings: TBindings; Variables: any }>): QueueBinding | undefined {
  return getPlatformServices(c).queues.workflow;
}
