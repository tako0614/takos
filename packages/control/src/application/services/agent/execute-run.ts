/**
 * Entry point for executing agent runs.
 *
 * Queue consumer entry point using the canonical runIo + remote tool path.
 */

import type { Env } from '../../../shared/types';
import type { AgentContext } from './types';
import { AgentRunner, type AgentRunnerIo } from './runner';
import { DEFAULT_MODEL_ID } from './model-catalog';

/**
 * Execute a run (entry point for queue consumer).
 */
export async function executeRun(
  env: Env,
  apiKey: string | undefined,
  runId: string,
  model: string | undefined,
  options: {
    abortSignal?: AbortSignal;
    runIo: AgentRunnerIo;
  },
): Promise<void> {
  const bootstrap = await options.runIo.getRunBootstrap({ runId });
  if (bootstrap.status !== 'running') {
    return;
  }

  const context: AgentContext = {
    spaceId: bootstrap.spaceId,
    sessionId: bootstrap.sessionId || undefined,
    threadId: bootstrap.threadId,
    runId,
    userId: bootstrap.userId,
  };
  const agentType = bootstrap.agentType;

  const aiModel = model || DEFAULT_MODEL_ID;

  const runner = new AgentRunner(env, env.DB, env.TAKOS_OFFLOAD, apiKey, context, agentType, aiModel, {
    abortSignal: options.abortSignal,
    runIo: options.runIo,
  });
  await runner.run();
}
