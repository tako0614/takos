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

  constructor(ctx: HostContainerContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async startAndWaitForPorts(_ports?: number | number[]): Promise<void> {}

  renewActivityTimeout(): void {}

  async destroy(): Promise<void> {}
}

const isNodeLikeRuntime =
  typeof process !== 'undefined'
  && Boolean(process.versions?.node);

const runtimeModule = isNodeLikeRuntime
  ? null
  : await import('@cloudflare/containers');

export const HostContainerRuntime = (
  runtimeModule?.Container ?? LocalHostContainerRuntime
) as typeof LocalHostContainerRuntime;

export const Container = (
  runtimeModule?.Container ?? LocalHostContainerRuntime
) as typeof LocalHostContainerRuntime;
