import { getDb } from '../../../infra/db';
import { bundleDeployments, deployments } from '../../../infra/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { getErrorRate } from './rollout-health';

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
  stages: Array<{ weight: number; pauseMinutes: number }>;
  healthCheck: { errorRateThreshold: number; minRequests: number } | null;
  autoPromote: boolean;
  stageEnteredAt: string;
  deploymentId: string;
  serviceId: string;
}
import { upsertHostnameRouting } from '../routing/service';

const DEFAULT_STAGES = [
  { weight: 1, pauseMinutes: 5 },
  { weight: 5, pauseMinutes: 10 },
  { weight: 25, pauseMinutes: 15 },
  { weight: 50, pauseMinutes: 15 },
  { weight: 100, pauseMinutes: 0 },
];

const DEFAULT_HEALTH_CHECK = {
  errorRateThreshold: 0.05,
  minRequests: 100,
};

function ensureFinalStage(stages: Array<{ weight: number; pauseMinutes: number }>): typeof stages {
  if (stages.length === 0) return DEFAULT_STAGES;
  const last = stages[stages.length - 1];
  if (last.weight !== 100) {
    return [...stages, { weight: 100, pauseMinutes: 0 }];
  }
  return stages;
}

export class RolloutService {
  constructor(private env: Env) {}

  async initiateRollout(params: {
    bundleDeploymentId: string;
    rolloutSpec: RolloutSpec;
    deploymentId: string;
    serviceId: string;
    hostname: string;
    activeDeploymentArtifactRef: string;
    newDeploymentArtifactRef: string;
  }): Promise<RolloutState> {
    const { bundleDeploymentId, rolloutSpec, deploymentId, serviceId } = params;
    if (!params.hostname) throw new Error('Hostname is required to initiate rollout');

    const db = getDb(this.env.DB);
    const stages = ensureFinalStage(rolloutSpec.stages?.length ? rolloutSpec.stages : DEFAULT_STAGES);
    const healthCheck = rolloutSpec.healthCheck ?? DEFAULT_HEALTH_CHECK;
    const firstStage = stages[0];

    const state: RolloutState = {
      status: 'in_progress',
      currentStageIndex: 0,
      stages,
      healthCheck,
      autoPromote: rolloutSpec.autoPromote,
      stageEnteredAt: new Date().toISOString(),
      deploymentId,
      serviceId,
    };

    await this.updateRoutingWeights(params.hostname, {
      activeRef: params.activeDeploymentArtifactRef,
      activeDeploymentId: null,
      activeWeight: 100 - firstStage.weight,
      canaryRef: params.newDeploymentArtifactRef,
      canaryDeploymentId: deploymentId,
      canaryWeight: firstStage.weight,
    });

    await db.update(deployments).set({
      routingStatus: 'canary',
      routingWeight: firstStage.weight,
    }).where(eq(deployments.id, deploymentId));

    await db.update(bundleDeployments).set({
      rolloutState: JSON.stringify(state),
    }).where(eq(bundleDeployments.id, bundleDeploymentId));

    if (state.autoPromote && firstStage.pauseMinutes > 0) {
      await this.scheduleAlarm(params.hostname, firstStage.pauseMinutes);
    }

    return state;
  }

  async advanceStage(bundleDeploymentId: string, hostname: string): Promise<RolloutState> {
    if (!hostname) throw new Error('Hostname is required');
    const db = getDb(this.env.DB);
    const state = await this.loadState(bundleDeploymentId);
    if (state.status !== 'in_progress') return state;

    // Health check before advancing
    if (state.healthCheck && this.env.ROLLOUT_HEALTH_KV) {
      const dep = await db.select({ artifactRef: deployments.artifactRef })
        .from(deployments).where(eq(deployments.id, state.deploymentId)).get();

      if (dep?.artifactRef) {
        const health = await getErrorRate(this.env.ROLLOUT_HEALTH_KV, dep.artifactRef, 5);
        if (health.totalRequests >= state.healthCheck.minRequests &&
            health.errorRate > state.healthCheck.errorRateThreshold) {
          return this.revertAndFail(bundleDeploymentId, hostname, state,
            `Error rate ${(health.errorRate * 100).toFixed(1)}% exceeds threshold ${(state.healthCheck.errorRateThreshold * 100).toFixed(1)}%`);
        }
      }
    }

    const nextIndex = state.currentStageIndex + 1;
    if (nextIndex >= state.stages.length) {
      return this.completeRollout(bundleDeploymentId, hostname, state);
    }

    const nextStage = state.stages[nextIndex];
    const dep = await db.select({ id: deployments.id, artifactRef: deployments.artifactRef })
      .from(deployments).where(eq(deployments.id, state.deploymentId)).get();
    if (!dep?.artifactRef) throw new Error('Deployment artifact not found');

    const active = await this.getActiveDeployment(state.serviceId, state.deploymentId);
    if (!active?.artifactRef) throw new Error('No active deployment to split traffic with');

    await this.updateRoutingWeights(hostname, {
      activeRef: active.artifactRef,
      activeDeploymentId: active.id,
      activeWeight: 100 - nextStage.weight,
      canaryRef: dep.artifactRef,
      canaryDeploymentId: dep.id,
      canaryWeight: nextStage.weight,
    });

    await db.update(deployments).set({ routingWeight: nextStage.weight })
      .where(eq(deployments.id, state.deploymentId));

    state.currentStageIndex = nextIndex;
    state.stageEnteredAt = new Date().toISOString();
    await this.saveState(bundleDeploymentId, state);

    if (state.autoPromote && nextStage.pauseMinutes > 0) {
      await this.scheduleAlarm(hostname, nextStage.pauseMinutes);
    }

    return state;
  }

  async pauseRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState> {
    if (!hostname) throw new Error('Hostname is required');
    const state = await this.loadState(bundleDeploymentId);
    state.status = 'paused';
    await this.saveState(bundleDeploymentId, state);
    await this.cancelAlarm(hostname);
    return state;
  }

  async resumeRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState> {
    if (!hostname) throw new Error('Hostname is required');
    const state = await this.loadState(bundleDeploymentId);
    state.status = 'in_progress';
    await this.saveState(bundleDeploymentId, state);
    const stage = state.stages[state.currentStageIndex];
    if (state.autoPromote && stage.pauseMinutes > 0) {
      await this.scheduleAlarm(hostname, stage.pauseMinutes);
    }
    return state;
  }

  async abortRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState> {
    if (!hostname) throw new Error('Hostname is required');
    const state = await this.loadState(bundleDeploymentId);
    return this.revertAndFail(bundleDeploymentId, hostname, state, undefined, 'aborted');
  }

  async promoteRollout(bundleDeploymentId: string, hostname: string): Promise<RolloutState> {
    if (!hostname) throw new Error('Hostname is required');
    const state = await this.loadState(bundleDeploymentId);
    return this.completeRollout(bundleDeploymentId, hostname, state);
  }

  async getRolloutState(bundleDeploymentId: string): Promise<RolloutState | null> {
    const db = getDb(this.env.DB);
    const bundle = await db.select({ rolloutState: bundleDeployments.rolloutState })
      .from(bundleDeployments).where(eq(bundleDeployments.id, bundleDeploymentId)).get();
    if (!bundle?.rolloutState) return null;
    try {
      return JSON.parse(bundle.rolloutState) as RolloutState;
    } catch {
      return null;
    }
  }

  // --- Private ---

  private async completeRollout(bundleDeploymentId: string, hostname: string, state: RolloutState): Promise<RolloutState> {
    const db = getDb(this.env.DB);
    const dep = await db.select({ id: deployments.id, artifactRef: deployments.artifactRef })
      .from(deployments).where(eq(deployments.id, state.deploymentId)).get();

    if (dep?.artifactRef) {
      // Route 100% to the new deployment
      await upsertHostnameRouting({
        env: this.env,
        hostname,
        target: {
          type: 'deployments',
          deployments: [{ routeRef: dep.artifactRef, weight: 100, deploymentId: dep.id, status: 'active' }],
        },
      });
    }

    // Archive old active deployments (excluding the one being promoted)
    await db.update(deployments).set({ routingStatus: 'archived', routingWeight: 0 })
      .where(and(
        eq(deployments.serviceId, state.serviceId),
        eq(deployments.routingStatus, 'active'),
        ne(deployments.id, state.deploymentId),
      ));

    // Promote canary → active
    await db.update(deployments).set({ routingStatus: 'active', routingWeight: 100 })
      .where(eq(deployments.id, state.deploymentId));

    state.status = 'completed';
    state.currentStageIndex = state.stages.length - 1;
    await this.saveState(bundleDeploymentId, state);
    await this.cancelAlarm(hostname);
    return state;
  }

  private async revertAndFail(
    bundleDeploymentId: string,
    hostname: string,
    state: RolloutState,
    reason?: string,
    status: 'failed' | 'aborted' = 'failed',
  ): Promise<RolloutState> {
    const db = getDb(this.env.DB);
    const active = await this.getActiveDeployment(state.serviceId, state.deploymentId);

    if (active?.artifactRef) {
      await upsertHostnameRouting({
        env: this.env,
        hostname,
        target: {
          type: 'deployments',
          deployments: [{ routeRef: active.artifactRef, weight: 100, deploymentId: active.id, status: 'active' }],
        },
      });
    } else {
      // No active deployment to revert to — archive canary but can't fix routing
      // This is a degraded state; log but don't throw
    }

    await db.update(deployments).set({ routingStatus: 'archived', routingWeight: 0 })
      .where(eq(deployments.id, state.deploymentId));

    state.status = status;
    if (reason) {
      (state as RolloutState & { failReason?: string }).failReason = reason;
    }
    await this.saveState(bundleDeploymentId, state);
    await this.cancelAlarm(hostname);
    return state;
  }

  private async loadState(bundleDeploymentId: string): Promise<RolloutState> {
    const db = getDb(this.env.DB);
    const bundle = await db.select({ rolloutState: bundleDeployments.rolloutState })
      .from(bundleDeployments).where(eq(bundleDeployments.id, bundleDeploymentId)).get();
    if (!bundle?.rolloutState) throw new Error('No active rollout found');
    try {
      return JSON.parse(bundle.rolloutState) as RolloutState;
    } catch (err) {
      throw new Error(`Failed to parse rollout state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async saveState(bundleDeploymentId: string, state: RolloutState): Promise<void> {
    const db = getDb(this.env.DB);
    await db.update(bundleDeployments).set({ rolloutState: JSON.stringify(state) })
      .where(eq(bundleDeployments.id, bundleDeploymentId));
  }

  private async getActiveDeployment(serviceId: string, excludeId: string) {
    const db = getDb(this.env.DB);
    return db.select({ id: deployments.id, artifactRef: deployments.artifactRef })
      .from(deployments).where(
        and(eq(deployments.serviceId, serviceId), eq(deployments.routingStatus, 'active'), ne(deployments.id, excludeId))
      ).get();
  }

  private async updateRoutingWeights(hostname: string, params: {
    activeRef: string; activeDeploymentId?: string | null; activeWeight: number;
    canaryRef: string; canaryDeploymentId?: string | null; canaryWeight: number;
  }): Promise<void> {
    await upsertHostnameRouting({
      env: this.env,
      hostname,
      target: {
        type: 'deployments',
        deployments: [
          {
            routeRef: params.activeRef,
            weight: params.activeWeight,
            ...(params.activeDeploymentId ? { deploymentId: params.activeDeploymentId } : {}),
            status: 'active',
          },
          {
            routeRef: params.canaryRef,
            weight: params.canaryWeight,
            ...(params.canaryDeploymentId ? { deploymentId: params.canaryDeploymentId } : {}),
            status: 'canary',
          },
        ],
      },
    });
  }

  private async scheduleAlarm(hostname: string, minutes: number): Promise<void> {
    const doId = this.env.ROUTING_DO.idFromName('routing');
    const stub = this.env.ROUTING_DO.get(doId);
    await stub.fetch(new Request('https://internal/routing/rollout/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, delayMs: minutes * 60 * 1000 }),
    }));
  }

  private async cancelAlarm(hostname: string): Promise<void> {
    const doId = this.env.ROUTING_DO.idFromName('routing');
    const stub = this.env.ROUTING_DO.get(doId);
    await stub.fetch(new Request('https://internal/routing/rollout/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname }),
    }));
  }
}
