import type { Context } from "hono";
import type { ControlPlatform } from "./platform-config.ts";

export type PlatformContextVariables<TBindings extends object = object> = {
  platform?: ControlPlatform<TBindings>;
};

export type PlatformContext<TBindings extends object = object> = Context<{
  Bindings: TBindings & { PLATFORM?: ControlPlatform<TBindings> };
  Variables: PlatformContextVariables<TBindings>;
}>;

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

export function setPlatformContext<
  TBindings extends object,
  TVariables extends PlatformContextVariables<TBindings>,
>(
  c: Context<
    { Bindings: TBindings; Variables: TVariables }
  >,
  platform: ControlPlatform<TBindings>,
): void {
  c.set("platform", platform);
}

export function getPlatformContext<
  TBindings extends object,
  TVariables extends object,
>(
  c: Context<
    { Bindings: TBindings; Variables: TVariables }
  >,
): ControlPlatform<TBindings> | undefined {
  const platform = getPlatformVariable<TBindings>(c.var);
  if (platform) return platform;
  return (c.env as { PLATFORM?: ControlPlatform<TBindings> }).PLATFORM;
}
