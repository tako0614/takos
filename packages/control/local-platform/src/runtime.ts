/**
 * Runtime module for @takoserver/control-local-platform.
 *
 * Re-exports the platform-agnostic runtime API (fetch factories, types,
 * constants) from the parent control package, then adds Node-specific
 * `startLocal*Server` functions that bind those fetch factories to a local
 * HTTP server via `transport.ts`.
 *
 * The re-export is necessary because the parent `src/local-platform/runtime.ts`
 * must stay free of Node server concerns (it is also used by tests and
 * platform-agnostic code), while consumers of this package expect a single
 * import path that provides both the core API and the server starters.
 */
import {
  DEFAULT_LOCAL_PORTS,
  createLocalBrowserHostFetch,
  createLocalDispatchFetch,
  createLocalExecutorHostFetch,
  createLocalRuntimeHostFetch,
  createLocalWebFetch,
} from '../../src/local-platform/runtime.ts';
import { startCanonicalLocalServer } from './transport.ts';

export * from '../../src/local-platform/runtime.ts';

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
