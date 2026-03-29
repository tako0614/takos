import type { Env } from '../../../shared/types';
export declare class InfoUnitIndexer {
    private ai?;
    private vectorize?;
    private dbBinding;
    private offloadBucket?;
    constructor(env: Pick<Env, 'AI' | 'VECTORIZE' | 'DB' | 'TAKOS_OFFLOAD'>);
    indexRun(spaceId: string, runId: string): Promise<void>;
}
export declare function createInfoUnitIndexer(env: Pick<Env, 'AI' | 'VECTORIZE' | 'DB' | 'TAKOS_OFFLOAD'>): InfoUnitIndexer | null;
//# sourceMappingURL=info-units.d.ts.map