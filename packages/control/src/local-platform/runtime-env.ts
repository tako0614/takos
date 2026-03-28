import { createInMemoryDurableObjectNamespace } from './in-memory-bindings.ts';
import type { DurableNamespaceBinding, DurableObjectStub } from '../shared/types/bindings.ts';
import { createNodeWebEnv } from '../node-platform/env-builder.ts';
import {
  createLocalRuntimeGatewayStub,
  createLocalExecutorGatewayStub,
  createLocalBrowserGatewayStub,
} from './runtime-gateway-stubs.ts';
import {
  createForwardingBinding,
  resolveOptionalServiceForwardUrl,
  resolveServiceUrl,
} from './runtime-http.ts';
import { DEFAULT_LOCAL_DOMAINS, DEFAULT_LOCAL_PORTS, DEFAULT_LOCAL_SERVICE_PORTS } from './runtime-types.ts';
import type { LocalFetch } from './runtime-types.ts';

export async function createRuntimeHostEnvForTests(deps: {
  webFetch: LocalFetch;
}) {
  const stub = createLocalRuntimeGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_RUNTIME_URL', DEFAULT_LOCAL_SERVICE_PORTS.runtime),
  );
  const runtimeFactory = () => stub as unknown as DurableObjectStub;
  const runtimeNamespace = createInMemoryDurableObjectNamespace(runtimeFactory) as unknown as DurableNamespaceBinding;
  return {
    RUNTIME_CONTAINER: runtimeNamespace,
    TAKOS_WEB: { fetch: (request: Request) => deps.webFetch(request) },
    ADMIN_DOMAIN: process.env.ADMIN_DOMAIN ?? DEFAULT_LOCAL_DOMAINS.admin,
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? 'http://runtime-host.local',
  };
}

export async function createRuntimeHostEnv() {
  const stub = createLocalRuntimeGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_RUNTIME_URL', DEFAULT_LOCAL_SERVICE_PORTS.runtime),
  );
  const runtimeFactory = () => stub as unknown as DurableObjectStub;
  const runtimeNamespace = createInMemoryDurableObjectNamespace(runtimeFactory) as unknown as DurableNamespaceBinding;
  return {
    RUNTIME_CONTAINER: runtimeNamespace,
    TAKOS_WEB: createForwardingBinding(resolveServiceUrl('TAKOS_LOCAL_WEB_URL', DEFAULT_LOCAL_PORTS.web)),
    ADMIN_DOMAIN: process.env.ADMIN_DOMAIN ?? DEFAULT_LOCAL_DOMAINS.admin,
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.runtimeHost}`,
  };
}

export async function createExecutorHostEnvForTests(deps: {
  runtimeFetch?: LocalFetch;
  browserFetch?: LocalFetch;
}) {
  const baseEnv = await createNodeWebEnv();
  const stub = createLocalExecutorGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_EXECUTOR_URL', DEFAULT_LOCAL_SERVICE_PORTS.executor),
  );
  const executorFactory = () => stub as unknown as DurableObjectStub;
  const executorNamespace = createInMemoryDurableObjectNamespace(executorFactory) as unknown as DurableNamespaceBinding;

  return {
    ...baseEnv,
    EXECUTOR_CONTAINER: executorNamespace,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
    ...(deps.runtimeFetch ? { RUNTIME_HOST: { fetch: async (request: Request) => deps.runtimeFetch!(request) } } : {}),
    ...(deps.browserFetch ? { BROWSER_HOST: { fetch: async (request: Request) => deps.browserFetch!(request) } } : {}),
    CONTROL_RPC_BASE_URL: process.env.CONTROL_RPC_BASE_URL
      ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? 'http://executor-host.local',
  };
}

export async function createExecutorHostEnv() {
  const baseEnv = await createNodeWebEnv();
  const stub = createLocalExecutorGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_EXECUTOR_URL', DEFAULT_LOCAL_SERVICE_PORTS.executor),
  );
  const executorFactory = () => stub as unknown as DurableObjectStub;
  const executorNamespace = createInMemoryDurableObjectNamespace(executorFactory) as unknown as DurableNamespaceBinding;

  return {
    ...baseEnv,
    EXECUTOR_CONTAINER: executorNamespace,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
    RUNTIME_HOST: createForwardingBinding(resolveServiceUrl('TAKOS_LOCAL_RUNTIME_HOST_URL', DEFAULT_LOCAL_PORTS.runtimeHost)),
    BROWSER_HOST: createForwardingBinding(resolveServiceUrl('TAKOS_LOCAL_BROWSER_HOST_URL', DEFAULT_LOCAL_PORTS.browserHost)),
    CONTROL_RPC_BASE_URL: process.env.CONTROL_RPC_BASE_URL
      ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
  };
}

export async function createBrowserHostEnvForTests() {
  const stub = createLocalBrowserGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_BROWSER_URL', DEFAULT_LOCAL_SERVICE_PORTS.browser),
  );
  const browserFactory = () => stub as unknown as DurableObjectStub;
  const browserNamespace = createInMemoryDurableObjectNamespace(browserFactory) as unknown as DurableNamespaceBinding;
  return {
    BROWSER_CONTAINER: browserNamespace,
    BROWSER_CHECKPOINTS: undefined,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
  };
}

export async function createBrowserHostEnv() {
  const stub = createLocalBrowserGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_BROWSER_URL', DEFAULT_LOCAL_SERVICE_PORTS.browser),
  );
  const browserFactory = () => stub as unknown as DurableObjectStub;
  const browserNamespace = createInMemoryDurableObjectNamespace(browserFactory) as unknown as DurableNamespaceBinding;
  return {
    BROWSER_CONTAINER: browserNamespace,
    BROWSER_CHECKPOINTS: undefined,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
  };
}
