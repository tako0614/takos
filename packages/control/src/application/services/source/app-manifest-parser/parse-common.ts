import type {
  LifecycleHooks,
  LifecycleHook,
  UpdateStrategy,
} from '../app-manifest-types.ts';
import { asRecord, asString, asRequiredString } from '../app-manifest-utils.ts';

// ============================================================
// Semver validation
// ============================================================

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;

export function validateSemver(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`spec.version must be valid semver (got "${version}")`);
  }
}

// ============================================================
// Lifecycle hooks parser
// ============================================================

export function parseLifecycle(specRecord: Record<string, unknown>): LifecycleHooks | undefined {
  const raw = specRecord.lifecycle;
  if (!raw) return undefined;
  const record = asRecord(raw);
  const parseHook = (hookRaw: unknown, name: string): LifecycleHook | undefined => {
    if (!hookRaw) return undefined;
    const hook = asRecord(hookRaw);
    return {
      command: asRequiredString(hook.command, `spec.lifecycle.${name}.command`),
      ...(hook.timeoutSeconds != null ? { timeoutSeconds: Number(hook.timeoutSeconds) } : {}),
      ...(hook.sandbox != null ? { sandbox: Boolean(hook.sandbox) } : {}),
    };
  };
  return {
    ...(record.preApply ? { preApply: parseHook(record.preApply, 'preApply') } : {}),
    ...(record.postApply ? { postApply: parseHook(record.postApply, 'postApply') } : {}),
  };
}

// ============================================================
// Update strategy parser
// ============================================================

export function parseUpdateStrategy(specRecord: Record<string, unknown>): UpdateStrategy | undefined {
  const raw = specRecord.update;
  if (!raw) return undefined;
  const record = asRecord(raw);
  const strategy = asString(record.strategy, 'spec.update.strategy');
  if (strategy && !['rolling', 'canary', 'blue-green', 'recreate'].includes(strategy)) {
    throw new Error('spec.update.strategy must be rolling, canary, blue-green, or recreate');
  }
  return {
    ...(strategy ? { strategy: strategy as UpdateStrategy['strategy'] } : {}),
    ...(record.canaryWeight != null ? { canaryWeight: Number(record.canaryWeight) } : {}),
    ...(record.healthCheck ? { healthCheck: String(record.healthCheck) } : {}),
    ...(record.rollbackOnFailure != null ? { rollbackOnFailure: Boolean(record.rollbackOnFailure) } : {}),
    ...(record.timeoutSeconds != null ? { timeoutSeconds: Number(record.timeoutSeconds) } : {}),
  };
}

// ============================================================
// dependsOn validation helper
// ============================================================

export function validateDependsOn(
  dependsOn: string[] | undefined,
  prefix: string,
  allNames: Set<string>,
): void {
  if (!dependsOn) return;
  for (const dep of dependsOn) {
    if (!allNames.has(dep)) {
      throw new Error(`${prefix}.dependsOn references unknown target: ${dep}`);
    }
  }
}
