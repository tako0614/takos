import { type Accessor, createEffect, createSignal, onCleanup, type Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import type { Run, SessionDiff } from "../types/index.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";

export interface SessionDiffState {
  sessionId: string;
  diff: SessionDiff;
}

export interface PendingSessionDiffSummary {
  sessionId: string;
  sessionStatus: string;
  git_mode: boolean;
}

export interface UseWsSessionDiffOptions {
  threadId: Accessor<string>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setError: (value: string | null) => void;
}

export interface UseWsSessionDiffResult {
  sessionDiff: SessionDiffState | null;
  setSessionDiff: Setter<SessionDiffState | null>;
  fetchSessionDiff: (sessionId: string) => Promise<void>;
  loadPendingSessionDiff: (
    pending: PendingSessionDiffSummary | null,
  ) => Promise<void>;
  isMerging: boolean;
  handleMerge: () => Promise<void>;
  dismissSessionDiff: () => void;
  isCancelling: boolean;
  setIsCancelling: Setter<boolean>;
  handleCancel: (currentRunGetter: () => Run | null, isCurrent?: () => boolean) => Promise<void>;
}

export function useWsSessionDiff({
  threadId,
  t,
  setError,
}: UseWsSessionDiffOptions): UseWsSessionDiffResult {
  const [sessionDiff, setSessionDiff] = createSignal<SessionDiffState | null>(
    null,
  );
  const [isMerging, setIsMerging] = createSignal(false);
  const [isCancelling, setIsCancelling] = createSignal(false);
  const cancelRequests = createLatestRequest();
  createEffect(() => {
    threadId();
    cancelRequests.next();
    setIsCancelling(false);
  });
  onCleanup(() => { cancelRequests.next(); });

  // The control API has no public session diff/merge endpoint in the current contract.
  const fetchSessionDiff = (): Promise<void> => {
    setSessionDiff(null);
    return Promise.resolve();
  };

  const loadPendingSessionDiff = (): Promise<void> => {
    setSessionDiff(null);
    return Promise.resolve();
  };

  const handleMerge = (): Promise<void> => {
    setIsMerging(true);
    try {
      setSessionDiff(null);
    } finally {
      setIsMerging(false);
    }
    return Promise.resolve();
  };

  const handleCancel = async (
    currentRunGetter: () => Run | null,
    isCurrent?: () => boolean,
  ): Promise<void> => {
    const runToCancel = currentRunGetter();
    if (!runToCancel) return;
    const currentThreadId = threadId();
    const claim = cancelRequests.claim(() => threadId() === currentThreadId && isCurrent?.() !== false);

    setIsCancelling(true);
    try {
      const res = await rpcPath(rpc, "runs", ":id", "cancel").$post({
        param: { id: runToCancel.id },
      });
      await rpcJson(res, { isCurrent: claim.won });
    } catch {
      if (claim.won()) setError(t("networkError"));
    } finally {
      if (claim.won()) setIsCancelling(false);
    }
  };

  const dismissSessionDiff = (): void => {
    setSessionDiff(null);
  };

  return {
    get sessionDiff() {
      return sessionDiff();
    },
    setSessionDiff,
    fetchSessionDiff,
    loadPendingSessionDiff,
    get isMerging() {
      return isMerging();
    },
    handleMerge,
    get isCancelling() {
      return isCancelling();
    },
    setIsCancelling,
    handleCancel,
    dismissSessionDiff,
  };
}
