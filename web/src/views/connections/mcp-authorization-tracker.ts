import type { McpServerRecord } from "../../types/index.ts";

export type McpAuthorizationTargetKind = "direct" | "import";

export interface McpAuthorizationTarget {
  key: string;
  kind: McpAuthorizationTargetKind;
  name: string;
  authorizationUrl: string;
  isReady: (server: McpServerRecord) => boolean;
}

export interface McpAuthorizationTrackerState {
  spaceId: string;
  pending: readonly McpAuthorizationTarget[];
  checking: boolean;
  exhausted: boolean;
}

export interface McpAuthorizationTracker {
  add(spaceId: string, targets: readonly McpAuthorizationTarget[]): void;
  retry(): Promise<boolean>;
  cancel(): void;
}

interface McpAuthorizationTrackerOptions {
  currentSpaceId: () => string;
  refresh: () => Promise<void>;
  servers: () => readonly McpServerRecord[];
  onStateChange: (state: McpAuthorizationTrackerState) => void;
  onAllComplete: () => void;
  intervalMs?: number;
  maxAttempts?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_MAX_ATTEMPTS = 60;

export function createMcpAuthorizationTracker(
  options: McpAuthorizationTrackerOptions,
): McpAuthorizationTracker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const setTimer = options.setTimer ?? globalThis.setTimeout;
  const clearTimer = options.clearTimer ?? globalThis.clearTimeout;
  let generation = 0;
  let spaceId = "";
  let pending: McpAuthorizationTarget[] = [];
  let checking = false;
  let exhausted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = () => {
    options.onStateChange({
      spaceId,
      pending: [...pending],
      checking,
      exhausted,
    });
  };

  const clearScheduledCheck = () => {
    if (timer === undefined) return;
    clearTimer(timer);
    timer = undefined;
  };

  const isCurrent = (targetGeneration: number) =>
    targetGeneration === generation &&
    spaceId.length > 0 &&
    options.currentSpaceId().trim() === spaceId;

  const schedule = (targetGeneration: number, completedAttempts: number) => {
    clearScheduledCheck();
    if (!isCurrent(targetGeneration) || pending.length === 0) return;
    if (completedAttempts >= maxAttempts) {
      exhausted = true;
      checking = false;
      emit();
      return;
    }
    timer = setTimer(() => {
      timer = undefined;
      void check(targetGeneration, completedAttempts + 1);
    }, intervalMs);
  };

  const check = async (
    targetGeneration: number,
    completedAttempts: number,
  ): Promise<boolean> => {
    if (!isCurrent(targetGeneration) || pending.length === 0 || checking) {
      return false;
    }
    checking = true;
    exhausted = false;
    emit();
    try {
      await options.refresh();
    } catch {
      // Inventory owns its visible retryable error. Authorization polling keeps
      // the current targets and tries again within its bounded cadence.
    }
    if (!isCurrent(targetGeneration)) return false;

    const currentServers = options.servers();
    pending = pending.filter(
      (target) => !currentServers.some((server) => target.isReady(server)),
    );
    checking = false;
    if (pending.length === 0) {
      clearScheduledCheck();
      spaceId = "";
      emit();
      options.onAllComplete();
      return true;
    }
    emit();
    schedule(targetGeneration, completedAttempts);
    return true;
  };

  const cancel = () => {
    generation += 1;
    clearScheduledCheck();
    spaceId = "";
    pending = [];
    checking = false;
    exhausted = false;
    emit();
  };

  const add = (
    targetSpaceId: string,
    targets: readonly McpAuthorizationTarget[],
  ) => {
    const normalizedSpaceId = targetSpaceId.trim();
    if (
      !normalizedSpaceId ||
      normalizedSpaceId !== options.currentSpaceId().trim() ||
      targets.length === 0
    ) return;

    generation += 1;
    clearScheduledCheck();
    const existing = spaceId === normalizedSpaceId ? pending : [];
    const merged = new Map(existing.map((target) => [target.key, target]));
    for (const target of targets) merged.set(target.key, target);
    spaceId = normalizedSpaceId;
    pending = [...merged.values()];
    checking = false;
    exhausted = false;
    emit();
    schedule(generation, 0);
  };

  const retry = async (): Promise<boolean> => {
    if (
      checking ||
      pending.length === 0 ||
      !spaceId ||
      options.currentSpaceId().trim() !== spaceId
    ) return false;
    generation += 1;
    clearScheduledCheck();
    exhausted = false;
    return check(generation, 0);
  };

  emit();
  return { add, retry, cancel };
}
