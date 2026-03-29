import type { Env } from '../../../shared/types';
export declare function runCommonEnvScheduledMaintenance(params: {
    env: Env;
    cron: string;
    errors: Array<{
        job: string;
        error: string;
    }>;
}): Promise<void>;
//# sourceMappingURL=maintenance.d.ts.map