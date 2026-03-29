import type { AgentConfig } from './agent-models';
import type { Env } from '../../../shared/types';
export declare const DEFAULT_ITERATION_TIMEOUT = 120000;
export declare const DEFAULT_TOTAL_TIMEOUT = 900000;
export declare function getTimeoutConfig(env?: Env): {
    iterationTimeout: number;
    totalTimeout: number;
    toolExecutionTimeout: number;
    langGraphTimeout: number;
};
export declare function getAgentConfig(agentType: string, env?: Env): AgentConfig;
//# sourceMappingURL=runner-config.d.ts.map