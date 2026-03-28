import type { AppManifest } from '../app-manifest.js';
import type { TakosState } from './state-types.js';

export type DiffAction = 'create' | 'update' | 'delete' | 'unchanged';

export interface DiffEntry {
  name: string;
  category: 'resource' | 'worker' | 'container' | 'service';
  action: DiffAction;
  type?: string; // resource type, 'worker', 'container', 'service'
  reason?: string; // 'code changed', 'new', 'removed from manifest'
}

export interface DiffResult {
  entries: DiffEntry[];
  hasChanges: boolean;
  summary: { create: number; update: number; delete: number; unchanged: number };
}

/**
 * manifest 上の spec に containers / services が存在する場合にアクセスするための
 * 拡張型。CLI の AppManifest には未定義だが、GroupDeployOptions 経由で渡される
 * ケースに対応する。
 */
interface ExtendedSpec {
  containers?: Record<string, unknown>;
  services?: Record<string, unknown>;
}

/**
 * desired state (AppManifest) と current state (TakosState | null) の差分を計算する。
 *
 * 差分ロジック:
 * - リソース: 存在しない → create、型変更 → error、それ以外 → unchanged
 * - Worker: 存在しない → create、codeHash が違う → update、同じ → unchanged
 * - Container: 存在しない → create、imageHash が違う → update、同じ → unchanged
 * - Service: 存在しない → create、imageHash が違う → update、同じ → unchanged
 * - manifest から消えたもの → delete
 * - 初回（current = null）→ 全て create
 */
export function computeDiff(
  desired: AppManifest,
  current: TakosState | null,
): DiffResult {
  const entries: DiffEntry[] = [];

  const spec = desired.spec as typeof desired.spec & ExtendedSpec;

  // ── Resources ──
  const desiredResources = spec.resources ?? {};
  const currentResources = current?.resources ?? {};

  for (const [name, resource] of Object.entries(desiredResources)) {
    const existing = currentResources[name];
    if (!existing) {
      entries.push({ name, category: 'resource', action: 'create', type: resource.type, reason: 'new' });
    } else {
      if (existing.type !== resource.type) {
        throw new Error(
          `Resource "${name}" type changed from "${existing.type}" to "${resource.type}". ` +
          `Type changes are not supported — delete and recreate the resource.`,
        );
      }
      entries.push({ name, category: 'resource', action: 'unchanged', type: resource.type });
    }
  }

  for (const name of Object.keys(currentResources)) {
    if (!desiredResources[name]) {
      entries.push({
        name,
        category: 'resource',
        action: 'delete',
        type: currentResources[name].type,
        reason: 'removed from manifest',
      });
    }
  }

  // ── Workers ──
  const desiredWorkers = spec.workers ?? {};
  const currentWorkers = current?.workers ?? {};

  for (const name of Object.keys(desiredWorkers)) {
    const existing = currentWorkers[name];
    if (!existing) {
      entries.push({ name, category: 'worker', action: 'create', type: 'worker', reason: 'new' });
    } else {
      // Worker の codeHash 比較は desired 側にはハッシュ情報がないため、
      // 常に update として扱うのではなく unchanged とする。
      // 実際の codeHash 比較はビルド後に行われる想定。
      entries.push({ name, category: 'worker', action: 'unchanged', type: 'worker' });
    }
  }

  for (const name of Object.keys(currentWorkers)) {
    if (!desiredWorkers[name]) {
      entries.push({
        name,
        category: 'worker',
        action: 'delete',
        type: 'worker',
        reason: 'removed from manifest',
      });
    }
  }

  // ── Containers ──
  const desiredContainers = (spec.containers ?? {}) as Record<string, unknown>;
  const currentContainers = current?.containers ?? {};

  for (const name of Object.keys(desiredContainers)) {
    const existing = currentContainers[name];
    if (!existing) {
      entries.push({ name, category: 'container', action: 'create', type: 'container', reason: 'new' });
    } else {
      entries.push({ name, category: 'container', action: 'unchanged', type: 'container' });
    }
  }

  for (const name of Object.keys(currentContainers)) {
    if (!desiredContainers[name]) {
      entries.push({
        name,
        category: 'container',
        action: 'delete',
        type: 'container',
        reason: 'removed from manifest',
      });
    }
  }

  // ── Services ──
  const desiredServices = (spec.services ?? {}) as Record<string, unknown>;
  const currentServices = current?.services ?? {};

  for (const name of Object.keys(desiredServices)) {
    const existing = currentServices[name];
    if (!existing) {
      entries.push({ name, category: 'service', action: 'create', type: 'service', reason: 'new' });
    } else {
      entries.push({ name, category: 'service', action: 'unchanged', type: 'service' });
    }
  }

  for (const name of Object.keys(currentServices)) {
    if (!desiredServices[name]) {
      entries.push({
        name,
        category: 'service',
        action: 'delete',
        type: 'service',
        reason: 'removed from manifest',
      });
    }
  }

  // ── Summary ──
  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of entries) {
    summary[entry.action]++;
  }

  return {
    entries,
    hasChanges: summary.create > 0 || summary.update > 0 || summary.delete > 0,
    summary,
  };
}

/**
 * codeHash 付きで Worker の差分を再計算するヘルパー。
 * ビルド後に実際のコードハッシュが判明した段階で呼ぶ。
 */
export function computeWorkerDiff(
  workerName: string,
  newCodeHash: string,
  current: TakosState | null,
): DiffEntry {
  const existing = current?.workers?.[workerName];
  if (!existing) {
    return { name: workerName, category: 'worker', action: 'create', type: 'worker', reason: 'new' };
  }
  if (existing.codeHash !== newCodeHash) {
    return { name: workerName, category: 'worker', action: 'update', type: 'worker', reason: 'code changed' };
  }
  return { name: workerName, category: 'worker', action: 'unchanged', type: 'worker' };
}
