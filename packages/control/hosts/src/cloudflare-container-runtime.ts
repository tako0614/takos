export type HostContainerTcpPortFetcher = {
  fetch(url: string, request: Request): Promise<Response>;
};

export interface HostContainerInternals {
  container: {
    getTcpPort(port: number): HostContainerTcpPortFetcher;
  };
}

class LocalHostContainerRuntimeFallback<Env> {
  protected readonly ctx: DurableObjectState<Record<string, never>>;
  protected readonly env: Env;
  protected envVars: Record<string, string> = {};

  defaultPort = 8080;
  sleepAfter = '10m';
  pingEndpoint = 'container/health';

  constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async startAndWaitForPorts(_ports: number[]): Promise<void> {}

  renewActivityTimeout(): void {}

  async destroy(): Promise<void> {}
}

const runningInNode =
  typeof process !== 'undefined'
  && !!process.versions?.node;

const cloudflareContainerModule = runningInNode
  ? null
  : await import('@cloudflare/containers');

export const HostContainerRuntime =
  (cloudflareContainerModule?.Container ?? LocalHostContainerRuntimeFallback);

export const Container = HostContainerRuntime;
