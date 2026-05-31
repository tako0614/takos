import process from "node:process";

export type HostContainerTcpPortFetcher = {
  fetch(url: string, request: Request): Promise<Response>;
};

export interface HostContainerInternals {
  container: {
    getTcpPort(port: number): HostContainerTcpPortFetcher;
  };
}

export interface HostContainerStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean | void>;
}

export interface HostContainerContext {
  storage: HostContainerStorage;
}

/**
 * Non-functional fallback used ONLY when the real `@cloudflare/containers`
 * runtime is unavailable (Deno / plain Node — i.e. tests and local tooling).
 * It cannot actually run a container: `getTcpPort` (and therefore any real
 * `dispatchStart` that reaches the container) fails closed with a clear error.
 * The lifecycle methods are no-ops solely so the executor DO classes can
 * construct under test, where callers inject their own container/dispatch
 * mocks. This class is NOT a working local container host; do not treat a
 * successful construct as a runnable container.
 */
export class LocalHostContainerRuntime<Env = unknown> {
  ctx: HostContainerContext;
  env: Env;
  envVars: Record<string, string> = {};
  container: HostContainerInternals["container"] = {
    getTcpPort(): HostContainerTcpPortFetcher {
      throw new Error(
        "Host container runtime is not supported in this environment " +
          "(Workers-only feature). Reached the local non-functional shim.",
      );
    },
  };

  constructor(ctx: HostContainerContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  // No-ops: see class doc. Real port startup happens only on the Workers
  // container runtime; here there is nothing to start, renew, or destroy.
  async startAndWaitForPorts(_ports?: number | number[]): Promise<void> {}

  renewActivityTimeout(): void {}

  async destroy(): Promise<void> {}
}

type RuntimeGlobal = typeof globalThis & {
  Deno?: unknown;
  WebSocketPair?: unknown;
};

type ProcessLike = {
  versions?: {
    node?: string;
  };
};

export function shouldUseLocalHostContainerRuntime(
  globalScope: RuntimeGlobal = globalThis as RuntimeGlobal,
  processLike: ProcessLike | undefined = process,
): boolean {
  const isDenoRuntime = typeof globalScope.Deno !== "undefined";
  const isNodeRuntime = typeof processLike !== "undefined" &&
    Boolean(processLike.versions?.node);
  const isWorkersRuntime = typeof globalScope.WebSocketPair !== "undefined";

  return isDenoRuntime || (isNodeRuntime && !isWorkersRuntime);
}

const runtimeModule = shouldUseLocalHostContainerRuntime()
  ? null
  : await import("@cloudflare/containers");

export const HostContainerRuntime = (
  runtimeModule?.Container ?? LocalHostContainerRuntime
) as typeof LocalHostContainerRuntime;

export const Container = (
  runtimeModule?.Container ?? LocalHostContainerRuntime
) as typeof LocalHostContainerRuntime;
