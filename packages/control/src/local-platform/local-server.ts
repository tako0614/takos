/**
 * Node-specific HTTP server starters for the local-platform stack.
 *
 * Each `startLocal*Server()` function binds a platform-agnostic fetch factory
 * (from `runtime.ts`) to a local Node HTTP server via `fetch-server.ts`.
 * These functions are intentionally kept out of `runtime.ts` so that module
 * stays free of Node server concerns (it is also used by tests and
 * platform-agnostic code).
 */
import type { LocalFetch } from './runtime-types.ts';
import { serveNodeFetch } from './fetch-server.ts';
import { logInfo } from '../shared/utils/logger.ts';
import {
  DEFAULT_LOCAL_PORTS,
  createLocalBrowserHostFetch,
  createLocalDispatchFetch,
  createLocalExecutorHostFetch,
  createLocalRuntimeHostFetch,
  createLocalWebFetch,
} from './runtime.ts';

function resolvePort(defaultPort: number): number {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}

function logLocalServerStart(service: string, port: number) {
  logInfo(`${service} local runtime listening on :${port}`, {
    module: 'local_platform',
    adapter: process.env.TAKOS_LOCAL_ADAPTER,
    runtime: 'node',
  });
}

export async function startCanonicalLocalServer(options: {
  service: string;
  defaultPort: number;
  createFetch: () => Promise<LocalFetch>;
}): Promise<void> {
  const port = resolvePort(options.defaultPort);
  const fetch = await options.createFetch();
  await serveNodeFetch({
    port,
    fetch,
    onListen: () => logLocalServerStart(options.service, port),
  });
}

export async function startLocalWebServer(): Promise<void> {
  await startCanonicalLocalServer({
    service: 'takos-web',
    defaultPort: DEFAULT_LOCAL_PORTS.web,
    createFetch: createLocalWebFetch,
  });
}

export async function startLocalDispatchServer(): Promise<void> {
  await startCanonicalLocalServer({
    service: 'takos-dispatch',
    defaultPort: DEFAULT_LOCAL_PORTS.dispatch,
    createFetch: createLocalDispatchFetch,
  });
}

export async function startLocalRuntimeHostServer(): Promise<void> {
  await startCanonicalLocalServer({
    service: 'takos-runtime-host',
    defaultPort: DEFAULT_LOCAL_PORTS.runtimeHost,
    createFetch: createLocalRuntimeHostFetch,
  });
}

export async function startLocalExecutorHostServer(): Promise<void> {
  await startCanonicalLocalServer({
    service: 'takos-executor-host',
    defaultPort: DEFAULT_LOCAL_PORTS.executorHost,
    createFetch: createLocalExecutorHostFetch,
  });
}

export async function startLocalBrowserHostServer(): Promise<void> {
  await startCanonicalLocalServer({
    service: 'takos-browser-host',
    defaultPort: DEFAULT_LOCAL_PORTS.browserHost,
    createFetch: createLocalBrowserHostFetch,
  });
}
