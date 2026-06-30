import type { Env } from "../../shared/types/index.ts";
import type { WorkerEnv } from "../../runtime/worker/env.ts";
import type { DispatchEnv } from "../../dispatch.ts";
import { buildPlatformFromEnv, getString } from "./shared.ts";
import type { PlatformEnvIndex } from "./shared.ts";
import type {
  ControlPlatform,
  PlatformServiceBinding,
  PlatformSource,
} from "../platform-config.ts";
import { getSseNotifier } from "../sse-notifier-access.ts";

function resolveSourceLabel(env: PlatformEnvIndex): PlatformSource {
  const explicit = getString(env, "TAKOS_PLATFORM_SOURCE");
  if (explicit === "workers" || explicit === "node") {
    return explicit;
  }
  return "node";
}

// ---------------------------------------------------------------------------
// Unified Node.js platform builder
// ---------------------------------------------------------------------------

async function buildNodePlatformFromEnv<TBindings extends object>(
  env: TBindings & PlatformEnvIndex,
): Promise<ControlPlatform<TBindings>> {
  // Node reads the runtime/executor host bindings straight from env (no
  // in-process container fallback) and is the only runtime that wires the SSE
  // notifier; everything else is the shared config/service map.
  return buildPlatformFromEnv(env, {
    source: resolveSourceLabel(env),
    runtimeHost: env.RUNTIME_HOST as PlatformServiceBinding | undefined,
    executorHost: env.EXECUTOR_HOST as PlatformServiceBinding | undefined,
    sseNotifier: getSseNotifier(env),
  });
}

// ---------------------------------------------------------------------------
// Public API — matches the shape of the per-platform adapters
// ---------------------------------------------------------------------------

export function buildNodeWebPlatform(env: Env): Promise<ControlPlatform<Env>> {
  return buildNodePlatformFromEnv(env as Env & PlatformEnvIndex);
}

export function buildNodeDispatchPlatform(
  env: DispatchEnv,
): Promise<ControlPlatform<DispatchEnv>> {
  return buildNodePlatformFromEnv(env as DispatchEnv & PlatformEnvIndex);
}

export function buildNodeWorkerPlatform(
  env: WorkerEnv,
): Promise<ControlPlatform<WorkerEnv>> {
  return buildNodePlatformFromEnv(env as WorkerEnv & PlatformEnvIndex);
}
