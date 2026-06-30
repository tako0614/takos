import type { Env } from "../../shared/types/index.ts";
import type { WorkerEnv } from "../../runtime/worker/env.ts";
import type { DispatchEnv } from "../../dispatch.ts";
import { buildPlatformFromEnv, getString } from "./shared.ts";
import type { PlatformEnvIndex } from "./shared.ts";
import type {
  ControlPlatform,
  PlatformServiceBinding,
} from "../platform-config.ts";
import { resolveContainerHostBaseUrl } from "../../platform-utils/container-host.ts";

function serviceBindingFromEnv(
  env: PlatformEnvIndex,
  key: string,
): PlatformServiceBinding | undefined {
  const binding = env[key];
  if (
    binding &&
    typeof binding === "object" &&
    "fetch" in binding &&
    typeof (binding as { fetch?: unknown }).fetch === "function"
  ) {
    return binding as PlatformServiceBinding;
  }
  return undefined;
}

function defaultContainerHostBaseUrl(env: PlatformEnvIndex): string {
  return resolveContainerHostBaseUrl({
    proxyBaseUrl: getString(env, "PROXY_BASE_URL"),
    authPublicBaseUrl: getString(env, "AUTH_PUBLIC_BASE_URL"),
    adminDomain: getString(env, "ADMIN_DOMAIN"),
  });
}

function createInProcessRuntimeHostBinding(
  env: PlatformEnvIndex,
): PlatformServiceBinding | undefined {
  if (!env.RUNTIME_CONTAINER) return undefined;
  const takosWorker = serviceBindingFromEnv(env, "TAKOS_EGRESS");
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const { default: runtimeHost } = await import(
        "../../runtime/container-hosts/runtime-host.ts"
      );
      return runtimeHost.fetch(new Request(input, init), {
        ...env,
        TAKOS_WORKER: takosWorker,
        PROXY_BASE_URL: defaultContainerHostBaseUrl(env),
      } as never);
    },
  };
}

function createInProcessExecutorHostBinding(
  env: PlatformEnvIndex,
): PlatformServiceBinding | undefined {
  if (!env.EXECUTOR_CONTAINER) return undefined;
  const takosWorker = serviceBindingFromEnv(env, "TAKOS_EGRESS");
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const { default: executorHost } = await import(
        "../../runtime/container-hosts/executor-host.ts"
      );
      // TAKOS_AGENT_CONTROL_RPC_BASE_URL keeps its dedicated env first, then
      // falls back to the shared container-host base URL.
      return executorHost.fetch(new Request(input, init), {
        ...env,
        TAKOS_WORKER: takosWorker,
        TAKOS_AGENT_CONTROL_RPC_BASE_URL:
          getString(env, "TAKOS_AGENT_CONTROL_RPC_BASE_URL") ??
            defaultContainerHostBaseUrl(env),
      } as never);
    },
  };
}

function buildWorkersPlatform<TBindings extends object>(
  env: TBindings & PlatformEnvIndex,
): ControlPlatform<TBindings> {
  const runtimeHost = serviceBindingFromEnv(env, "RUNTIME_HOST") ??
    createInProcessRuntimeHostBinding(env);
  const executorHost = serviceBindingFromEnv(env, "EXECUTOR_HOST") ??
    createInProcessExecutorHostBinding(env);
  const bindings = {
    ...env,
    ...(runtimeHost ? { RUNTIME_HOST: runtimeHost } : {}),
    ...(executorHost ? { EXECUTOR_HOST: executorHost } : {}),
  } as TBindings & PlatformEnvIndex;

  // The only workers-specific wiring is the in-process runtime/executor host
  // fallback (resolved above and merged into `bindings`); the rest of the
  // config/service map is shared with the node adapter.
  return buildPlatformFromEnv(bindings, {
    source: "workers",
    runtimeHost,
    executorHost,
  });
}

export function buildWorkersWebPlatform(env: Env): ControlPlatform<Env> {
  return buildWorkersPlatform(env as Env & PlatformEnvIndex);
}

export function buildWorkersDispatchPlatform(
  env: DispatchEnv,
): ControlPlatform<DispatchEnv> {
  return buildWorkersPlatform(env as DispatchEnv & PlatformEnvIndex);
}

export function buildWorkersWorkerPlatform(
  env: WorkerEnv,
): ControlPlatform<WorkerEnv> {
  return buildWorkersPlatform(env as WorkerEnv & PlatformEnvIndex);
}
