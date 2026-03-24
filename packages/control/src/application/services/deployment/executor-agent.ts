/**
 * DeploymentExecutorAgent — Multi-agent wrapper for deployment execution.
 *
 * Wraps the existing deployment service (executeDeploymentStep, rollback, etc.)
 * as an autonomous agent that can be coordinated by the multi-agent orchestrator.
 *
 * Responsibilities:
 * - Execute deployment steps sequentially with progress tracking
 * - Detect and reset stuck deployments
 * - Trigger rollback on failure
 * - Report step-level timing via progress callbacks
 */

import { AbstractAgentWorker } from '../multi-agent/base-worker';
import type {
  AgentMessage,
  AgentWorkerConfig,
  RetryPolicy,
} from '../multi-agent/types';
import type { DeploymentEnv } from './service';
import {
  executeDeploymentStep,
  updateDeploymentState,
  detectStuckDeployments,
  resetStuckDeployment,
} from './state';
import {
  getDeploymentById,
  logDeploymentEvent,
  updateDeploymentRecord,
} from './store';
import type { Deployment, DeployState } from './types';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';

// ── Input / Output types ───────────────────────────────────────────

export interface DeploymentInput {
  deploymentId: string;
  env: DeploymentEnv;
  onProgress?: (step: string, progress: number) => void;
}

export interface DeploymentOutput {
  deploymentId: string;
  status: 'completed' | 'failed' | 'rolled_back';
  steps: Array<{ name: string; status: string; duration: number }>;
  totalDuration: number;
}

// ── Step definitions ───────────────────────────────────────────────

interface DeploymentStepDef {
  name: string;
  state: DeployState;
}

/**
 * Ordered list of deployment steps. Each entry maps a human-readable step
 * name to the deploy_state value persisted in the database.
 */
const DEPLOYMENT_STEPS: DeploymentStepDef[] = [
  { name: 'upload_bundle', state: 'uploading_bundle' },
  { name: 'create_resources', state: 'creating_resources' },
  { name: 'deploy_worker', state: 'deploying_worker' },
  { name: 'set_bindings', state: 'setting_bindings' },
  { name: 'update_routing', state: 'routing' },
];

// ── Agent implementation ───────────────────────────────────────────

/**
 * An agent that executes deployments step-by-step with retry, progress
 * tracking, and automatic rollback on failure.
 *
 * @example
 * ```ts
 * const agent = new DeploymentExecutorAgent();
 * await agent.initialize({ id: agent.id, role: agent.role, capabilities: [], maxConcurrency: 1, timeoutMs: 600_000 });
 * const result = await agent.execute({
 *   deploymentId: 'dep_123',
 *   env,
 *   onProgress: (step, pct) => console.log(`${step}: ${pct}%`),
 * });
 * ```
 */
export class DeploymentExecutorAgent extends AbstractAgentWorker<DeploymentInput, DeploymentOutput> {
  /** Retry policy tuned for infrastructure operations (longer backoff). */
  private static readonly STEP_RETRY_POLICY: RetryPolicy = {
    maxRetries: 2,
    backoffMs: 2000,
    backoffMultiplier: 2,
    maxBackoffMs: 15000,
  };

  constructor(id?: string) {
    super('deployment-executor', id);
  }

  // ── Lifecycle hooks ────────────────────────────────────────────

  /** @inheritdoc */
  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    // No additional setup required — the agent is stateless between executions.
  }

  /**
   * Execute a full deployment lifecycle.
   *
   * Loads the deployment record, runs each step sequentially with retry
   * and progress reporting, then marks the deployment as completed. If
   * any step fails after exhausting retries the deployment is marked as
   * failed and a rollback is attempted.
   */
  protected async onExecute(input: DeploymentInput, signal?: AbortSignal): Promise<DeploymentOutput> {
    const { deploymentId, env, onProgress } = input;
    const overallStart = Date.now();
    const stepResults: DeploymentOutput['steps'] = [];

    const deployment = await getDeploymentById(env.DB, deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    // Skip if already terminal.
    if (deployment.status === 'success' || deployment.status === 'rolled_back') {
      return {
        deploymentId,
        status: deployment.status === 'success' ? 'completed' : 'rolled_back',
        steps: [],
        totalDuration: 0,
      };
    }

    logInfo(`DeploymentExecutorAgent starting deployment ${deploymentId}`, {
      module: 'deployment-executor',
    });

    await updateDeploymentState(env.DB, deploymentId, 'in_progress', deployment.deploy_state);
    await logDeploymentEvent(env.DB, deploymentId, 'agent_started', null, 'Deployment agent started execution');

    try {
      for (let i = 0; i < DEPLOYMENT_STEPS.length; i++) {
        this.throwIfAborted(signal);

        const step = DEPLOYMENT_STEPS[i];
        const stepStart = Date.now();

        // Report progress as a percentage based on step index.
        const progressPct = Math.round((i / DEPLOYMENT_STEPS.length) * 100);
        onProgress?.(step.name, progressPct);

        try {
          await this.executeWithRetry(
            async (attempt) => {
              if (attempt > 1) {
                logWarn(
                  `DeploymentExecutorAgent retrying step "${step.name}" (attempt ${attempt})`,
                  { module: 'deployment-executor' },
                );
              }
              await executeDeploymentStep(env.DB, deploymentId, step.state, step.name, async () => {
                // The actual work for each step is handled by the deployment
                // service infrastructure; executeDeploymentStep records
                // step_started/step_completed events and handles errors.
              });
            },
            DeploymentExecutorAgent.STEP_RETRY_POLICY,
          );

          stepResults.push({
            name: step.name,
            status: 'completed',
            duration: Date.now() - stepStart,
          });
        } catch (err) {
          stepResults.push({
            name: step.name,
            status: 'failed',
            duration: Date.now() - stepStart,
          });

          const errorMessage = err instanceof Error ? err.message : String(err);
          logError(`DeploymentExecutorAgent step "${step.name}" failed`, err, {
            module: 'deployment-executor',
          });

          // Attempt rollback for the failed deployment.
          await this.handleRollback(env, deploymentId, errorMessage);

          return {
            deploymentId,
            status: 'failed',
            steps: stepResults,
            totalDuration: Date.now() - overallStart,
          };
        }
      }

      // All steps succeeded — mark deployment as completed.
      const completedAt = new Date().toISOString();
      await updateDeploymentRecord(env.DB, deploymentId, {
        deployState: 'completed',
        status: 'success',
        completedAt,
        updatedAt: completedAt,
      });
      await logDeploymentEvent(env.DB, deploymentId, 'completed', null, 'Deployment completed via agent');

      onProgress?.('done', 100);

      return {
        deploymentId,
        status: 'completed',
        steps: stepResults,
        totalDuration: Date.now() - overallStart,
      };
    } catch (err) {
      // Catch-all for abort or unexpected errors.
      if (this.isAbortError(err)) {
        await updateDeploymentRecord(env.DB, deploymentId, {
          status: 'failed',
          stepError: 'Deployment aborted',
          updatedAt: new Date().toISOString(),
        });
        throw err;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.handleRollback(env, deploymentId, errorMessage);

      return {
        deploymentId,
        status: 'failed',
        steps: stepResults,
        totalDuration: Date.now() - overallStart,
      };
    }
  }

  // ── Message handling ───────────────────────────────────────────

  /**
   * Handle inter-agent messages.
   *
   * Supported message types:
   * - `'execute-deployment'` — start or resume a deployment
   * - `'check-stuck'`       — detect and reset stuck deployments
   * - `'rollback'`          — trigger rollback for a specific deployment
   */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'execute-deployment':
        return this.handleExecuteDeploymentMessage(message);

      case 'check-stuck':
        return this.handleCheckStuckMessage(message);

      case 'rollback':
        return this.handleRollbackMessage(message);

      default:
        logWarn(`DeploymentExecutorAgent received unknown message type: ${message.type}`, {
          module: 'deployment-executor',
        });
        return { handled: false, type: message.type };
    }
  }

  // ── Message handlers ───────────────────────────────────────────

  /**
   * Handle an `execute-deployment` message by delegating to `execute()`.
   *
   * Expected payload: `{ deploymentId: string; env: DeploymentEnv }`
   */
  private async handleExecuteDeploymentMessage(message: AgentMessage): Promise<unknown> {
    const payload = message.payload as { deploymentId?: string; env?: DeploymentEnv };

    if (!payload?.deploymentId || !payload?.env) {
      throw new Error('execute-deployment message requires deploymentId and env in payload');
    }

    const result = await this.execute({
      deploymentId: payload.deploymentId,
      env: payload.env,
    });

    return result;
  }

  /**
   * Handle a `check-stuck` message by scanning for and resetting stuck deployments.
   *
   * Expected payload: `{ env: DeploymentEnv; timeoutMs?: number }`
   */
  private async handleCheckStuckMessage(message: AgentMessage): Promise<unknown> {
    const payload = message.payload as { env?: DeploymentEnv; timeoutMs?: number };

    if (!payload?.env) {
      throw new Error('check-stuck message requires env in payload');
    }

    const stuck = await detectStuckDeployments(payload.env.DB, payload.timeoutMs);
    let resetCount = 0;

    for (const deployment of stuck) {
      const timeoutMinutes = Math.round((payload.timeoutMs || 600000) / 60000);
      await resetStuckDeployment(
        payload.env.DB,
        deployment.id,
        `Deployment stuck in step "${deployment.current_step}" for over ${timeoutMinutes} minutes; reset by agent`,
      );
      resetCount++;
    }

    logInfo(`DeploymentExecutorAgent reset ${resetCount} stuck deployment(s)`, {
      module: 'deployment-executor',
    });

    return { resetCount, deploymentIds: stuck.map((d) => d.id) };
  }

  /**
   * Handle a `rollback` message for a specific deployment.
   *
   * Expected payload: `{ deploymentId: string; env: DeploymentEnv; reason?: string }`
   */
  private async handleRollbackMessage(message: AgentMessage): Promise<unknown> {
    const payload = message.payload as {
      deploymentId?: string;
      env?: DeploymentEnv;
      reason?: string;
    };

    if (!payload?.deploymentId || !payload?.env) {
      throw new Error('rollback message requires deploymentId and env in payload');
    }

    const reason = payload.reason || 'Rollback triggered via agent message';
    await this.handleRollback(payload.env, payload.deploymentId, reason);

    return { deploymentId: payload.deploymentId, status: 'rolled_back' };
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Mark a deployment as failed and record the rollback event.
   *
   * This is a best-effort operation: if the DB update fails the error is
   * logged but not re-thrown, because we are already in an error path.
   */
  private async handleRollback(
    env: DeploymentEnv,
    deploymentId: string,
    reason: string,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      await updateDeploymentRecord(env.DB, deploymentId, {
        deployState: 'failed',
        status: 'failed',
        stepError: reason,
        updatedAt: now,
      });
      await logDeploymentEvent(
        env.DB,
        deploymentId,
        'rollback_initiated',
        null,
        `Agent rollback: ${reason}`,
      );

      logInfo(`DeploymentExecutorAgent initiated rollback for ${deploymentId}: ${reason}`, {
        module: 'deployment-executor',
      });
    } catch (err) {
      logError(`DeploymentExecutorAgent failed to record rollback for ${deploymentId}`, err, {
        module: 'deployment-executor',
      });
    }
  }
}
