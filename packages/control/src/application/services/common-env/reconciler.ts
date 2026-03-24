import type { Env } from '../../../shared/types';
import { normalizeEnvName } from './crypto';
import type { CommonEnvReconcileTrigger } from './reconcile-jobs';
import { CommonEnvRepository } from './repository';
import { resolveServiceCommonEnvState } from '../platform/worker-desired-state';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

export class CommonEnvReconciler {
  constructor(
    private readonly env: Env,
    private readonly repo: CommonEnvRepository
  ) {}

  private async listServiceLinks(spaceId: string, serviceId: string) {
    const repo = this.repo as CommonEnvRepository & {
      listServiceLinks?: (spaceId: string, serviceId: string) => Promise<Array<{ id: string; env_name: string; source: string; sync_state: string; sync_reason: string | null; }>>;
      listWorkerLinks?: (spaceId: string, workerId: string) => Promise<Array<{ id: string; env_name: string; source: string; sync_state: string; sync_reason: string | null; }>>;
    };
    return repo.listServiceLinks?.(spaceId, serviceId)
      ?? repo.listWorkerLinks?.(spaceId, serviceId)
      ?? [];
  }

  async markServiceLinksApplyFailed(params: {
    spaceId: string;
    serviceId: string;
    targetKeys?: Set<string>;
    error: unknown;
  }): Promise<void> {
    const rows = await this.listServiceLinks(params.spaceId, params.serviceId);
    const targetKeys = params.targetKeys && params.targetKeys.size > 0
      ? new Set(Array.from(params.targetKeys.values()).map((key) => normalizeEnvName(key)))
      : null;

    if (rows.length === 0) return;

    const message = errorMessage(params.error);
    for (const row of rows) {
      const key = normalizeEnvName(row.env_name);
      if (targetKeys && !targetKeys.has(key)) continue;
      await this.repo.updateLinkRuntime({
        rowId: row.id,
        syncState: 'error',
        syncReason: 'apply_failed',
        lastSyncError: message,
      });
    }
  }

  async reconcileServiceCommonEnv(
    spaceId: string,
    serviceId: string,
    options?: {
      targetKeys?: Set<string>;
      trigger?: CommonEnvReconcileTrigger;
    }
  ): Promise<void> {
    void options?.trigger;

    const service = await this.repo.getService(spaceId, serviceId);
    if (!service) return;

    const targetKeys = options?.targetKeys && options.targetKeys.size > 0
      ? new Set(Array.from(options.targetKeys.values()).map((key) => normalizeEnvName(key)))
      : null;

    const resolved = await resolveServiceCommonEnvState(this.env, spaceId, serviceId);
    const linkRows = targetKeys ? await this.listServiceLinks(spaceId, serviceId) : [];
    const rowIdToKey = new Map(linkRows.map((row) => [row.id, normalizeEnvName(row.env_name)]));

    for (const update of resolved.commonEnvUpdates) {
      if (targetKeys) {
        const key = rowIdToKey.get(update.rowId) || null;
        if (!key || !targetKeys.has(key)) {
          continue;
        }
      }

      await this.repo.updateLinkRuntime(update);
    }
  }

  async markWorkerLinksApplyFailed(params: {
    spaceId: string;
    workerId: string;
    targetKeys?: Set<string>;
    error: unknown;
  }): Promise<void> {
    await this.markServiceLinksApplyFailed({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      targetKeys: params.targetKeys,
      error: params.error,
    });
  }

  async reconcileWorkerCommonEnv(
    spaceId: string,
    workerId: string,
    options?: {
      targetKeys?: Set<string>;
      trigger?: CommonEnvReconcileTrigger;
    }
  ): Promise<void> {
    await this.reconcileServiceCommonEnv(spaceId, workerId, options);
  }
}

export { CommonEnvReconciler as ServiceCommonEnvReconciler };
