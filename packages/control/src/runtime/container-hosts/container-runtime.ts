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

export class LocalHostContainerRuntime<Env = unknown> {
  ctx: HostContainerContext;
  env: Env;
  envVars: Record<string, string> = {};
  container: HostContainerInternals["container"] = {
    getTcpPort(): HostContainerTcpPortFetcher {
      throw new Error("Host container TCP ports are unavailable locally");
    },
  };

  constructor(ctx: HostContainerContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

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
