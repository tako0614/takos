import { getDb } from "../../../infra/db/index.ts";
import { bundleDeployments, deployments } from "../../../infra/db/schema.ts";
import { and, eq, ne } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { getErrorRate } from "./rollout-health.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export interface RolloutSpec {
  strategy: "staged" | "immediate";
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
  status: "in_progress" | "paused" | "completed" | "aborted" | "failed";
  currentStageIndex: number;
  stages: Array<{ weight: number; pauseMinutes: number }>;
  healthCheck: { errorRateThreshold: number; minRequests: number } | null;
  autoPromote: boolean;
  stageEnteredAt: string;
  deploymentId: string;
  serviceId: string;
  /**
   * Monotonic optimistic-concurrency version. Bumped on every persisted
   * mutation and used for a compare-and-swap UPDATE so concurrent advances
   * across Worker isolates cannot double-apply a stage (see `saveState` /
   * `advanceStage`). Optional rows are treated as version 0.
   */
  stateVersion?: number;
  /** Human-readable reason recorded when a rollout fails or aborts. */
  failReason?: string;
  /**
   * Set when a rollout failed/aborted but the hostname routing could not be
   * reverted (no prior active deployment to route to). Signals operators that
   * live routing may still point at the archived canary.
   */
  routingUnrecovered?: boolean;
}
import { upsertHostnameRouting } from "../routing/service.ts";

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

function ensureFinalStage(
  stages: Array<{ weight: number; pauseMinutes: number }>,
): typeof stages {
  if (stages.length === 0) return DEFAULT_STAGES;
  const last = stages[stages.length - 1];
  if (last.weight !== 100) {
    return [...stages, { weight: 100, pauseMinutes: 0 }];
  }
  return stages;
}

/**
 * In-process per-rollout-id serialization. This is a best-effort latency/retry
 * optimization ONLY: it collapses concurrent advances within a single Worker
 * isolate so they don't waste CAS retries against each other. It is NOT the
 * correctness guard.
 *
 * The actual cross-isolate guard is the optimistic-concurrency CAS in
 * `saveState`: each advance reads `stateVersion`, computes the next state, and
 * persists with `UPDATE ... WHERE id = ? AND state_version = ?` (expressed via
 * a compare-and-swap on the serialized rollout_state). On Cloudflare Workers
 * this Map is per-isolate and serializes nothing across isolates/replicas, so
 * two advances on different isolates can still race — but only one CAS wins;
 * the loser observes 0 rows changed, re-reads the freshly committed state, and
 * advances from the correct index (or no-ops if already advanced). The map
 * entry is cleaned up once the chain drains to avoid unbounded growth.
 */
const advanceStageLocks = new Map<string, Promise<unknown>>();

function withAdvanceStageLock<T>(
  bundleDeploymentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = advanceStageLocks.get(bundleDeploymentId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  // Track the chain so subsequent calls queue behind it. Clean up the entry
  // when this link is the tail, so the map does not grow without bound.
  const tracked = next
    .catch(() => {})
    .finally(() => {
      if (advanceStageLocks.get(bundleDeploymentId) === tracked) {
        advanceStageLocks.delete(bundleDeploymentId);
      }
    });
  advanceStageLocks.set(bundleDeploymentId, tracked);
  return next;
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
    if (!params.hostname) {
      throw new Error("Hostname is required to initiate rollout");
    }

    const db = getDb(this.env.DB);
    const stages = ensureFinalStage(
      rolloutSpec.stages?.length ? rolloutSpec.stages : DEFAULT_STAGES,
    );
    const healthCheck = rolloutSpec.healthCheck ?? DEFAULT_HEALTH_CHECK;
    const firstStage = stages[0];

    const state: RolloutState = {
      status: "in_progress",
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

    await db
      .update(deployments)
      .set({
        routingStatus: "canary",
        routingWeight: firstStage.weight,
      })
      .where(eq(deployments.id, deploymentId));

    await db
      .update(bundleDeployments)
      .set({
        rolloutState: JSON.stringify(state),
      })
      .where(eq(bundleDeployments.id, bundleDeploymentId));

    if (state.autoPromote && firstStage.pauseMinutes > 0) {
      await this.scheduleAlarm(params.hostname, firstStage.pauseMinutes);
    }

    return state;
  }

  /**
   * Advance the rollout by one stage. Correctness against concurrent advances
   * (e.g. a user-triggered advance racing an alarm-driven auto-promote on a
   * different isolate) is enforced by the optimistic-concurrency CAS in
   * `saveState`, retried here on conflict. The in-isolate `withAdvanceStageLock`
   * is only a latency optimization to avoid same-isolate CAS thrash.
   */
  advanceStage(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<RolloutState> {
    return withAdvanceStageLock(bundleDeploymentId, () =>
      this.advanceStageWithRetry(bundleDeploymentId, hostname),
    );
  }

  private async advanceStageWithRetry(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<RolloutState> {
    // Bounded retry loop: on a CAS conflict another writer advanced first, so
    // we re-read the committed state and retry from the correct index. The
    // bound prevents an unbounded spin under pathological contention.
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.advanceStageLocked(
        bundleDeploymentId,
        hostname,
      );
      if (!result.conflict) return result.state;
    }
    throw new Error(
      `advanceStage: optimistic-concurrency conflict persisted after ${maxAttempts} attempts for rollout ${bundleDeploymentId}`,
    );
  }

  private async advanceStageLocked(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<{ state: RolloutState; conflict: boolean }> {
    if (!hostname) throw new Error("Hostname is required");
    const db = getDb(this.env.DB);
    const { state, raw: expectedRaw } =
      await this.loadStateRaw(bundleDeploymentId);
    if (state.status !== "in_progress") return { state, conflict: false };

    // Health check before advancing
    if (state.healthCheck && this.env.ROLLOUT_HEALTH_KV) {
      const dep = await db
        .select({ artifactRef: deployments.artifactRef })
        .from(deployments)
        .where(eq(deployments.id, state.deploymentId))
        .get();

      if (dep?.artifactRef) {
        const health = await getErrorRate(
          this.env.ROLLOUT_HEALTH_KV,
          dep.artifactRef,
          5,
        );
        if (
          health.totalRequests >= state.healthCheck.minRequests &&
          health.errorRate > state.healthCheck.errorRateThreshold
        ) {
          const reverted = await this.revertAndFail(
            bundleDeploymentId,
            hostname,
            state,
            `Error rate ${(health.errorRate * 100).toFixed(
              1,
            )}% exceeds threshold ${(
              state.healthCheck.errorRateThreshold * 100
            ).toFixed(1)}%`,
          );
          return { state: reverted, conflict: false };
        }
      }
    }

    const nextIndex = state.currentStageIndex + 1;
    if (nextIndex >= state.stages.length) {
      const completed = await this.completeRollout(
        bundleDeploymentId,
        hostname,
        state,
      );
      return { state: completed, conflict: false };
    }

    const nextStage = state.stages[nextIndex];
    const dep = await db
      .select({
        id: deployments.id,
        artifactRef: deployments.artifactRef,
      })
      .from(deployments)
      .where(eq(deployments.id, state.deploymentId))
      .get();
    if (!dep?.artifactRef) throw new Error("Deployment artifact not found");

    const active = await this.getActiveDeployment(
      state.serviceId,
      state.deploymentId,
    );
    if (!active?.artifactRef) {
      throw new Error("No active deployment to split traffic with");
    }

    // Claim the stage transition atomically BEFORE applying any routing side
    // effects. If the compare-and-swap loses (another isolate advanced first),
    // we have made no routing/deployment changes and the caller retries from
    // the freshly committed state.
    const nextState: RolloutState = {
      ...state,
      currentStageIndex: nextIndex,
      stageEnteredAt: new Date().toISOString(),
    };
    const swapped = await this.saveState(
      bundleDeploymentId,
      nextState,
      expectedRaw,
    );
    if (!swapped) {
      return { state, conflict: true };
    }

    await this.updateRoutingWeights(hostname, {
      activeRef: active.artifactRef,
      activeDeploymentId: active.id,
      activeWeight: 100 - nextStage.weight,
      canaryRef: dep.artifactRef,
      canaryDeploymentId: dep.id,
      canaryWeight: nextStage.weight,
    });

    await db
      .update(deployments)
      .set({ routingWeight: nextStage.weight })
      .where(eq(deployments.id, state.deploymentId));

    if (nextState.autoPromote && nextStage.pauseMinutes > 0) {
      await this.scheduleAlarm(hostname, nextStage.pauseMinutes);
    }

    return { state: nextState, conflict: false };
  }

  async pauseRollout(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<RolloutState> {
    if (!hostname) throw new Error("Hostname is required");
    const state = await this.loadState(bundleDeploymentId);
    state.status = "paused";
    await this.saveState(bundleDeploymentId, state);
    await this.cancelAlarm(hostname);
    return state;
  }

  async resumeRollout(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<RolloutState> {
    if (!hostname) throw new Error("Hostname is required");
    const state = await this.loadState(bundleDeploymentId);
    state.status = "in_progress";
    await this.saveState(bundleDeploymentId, state);
    const stage = state.stages[state.currentStageIndex];
    if (state.autoPromote && stage.pauseMinutes > 0) {
      await this.scheduleAlarm(hostname, stage.pauseMinutes);
    }
    return state;
  }

  async abortRollout(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<RolloutState> {
    if (!hostname) throw new Error("Hostname is required");
    const state = await this.loadState(bundleDeploymentId);
    return this.revertAndFail(
      bundleDeploymentId,
      hostname,
      state,
      undefined,
      "aborted",
    );
  }

  async promoteRollout(
    bundleDeploymentId: string,
    hostname: string,
  ): Promise<RolloutState> {
    if (!hostname) throw new Error("Hostname is required");
    const state = await this.loadState(bundleDeploymentId);
    return this.completeRollout(bundleDeploymentId, hostname, state);
  }

  async getRolloutState(
    bundleDeploymentId: string,
  ): Promise<RolloutState | null> {
    const db = getDb(this.env.DB);
    const bundle = await db
      .select({
        rolloutState: bundleDeployments.rolloutState,
      })
      .from(bundleDeployments)
      .where(eq(bundleDeployments.id, bundleDeploymentId))
      .get();
    if (!bundle?.rolloutState) return null;
    try {
      return JSON.parse(bundle.rolloutState) as RolloutState;
    } catch {
      return null;
    }
  }

  // --- Private ---

  private async completeRollout(
    bundleDeploymentId: string,
    hostname: string,
    state: RolloutState,
  ): Promise<RolloutState> {
    const db = getDb(this.env.DB);
    const dep = await db
      .select({
        id: deployments.id,
        artifactRef: deployments.artifactRef,
      })
      .from(deployments)
      .where(eq(deployments.id, state.deploymentId))
      .get();

    if (dep?.artifactRef) {
      // Route 100% to the new deployment
      await upsertHostnameRouting({
        env: this.env,
        hostname,
        target: {
          type: "deployments",
          deployments: [
            {
              routeRef: dep.artifactRef,
              weight: 100,
              deploymentId: dep.id,
              status: "active",
            },
          ],
        },
      });
    }

    // Archive old active deployments (excluding the one being promoted)
    await db
      .update(deployments)
      .set({
        routingStatus: "archived",
        routingWeight: 0,
      })
      .where(
        and(
          eq(deployments.serviceId, state.serviceId),
          eq(deployments.routingStatus, "active"),
          ne(deployments.id, state.deploymentId),
        ),
      );

    // Promote canary → active
    await db
      .update(deployments)
      .set({
        routingStatus: "active",
        routingWeight: 100,
      })
      .where(eq(deployments.id, state.deploymentId));

    state.status = "completed";
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
    status: "failed" | "aborted" = "failed",
  ): Promise<RolloutState> {
    const db = getDb(this.env.DB);
    const active = await this.getActiveDeployment(
      state.serviceId,
      state.deploymentId,
    );

    if (active?.artifactRef) {
      await upsertHostnameRouting({
        env: this.env,
        hostname,
        target: {
          type: "deployments",
          deployments: [
            {
              routeRef: active.artifactRef,
              weight: 100,
              deploymentId: active.id,
              status: "active",
            },
          ],
        },
      });
    }

    await db
      .update(deployments)
      .set({
        routingStatus: "archived",
        routingWeight: 0,
      })
      .where(eq(deployments.id, state.deploymentId));

    state.status = status;
    if (reason) {
      state.failReason = reason;
    }
    if (!active?.artifactRef) {
      // No prior active deployment to revert traffic to (e.g. the canary was
      // the first deployment for this service). We archived the canary, but the
      // hostname routing record may still point at it, leaving the service in a
      // degraded routing state that needs operator attention. Surface it via a
      // distinct fail reason and a warning log instead of reporting a clean
      // failure.
      const degradedReason =
        "rollout failed and routing could not be reverted: no prior active deployment to route to";
      state.failReason = reason
        ? `${reason}; ${degradedReason}`
        : degradedReason;
      state.routingUnrecovered = true;
      logWarn("Rollout reverted with unrecovered routing", {
        module: "rollout",
        bundleDeploymentId,
        hostname,
        serviceId: state.serviceId,
        deploymentId: state.deploymentId,
        reason: reason ?? null,
      });
    }
    await this.saveState(bundleDeploymentId, state);
    await this.cancelAlarm(hostname);
    return state;
  }

  private async loadState(bundleDeploymentId: string): Promise<RolloutState> {
    return (await this.loadStateRaw(bundleDeploymentId)).state;
  }

  /**
   * Loads the rollout state along with the exact serialized string currently
   * stored, so callers can pass it back to `saveState` as the compare-and-swap
   * precondition for cross-isolate optimistic concurrency.
   */
  private async loadStateRaw(
    bundleDeploymentId: string,
  ): Promise<{ state: RolloutState; raw: string }> {
    const db = getDb(this.env.DB);
    const bundle = await db
      .select({
        rolloutState: bundleDeployments.rolloutState,
      })
      .from(bundleDeployments)
      .where(eq(bundleDeployments.id, bundleDeploymentId))
      .get();
    if (!bundle?.rolloutState) throw new Error("No active rollout found");
    try {
      return {
        state: JSON.parse(bundle.rolloutState) as RolloutState,
        raw: bundle.rolloutState,
      };
    } catch (err) {
      throw new Error(
        `Failed to parse rollout state: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Persists rollout state, bumping the monotonic `stateVersion`.
   *
   * When `expectedRaw` is provided, the write is a compare-and-swap: it only
   * succeeds if the stored `rollout_state` still equals the exact string the
   * caller read. SQLite/D1 execute the single `UPDATE` atomically, so this is
   * a real cross-isolate guard — concurrent advances cannot both commit.
   * Returns `true` if the row was written, `false` on a CAS miss. Without
   * `expectedRaw` the write is unconditional (last-writer-wins), used for
   * terminal/user-driven transitions (pause/resume/complete/abort) that are
   * not subject to the double-advance race.
   */
  private async saveState(
    bundleDeploymentId: string,
    state: RolloutState,
    expectedRaw?: string,
  ): Promise<boolean> {
    const db = getDb(this.env.DB);
    const next: RolloutState = {
      ...state,
      stateVersion: (state.stateVersion ?? 0) + 1,
    };
    const serialized = JSON.stringify(next);
    if (expectedRaw === undefined) {
      await db
        .update(bundleDeployments)
        .set({ rolloutState: serialized })
        .where(eq(bundleDeployments.id, bundleDeploymentId));
      // Reflect the persisted version back to the caller's object.
      state.stateVersion = next.stateVersion;
      return true;
    }
    const result = await db
      .update(bundleDeployments)
      .set({
        rolloutState: serialized,
      })
      .where(
        and(
          eq(bundleDeployments.id, bundleDeploymentId),
          eq(bundleDeployments.rolloutState, expectedRaw),
        ),
      );
    const changed = affectedRowCount(result) > 0;
    if (changed) {
      state.stateVersion = next.stateVersion;
    }
    return changed;
  }

  private async getActiveDeployment(serviceId: string, excludeId: string) {
    const db = getDb(this.env.DB);
    return db
      .select({
        id: deployments.id,
        artifactRef: deployments.artifactRef,
      })
      .from(deployments)
      .where(
        and(
          eq(deployments.serviceId, serviceId),
          eq(deployments.routingStatus, "active"),
          ne(deployments.id, excludeId),
        ),
      )
      .get();
  }

  private async updateRoutingWeights(
    hostname: string,
    params: {
      activeRef: string;
      activeDeploymentId?: string | null;
      activeWeight: number;
      canaryRef: string;
      canaryDeploymentId?: string | null;
      canaryWeight: number;
    },
  ): Promise<void> {
    await upsertHostnameRouting({
      env: this.env,
      hostname,
      target: {
        type: "deployments",
        deployments: [
          {
            routeRef: params.activeRef,
            weight: params.activeWeight,
            ...(params.activeDeploymentId
              ? { deploymentId: params.activeDeploymentId }
              : {}),
            status: "active",
          },
          {
            routeRef: params.canaryRef,
            weight: params.canaryWeight,
            ...(params.canaryDeploymentId
              ? { deploymentId: params.canaryDeploymentId }
              : {}),
            status: "canary",
          },
        ],
      },
    });
  }

  private async scheduleAlarm(
    hostname: string,
    minutes: number,
  ): Promise<void> {
    const namespace = this.routingDoOrThrow("scheduleAlarm");
    const doId = namespace.idFromName("routing");
    const stub = namespace.get(doId);
    await stub.fetch(
      new Request("https://internal/routing/rollout/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname, delayMs: minutes * 60 * 1000 }),
      }),
    );
  }

  private async cancelAlarm(hostname: string): Promise<void> {
    const namespace = this.routingDoOrThrow("cancelAlarm");
    const doId = namespace.idFromName("routing");
    const stub = namespace.get(doId);
    await stub.fetch(
      new Request("https://internal/routing/rollout/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname }),
      }),
    );
  }

  private routingDoOrThrow(operation: string): NonNullable<Env["ROUTING_DO"]> {
    const namespace = this.env.ROUTING_DO;
    if (!namespace) {
      throw new Error(
        `RolloutService.${operation}: ROUTING_DO binding is not configured`,
      );
    }
    return namespace;
  }
}
