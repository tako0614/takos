import type { AppContainer, AppWorker } from '../app-manifest-types';
export declare function parseWorkers(specRecord: Record<string, unknown>, containers: Record<string, AppContainer>): Record<string, AppWorker>;
/**
 * Build a synthetic service map from workers so that
 * `parseResources` / `validateResourceBindings` can work.
 */
export declare function buildSyntheticServicesFromWorkers(workers: Record<string, AppWorker>): Record<string, {
    type: 'worker';
    bindings?: AppWorker['bindings'];
    triggers?: AppWorker['triggers'];
}>;
//# sourceMappingURL=parse-workers.d.ts.map