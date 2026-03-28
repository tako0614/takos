import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env, IndexJobQueueMessage } from '../../../shared/types';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import type { AgentContext } from '../agent/agent-models';
import type { ActivationResult, Claim, Evidence, ToolObserver } from './graph-models';
import { RunOverlay } from './overlay';
import {
  getActiveClaims,
  getPathsForClaim,
  countEvidenceForClaims,
  upsertClaim,
  insertEvidence,
} from './claim-store';
import { buildActivationBundles, renderActivationSegment } from './activation';
import { createToolObserver } from './observer';
import { generateId } from '../../../shared/utils';
import { logWarn } from '../../../shared/utils/logger';

const EMPTY_ACTIVATION: ActivationResult = { bundles: [], segment: '', hasContent: false };

export interface AgentMemoryBackend {
  bootstrap(): Promise<ActivationResult>;
  finalize(input: {
    claims: Claim[];
    evidence: Evidence[];
  }): Promise<void>;
}

export class AgentMemoryRuntime {
  private db: D1Database;
  private context: AgentContext;
  private env: Env;
  private overlay = new RunOverlay();
  private cachedActivation: ActivationResult | null = null;
  private lastOverlayClaimCount = 0;
  private lastOverlayEvidenceCount = 0;
  private overlayActivationCache: ActivationResult | null = null;
  private backend?: AgentMemoryBackend;

  constructor(db: D1Database, context: AgentContext, env: Env, backend?: AgentMemoryBackend) {
    this.db = db;
    this.context = context;
    this.env = env;
    this.backend = backend;
  }

  async bootstrap(): Promise<ActivationResult> {
    if (this.backend) {
      try {
        this.cachedActivation = await this.backend.bootstrap();
        return this.cachedActivation;
      } catch (err) {
        logWarn('Remote memory graph bootstrap failed, continuing without activation', {
          module: 'memory-graph',
          detail: err,
        });
        this.cachedActivation = EMPTY_ACTIVATION;
        return this.cachedActivation;
      }
    }

    try {
      const claims = await getActiveClaims(this.db, this.context.spaceId, 50);
      if (claims.length === 0) {
        this.cachedActivation = EMPTY_ACTIVATION;
        return this.cachedActivation;
      }

      const claimIds = claims.map(c => c.id);
      const topClaims = claims.slice(0, 20);

      const [evidenceCounts, pathsArrays] = await Promise.all([
        countEvidenceForClaims(this.db, claimIds),
        Promise.all(
          topClaims.map(c => getPathsForClaim(this.db, this.context.spaceId, c.id, 5)),
        ),
      ]);

      const pathsByClaim = new Map<string, typeof pathsArrays[0]>();
      for (let i = 0; i < topClaims.length; i++) {
        if (pathsArrays[i].length > 0) {
          pathsByClaim.set(topClaims[i].id, pathsArrays[i]);
        }
      }

      const bundles = buildActivationBundles(claims, evidenceCounts, pathsByClaim);
      this.cachedActivation = renderActivationSegment(bundles);
      return this.cachedActivation;
    } catch (err) {
      logWarn('Memory graph bootstrap failed, continuing without activation', {
        module: 'memory-graph',
        detail: err,
      });
      this.cachedActivation = EMPTY_ACTIVATION;
      return this.cachedActivation;
    }
  }

  beforeModel(): ActivationResult {
    const currentOverlayClaims = this.overlay.claimCount;
    const currentOverlayEvidence = this.overlay.evidenceCount;

    // Fast path: no overlay changes since last call (check both claims and evidence)
    if (
      currentOverlayClaims === this.lastOverlayClaimCount &&
      currentOverlayEvidence === this.lastOverlayEvidenceCount &&
      this.overlayActivationCache
    ) {
      return this.overlayActivationCache;
    }

    // Fast path: no overlay data at all
    if (currentOverlayClaims === 0 && currentOverlayEvidence === 0) {
      return this.cachedActivation ?? EMPTY_ACTIVATION;
    }

    // Merge bootstrap claims with overlay claims
    const bootstrapClaims = this.cachedActivation?.bundles.map(b => b.claim) ?? [];
    const overlayClaims = this.overlay.getAllClaims();

    // Overlay claims take priority (by subject match), then sort by confidence desc
    const claimMap = new Map<string, Claim>();
    for (const c of bootstrapClaims) {
      claimMap.set(c.id, c);
    }
    // Track superseded claim IDs to transfer their evidence counts
    const supersededMap = new Map<string, string>(); // oldId -> newId
    for (const c of overlayClaims) {
      // Overlay claims may supersede bootstrap claims with same subject+predicate
      const existingKey = [...claimMap.values()].find(
        e => e.subject === c.subject && e.predicate === c.predicate,
      );
      if (existingKey) {
        supersededMap.set(existingKey.id, c.id);
        claimMap.delete(existingKey.id);
      }
      claimMap.set(c.id, c);
    }

    const merged = [...claimMap.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 50);

    // Build evidence counts from bootstrap + overlay, transferring counts for superseded claims
    const evidenceCounts = new Map<string, number>();
    if (this.cachedActivation) {
      for (const bundle of this.cachedActivation.bundles) {
        const targetId = supersededMap.get(bundle.claim.id) ?? bundle.claim.id;
        evidenceCounts.set(targetId, (evidenceCounts.get(targetId) ?? 0) + bundle.evidenceCount);
      }
    }
    const overlayEvidence = this.overlay.getAllEvidence();
    for (const ev of overlayEvidence) {
      evidenceCounts.set(ev.claimId, (evidenceCounts.get(ev.claimId) ?? 0) + 1);
    }

    const bundles = buildActivationBundles(merged, evidenceCounts, new Map());
    this.overlayActivationCache = renderActivationSegment(bundles);
    this.lastOverlayClaimCount = currentOverlayClaims;
    this.lastOverlayEvidenceCount = currentOverlayEvidence;

    return this.overlayActivationCache;
  }

  createToolObserver(): ToolObserver {
    return createToolObserver(this.context.spaceId, this.context.runId, this.overlay);
  }

  async finalize(): Promise<void> {
    try {
      if (this.backend) {
        const claims = this.overlay.getAllClaims();
        const evidence = this.overlay.getAllEvidence();
        if (claims.length > 0 || evidence.length > 0) {
          await this.backend.finalize({ claims, evidence });
          this.overlay.clear();
        }
        await this.enqueuePathBuildJob();
        return;
      }

      await this.flushOverlay();
      await this.enqueuePathBuildJob();
    } catch (err) {
      logWarn('Memory graph finalize failed', { module: 'memory-graph', detail: err });
    }
  }

  private async flushOverlay(): Promise<void> {
    const claims = this.overlay.getAllClaims();
    const evidence = this.overlay.getAllEvidence();

    if (claims.length === 0 && evidence.length === 0) return;

    for (const claim of claims) await upsertClaim(this.db, claim);
    for (const ev of evidence) await insertEvidence(this.db, ev);

    this.overlay.clear();
  }

  private async enqueuePathBuildJob(): Promise<void> {
    if (!this.env.INDEX_QUEUE) return;

    try {
      await this.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: this.context.spaceId,
        type: 'memory_build_paths',
        targetId: this.context.runId,
        timestamp: Date.now(),
      } satisfies IndexJobQueueMessage);
    } catch (err) {
      logWarn('Failed to enqueue memory_build_paths job', {
        module: 'memory-graph',
        detail: err,
      });
    }
  }
}
