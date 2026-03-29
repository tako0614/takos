/**
 * Entry point for executing agent runs.
 *
 * Queue consumer entry point using the canonical runIo + remote tool path.
 */
import type { Env } from '../../../shared/types';
import { type AgentRunnerIo } from './runner-io';
/**
 * Execute a run (entry point for queue consumer).
 */
export declare function executeRun(env: Env, apiKey: string | undefined, runId: string, model: string | undefined, options: {
    abortSignal?: AbortSignal;
    runIo: AgentRunnerIo;
}): Promise<void>;
//# sourceMappingURL=execute-run.d.ts.map