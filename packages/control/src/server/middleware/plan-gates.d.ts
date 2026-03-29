import type { MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
type PlanGateVariables = {
    user?: User;
};
type PlanGateEnv = {
    Bindings: Env;
    Variables: PlanGateVariables;
};
export declare function requireWeeklyRuntimeLimitForAgent(options?: {
    estimateSeconds?: number;
    windowDays?: number;
    limitSeconds?: number;
    shadow?: boolean;
}): MiddlewareHandler<PlanGateEnv>;
export {};
//# sourceMappingURL=plan-gates.d.ts.map