import type { Env } from '../../../shared/types';
export interface RolloutSpec {
    strategy: 'staged' | 'immediate';
    stages?: Array<{
        weight: number;
        pauseMinutes: number;
    }>;
    healthCheck?: {
        errorRateThreshold: number;
        minRequests: number;
    };
    autoPromote: boolean;
}
export interface RolloutState {
    status: 'in_progress' | 'paused' | 'completed' | 'aborted' | 'failed';
    currentStageIndex: number;
    stages: Array<{
        weight: number;
        pauseMinutes: number;
    }>;
    healthCheck: {
        errorRateThreshold: number;
        minRequests: number;
    } | null;
    autoPromote: boolean;
    stageEnteredAt: string;
    deploymentId: string;
    serviceId: string;
}
export declare class RolloutService {
    private env;
    constructor(env: Env);
    initiateRollout(params: {
        bundleDeploymentId: string;
        rolloutSpec: RolloutSpec;
        deploymentId: string;
        serviceId: string;
        hostname: string;
        activeDeploymentArtifactRef: string;
        newDeploymentArtifactRef: string;
    }): Promise<RolloutState>;
    advanceStage(bundleDeploymentId: string, hostname: string): Promise<RolloutState>;
    pauseRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState>;
    resumeRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState>;
    abortRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState>;
    promoteRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState>;
    getRolloutState(bundleDeploymentId: string): Promise<RolloutState | null>;
    private completeRollout;
    private revertAndFail;
    private loadState;
    private saveState;
    private getActiveDeployment;
    private updateRoutingWeights;
    private scheduleAlarm;
    private cancelAlarm;
}
//# sourceMappingURL=rollout.d.ts.map