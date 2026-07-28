/**
 * Dispatch env helpers — service registry, forwarding targets, tenant workload runtime.
 */
import { optionalEnv } from "./env-utils.ts";
import type { DispatchEnv } from "../../dispatch.ts";
import type { ServiceBindingFetcher } from "../../shared/types/bindings.ts";
import {
  createFetcherRegistry,
  parseServiceTargetMap,
  type ServiceTargetMap,
} from "../../local-platform/url-registry.ts";

export function createExternalRuntimeServiceRegistry(
  forwardTargets: ServiceTargetMap,
  runtimeHost?: ServiceBindingFetcher,
): DispatchEnv["DISPATCHER"] {
  return createFetcherRegistry(
    forwardTargets,
    runtimeHost ? () => runtimeHost : undefined,
  );
}

export function collectImplicitForwardTargets(): Record<string, string> {
  const targets: Record<string, string> = {};
  for (
    const [envKey, serviceName] of [
      ["TAKOS_LOCAL_EXECUTOR_URL", "executor-host"],
      ["TAKOS_LOCAL_EGRESS_URL", "takos-egress"],
      ["TAKOS_EXECUTOR_HOST_URL", "executor-host"],
      ["TAKOS_EGRESS_URL", "takos-egress"],
    ] as const
  ) {
    const url = optionalEnv(envKey);
    if (url) {
      targets[serviceName] = url;
      targets[serviceName.toUpperCase().replace(/-/g, "_")] = url;
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Dispatcher builder
// ---------------------------------------------------------------------------

export interface DispatchBuildContext {
  forwardTargets: Record<string, string>;
  runtimeHost?: ServiceBindingFetcher;
}

export async function buildDispatcher(
  ctx: DispatchBuildContext,
): Promise<DispatchEnv["DISPATCHER"]> {
  Object.assign(
    ctx.forwardTargets,
    parseServiceTargetMap(optionalEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON")),
  );
  return createExternalRuntimeServiceRegistry(
    ctx.forwardTargets,
    ctx.runtimeHost,
  );
}
