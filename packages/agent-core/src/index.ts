/**
 * @takos/agent-core
 *
 * Shared runtime for Takos agent executors.
 * Used by the OSS container executor and private runner integrations.
 *
 * External consumers should use subpath imports:
 *   import { executeRunInContainer } from '@takos/agent-core/run-executor';
 *   import { parseStartPayload } from '@takos/agent-core/executor-utils';
 *
 * Internal modules stay unexported here; consumers should use the canonical
 * run-executor and executor-utils entrypoints only.
 */

export { executeRunInContainer } from './run-executor.js';
export type {
  StartPayload,
  RunExecutorExecutionEnv,
  RunExecutorOptions,
  RunExecutorRuntimeConfig,
} from './run-executor.js';
export {
  parseStartPayload,
  createConcurrencyGuard,
  installGracefulShutdown,
} from './executor-utils.js';
export type { ParseResult, ConcurrencyGuard, GracefulShutdownOptions } from './executor-utils.js';
