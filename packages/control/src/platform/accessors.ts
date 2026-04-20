import type {
  ControlPlatform,
  PlatformConfig,
  PlatformServices,
} from "./platform-config.ts";
import type { Context } from "hono";

function isControlPlatform<TBindings extends object>(
  value: unknown,
): value is ControlPlatform<TBindings> {
  return typeof value === "object" && value !== null &&
    "config" in value &&
    "services" in value &&
    "bindings" in value;
}

function getPlatformVariable<TBindings extends object>(
  variables: object,
): ControlPlatform<TBindings> | undefined {
  const platform = (variables as { platform?: unknown }).platform;
  return isControlPlatform<TBindings>(platform) ? platform : undefined;
}

export function getPlatform<
  TBindings extends object,
  TVariables extends object,
>(
  c: Context<
    { Bindings: TBindings; Variables: TVariables }
  >,
): ControlPlatform<TBindings> {
  const platform = getPlatformVariable<TBindings>(c.var);
  if (platform) return platform;
  const envPlatform =
    (c.env as { PLATFORM?: ControlPlatform<TBindings> }).PLATFORM;
  if (envPlatform) return envPlatform;
  throw new Error(
    "Platform context missing. Entry points must inject PLATFORM explicitly.",
  );
}

export function getPlatformConfig<
  TBindings extends object,
  TVariables extends object,
>(
  c: Context<
    { Bindings: TBindings; Variables: TVariables }
  >,
): PlatformConfig {
  return getPlatform(c).config;
}

export function getPlatformServices<
  TBindings extends object,
  TVariables extends object,
>(
  c: Context<
    { Bindings: TBindings; Variables: TVariables }
  >,
): PlatformServices {
  return getPlatform(c).services;
}
