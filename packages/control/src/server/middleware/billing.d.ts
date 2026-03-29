import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
import { type MeterType, type BillingCheckResult } from '../../application/services/billing/billing';
export type BillingVariables = {
    user?: User;
    billingCheck?: BillingCheckResult;
};
type BillingEnv = {
    Bindings: Env;
    Variables: BillingVariables;
};
export declare function billingGate(meterType: MeterType, estimateUnits?: number | ((c: Context<BillingEnv>) => number), options?: {
    shadow?: boolean;
}): MiddlewareHandler<BillingEnv>;
export {};
//# sourceMappingURL=billing.d.ts.map