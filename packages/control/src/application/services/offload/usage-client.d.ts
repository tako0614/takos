import type { Env } from '../../../shared/types';
export declare function emitRunUsageEvent(env: Env, input: {
    runId: string;
    meterType: string;
    units: number;
    referenceType?: string;
    metadata?: unknown;
}): Promise<void>;
//# sourceMappingURL=usage-client.d.ts.map