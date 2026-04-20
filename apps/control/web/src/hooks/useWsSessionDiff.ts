import { createSignal, type Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import type { Run, SessionDiff } from "../types/index.ts";

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
  handleCancel: (currentRunGetter: () => Run | null) => Promise<void>;
}

export function useWsSessionDiff({
  t,
  setError,
}: UseWsSessionDiffOptions): UseWsSessionDiffResult {
  const [sessionDiff, setSessionDiff] = createSignal<SessionDiffState | null>(
    null,
  );
  const [isMerging, setIsMerging] = createSignal(false);
  const [isCancelling, setIsCancelling] = createSignal(false);

  // The control API has no public session diff/merge endpoint in the current contract.
  const fetchSessionDiff = async (): Promise<void> => {
    setSessionDiff(null);
  };

  const loadPendingSessionDiff = async (): Promise<void> => {
    setSessionDiff(null);
  };

  const handleMerge = async (): Promise<void> => {
    setIsMerging(true);
    try {
      setSessionDiff(null);
    } finally {
      setIsMerging(false);
    }
  };

  const handleCancel = async (
    currentRunGetter: () => Run | null,
  ): Promise<void> => {
    const runToCancel = currentRunGetter();
    if (!runToCancel) return;

    setIsCancelling(true);
    try {
      const res = await rpcPath(rpc, "runs", ":id", "cancel").$post({
        param: { id: runToCancel.id },
      });
      await rpcJson(res);
    } catch {
      setError(t("networkError"));
    } finally {
      setIsCancelling(false);
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
