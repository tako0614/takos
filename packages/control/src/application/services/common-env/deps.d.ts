import type { Env } from '../../../shared/types';
import { CommonEnvReconciler } from './reconciler';
import { CommonEnvOrchestrator } from './orchestrator';
import type { SpaceEnvDeps } from './space-env-ops';
import type { ServiceLinkDeps } from './service-link-ops';
import type { ManualLinkDeps } from './manual-link-ops';
export interface CommonEnvDeps {
    spaceEnv: SpaceEnvDeps;
    serviceLink: ServiceLinkDeps;
    manualLink: ManualLinkDeps;
    orchestrator: CommonEnvOrchestrator;
    reconciler: CommonEnvReconciler;
}
export declare function createCommonEnvDeps(env: Env): CommonEnvDeps;
