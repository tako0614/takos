/**
 * Main entry point for local-platform runtime.
 *
 * The live local stack is ONE worker (see unified-entrypoint.ts): the web fetch
 * and the queue worker loop run in a single process, and the production runtime
 * / executor container-host handlers are mounted in-process by web.ts. This
 * module provides the web / dispatch fetch factories that the single-worker
 * entrypoint and the bootstrap tests build on.
 *
 *   runtime-types.ts  – shared types and constants
 */

import { loadLocalDispatchEnv, loadLocalWebEnv } from "./load-adapter.ts";
import { createLocalExecutionContext } from "./execution-context.ts";
import {
  buildNodeDispatchPlatform,
  buildNodeWebPlatform,
} from "../platform/adapters/node.ts";

// Re-export constants and types so existing consumers keep working.
export { DEFAULT_LOCAL_PORTS } from "./runtime-types.ts";
export type { LocalFetch } from "./runtime-types.ts";

import type { LocalFetch } from "./runtime-types.ts";

// ---------------------------------------------------------------------------
// Web / Dispatch fetch factories
// ---------------------------------------------------------------------------

export async function createLocalWebFetch(): Promise<LocalFetch> {
  const env = await loadLocalWebEnv();
  const { createWebWorker } = await import("../web.ts");
  const webWorker = createWebWorker(buildNodeWebPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    webWorker.fetch(request, env, executionContext);
}

export async function createLocalWebFetchForTests(): Promise<LocalFetch> {
  const env = await loadLocalWebEnv();
  const { createWebWorker } = await import("../web.ts");
  const webWorker = createWebWorker(buildNodeWebPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    webWorker.fetch(request, env, executionContext);
}

export async function createLocalDispatchFetchForTests(): Promise<LocalFetch> {
  const env = await loadLocalDispatchEnv();
  const { createDispatchWorker } = await import("../dispatch.ts");
  const dispatchWorker = createDispatchWorker(buildNodeDispatchPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    dispatchWorker.fetch(request, env, executionContext);
}
