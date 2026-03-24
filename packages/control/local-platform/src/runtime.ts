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
