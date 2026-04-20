import { createInMemoryDurableObjectNamespace } from "./in-memory-bindings.ts";
import { createNodeWebEnv } from "../node-platform/env-builder.ts";
import {
  createLocalExecutorGatewayStub,
  createLocalRuntimeGatewayStub,
} from "./runtime-gateway-stubs.ts";
import {
  createForwardingBinding,
  resolveOptionalServiceForwardUrl,
  resolveServiceUrl,
} from "./runtime-http.ts";
import {
  DEFAULT_LOCAL_DOMAINS,
  DEFAULT_LOCAL_PORTS,
  DEFAULT_LOCAL_SERVICE_PORTS,
} from "./runtime-types.ts";
import type {
  LocalExecutorGatewayStub,
  LocalFetch,
  LocalRuntimeGatewayStub,
} from "./runtime-types.ts";

export async function createRuntimeHostEnvForTests(deps: {
  webFetch: LocalFetch;
}) {
  const stub = createLocalRuntimeGatewayStub(
    resolveOptionalServiceForwardUrl(
      "TAKOS_LOCAL_RUNTIME_URL",
      DEFAULT_LOCAL_SERVICE_PORTS.runtime,
    ),
  );
  const runtimeNamespace = createInMemoryDurableObjectNamespace<
    LocalRuntimeGatewayStub
  >(() => stub);
  return {
    RUNTIME_CONTAINER: runtimeNamespace,
    TAKOS_WEB: { fetch: (request: Request) => deps.webFetch(request) },
    ADMIN_DOMAIN: Deno.env.get("ADMIN_DOMAIN") ?? DEFAULT_LOCAL_DOMAINS.admin,
    PROXY_BASE_URL: Deno.env.get("PROXY_BASE_URL") ??
      "http://runtime-host.local",
  };
}

export async function createRuntimeHostEnv() {
  const stub = createLocalRuntimeGatewayStub(
    resolveOptionalServiceForwardUrl(
      "TAKOS_LOCAL_RUNTIME_URL",
      DEFAULT_LOCAL_SERVICE_PORTS.runtime,
    ),
  );
  const runtimeNamespace = createInMemoryDurableObjectNamespace<
    LocalRuntimeGatewayStub
  >(() => stub);
  return {
    RUNTIME_CONTAINER: runtimeNamespace,
    TAKOS_WEB: createForwardingBinding(
      resolveServiceUrl("TAKOS_LOCAL_WEB_URL", DEFAULT_LOCAL_PORTS.web),
    ),
    ADMIN_DOMAIN: Deno.env.get("ADMIN_DOMAIN") ?? DEFAULT_LOCAL_DOMAINS.admin,
    PROXY_BASE_URL: Deno.env.get("PROXY_BASE_URL") ??
      `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.runtimeHost}`,
  };
}

export async function createExecutorHostEnvForTests(deps: {
  runtimeFetch?: LocalFetch;
}) {
  const baseEnv = await createNodeWebEnv();
  const stub = createLocalExecutorGatewayStub(
    resolveOptionalServiceForwardUrl(
      "TAKOS_LOCAL_EXECUTOR_URL",
      DEFAULT_LOCAL_SERVICE_PORTS.executor,
    ),
  );
  const executorNamespace = createInMemoryDurableObjectNamespace<
    LocalExecutorGatewayStub
  >(() => stub);

  return {
    ...baseEnv,
    EXECUTOR_CONTAINER: executorNamespace,
    TAKOS_EGRESS: {
      fetch: async (request: Request) => globalThis.fetch(request),
    },
    ...(deps.runtimeFetch
      ? {
        RUNTIME_HOST: {
          fetch: async (request: Request) => deps.runtimeFetch!(request),
        },
      }
      : {}),
    CONTROL_RPC_BASE_URL: Deno.env.get("CONTROL_RPC_BASE_URL") ??
      `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
    PROXY_BASE_URL: Deno.env.get("PROXY_BASE_URL") ??
      "http://executor-host.local",
  };
}

export async function createExecutorHostEnv() {
  const baseEnv = await createNodeWebEnv();
  const stub = createLocalExecutorGatewayStub(
    resolveOptionalServiceForwardUrl(
      "TAKOS_LOCAL_EXECUTOR_URL",
      DEFAULT_LOCAL_SERVICE_PORTS.executor,
    ),
  );
  const executorNamespace = createInMemoryDurableObjectNamespace<
    LocalExecutorGatewayStub
  >(() => stub);

  return {
    ...baseEnv,
    EXECUTOR_CONTAINER: executorNamespace,
    TAKOS_EGRESS: {
      fetch: async (request: Request) => globalThis.fetch(request),
    },
    RUNTIME_HOST: createForwardingBinding(
      resolveServiceUrl(
        "TAKOS_LOCAL_RUNTIME_HOST_URL",
        DEFAULT_LOCAL_PORTS.runtimeHost,
      ),
    ),
    CONTROL_RPC_BASE_URL: Deno.env.get("CONTROL_RPC_BASE_URL") ??
      `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
    PROXY_BASE_URL: Deno.env.get("PROXY_BASE_URL") ??
      `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
  };
}
