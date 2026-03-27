/**
 * Main entry point for local-platform runtime.
 *
 * Re-exports the public API that was originally in this single 974-line file,
 * now split across focused modules:
 *
 *   runtime-types.ts          – shared types and constants
 *   runtime-http.ts           – HTTP utilities (forwarding, JSON response, etc.)
 *   runtime-gateway-stubs.ts  – in-process gateway stub factories
 *   runtime-host-fetch.ts     – runtime-host and browser-host fetch builders
 *   executor-control-rpc.ts   – executor control RPC handlers + executor-host fetch builder
 *   runtime-env.ts            – environment construction for production and tests
 */

import { loadLocalWebEnv, loadLocalDispatchEnv } from './load-adapter.ts';
import { createLocalExecutionContext } from './execution-context.ts';
import { buildNodeWebPlatform, buildNodeDispatchPlatform } from '../platform/adapters/node.ts';

// Re-export constants and types so existing consumers keep working.
export { DEFAULT_LOCAL_PORTS } from './runtime-types.ts';
export type { LocalFetch } from './runtime-types.ts';

// Re-export sub-modules for advanced consumers.
export { buildLocalRuntimeHostFetch, buildLocalBrowserHostFetch } from './runtime-host-fetch.ts';
export { buildLocalExecutorHostFetch } from './executor-control-rpc.ts';

import type { LocalFetch } from './runtime-types.ts';
import { buildLocalRuntimeHostFetch, buildLocalBrowserHostFetch } from './runtime-host-fetch.ts';
import { buildLocalExecutorHostFetch } from './executor-control-rpc.ts';
import {
  createRuntimeHostEnv,
  createRuntimeHostEnvForTests,
  createExecutorHostEnv,
  createExecutorHostEnvForTests,
  createBrowserHostEnv,
  createBrowserHostEnvForTests,
} from './runtime-env.ts';

// ---------------------------------------------------------------------------
// Web / Dispatch fetch factories
// ---------------------------------------------------------------------------

export async function createLocalWebFetch(): Promise<LocalFetch> {
  const env = await loadLocalWebEnv();
  const { createWebWorker } = await import('../web.ts');
  const webWorker = createWebWorker(buildNodeWebPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    webWorker.fetch(request, env, executionContext);
}

export async function createLocalWebFetchForTests(): Promise<LocalFetch> {
  const env = await loadLocalWebEnv();
  const { createWebWorker } = await import('../web.ts');
  const webWorker = createWebWorker(buildNodeWebPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    webWorker.fetch(request, env, executionContext);
}

export async function createLocalDispatchFetch(): Promise<LocalFetch> {
  const env = await loadLocalDispatchEnv();
  const { createDispatchWorker } = await import('../dispatch.ts');
  const dispatchWorker = createDispatchWorker(buildNodeDispatchPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    dispatchWorker.fetch(request, env, executionContext);
}

export async function createLocalDispatchFetchForTests(): Promise<LocalFetch> {
  const env = await loadLocalDispatchEnv();
  const { createDispatchWorker } = await import('../dispatch.ts');
  const dispatchWorker = createDispatchWorker(buildNodeDispatchPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    dispatchWorker.fetch(request, env, executionContext);
}

// ---------------------------------------------------------------------------
// Host fetch factories – production
// ---------------------------------------------------------------------------

export async function createLocalRuntimeHostFetch(): Promise<LocalFetch> {
  const env = await createRuntimeHostEnv();
  return buildLocalRuntimeHostFetch(env);
}

export async function createLocalExecutorHostFetch(): Promise<LocalFetch> {
  const env = await createExecutorHostEnv();
  return buildLocalExecutorHostFetch(env);
}

export async function createLocalBrowserHostFetch(): Promise<LocalFetch> {
  const env = await createBrowserHostEnv();
  return buildLocalBrowserHostFetch(env);
}

// ---------------------------------------------------------------------------
// Host fetch factories – tests
// ---------------------------------------------------------------------------

export async function createLocalRuntimeHostFetchForTests(): Promise<LocalFetch> {
  const webFetch = await createLocalWebFetchForTests();
  const env = await createRuntimeHostEnvForTests({ webFetch });
  return buildLocalRuntimeHostFetch(env);
}

export async function createLocalExecutorHostFetchForTests(): Promise<LocalFetch> {
  const runtimeFetch = await createLocalRuntimeHostFetchForTests();
  const browserFetch = await createLocalBrowserHostFetchForTests();
  const env = await createExecutorHostEnvForTests({ runtimeFetch, browserFetch });
  return buildLocalExecutorHostFetch(env);
}

export async function createLocalBrowserHostFetchForTests(): Promise<LocalFetch> {
  const env = await createBrowserHostEnvForTests();
  return buildLocalBrowserHostFetch(env);
}
