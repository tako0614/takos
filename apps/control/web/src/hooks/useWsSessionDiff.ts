import { useCallback, useState } from 'react';
import type { TranslationKey } from '../store/i18n';
import { rpc, rpcJson, sessionDiff as fetchSessionDiffRpc, sessionMerge } from '../lib/rpc';
import type { Run, SessionDiff } from '../types';

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
  setSessionDiff: React.Dispatch<React.SetStateAction<SessionDiffState | null>>;
  fetchSessionDiff: (sessionId: string) => Promise<void>;
  loadPendingSessionDiff: (pending: PendingSessionDiffSummary | null) => Promise<void>;
  isMerging: boolean;
  handleMerge: () => Promise<void>;
  dismissSessionDiff: () => void;
  isCancelling: boolean;
  setIsCancelling: React.Dispatch<React.SetStateAction<boolean>>;
  handleCancel: (currentRunGetter: () => Run | null) => Promise<void>;
}

export function useWsSessionDiff({
  t,
  setError,
}: UseWsSessionDiffOptions): UseWsSessionDiffResult {
  const [sessionDiff, setSessionDiff] = useState<SessionDiffState | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const fetchSessionDiff = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const res = await fetchSessionDiffRpc(sessionId);
      const data = await rpcJson<SessionDiff>(res);
      if (data.changes.length > 0) {
        setSessionDiff({ sessionId, diff: data });
      }
    } catch (err) {
      console.debug('Failed to fetch session diff:', err);
    }
  }, []);

  const loadPendingSessionDiff = useCallback(async (pending: PendingSessionDiffSummary | null): Promise<void> => {
    if (!pending?.sessionId) {
      setSessionDiff(null);
      return;
    }
    await fetchSessionDiff(pending.sessionId);
  }, [fetchSessionDiff]);

  const handleMerge = useCallback(async (): Promise<void> => {
    // Read sessionDiff via setState callback to get the latest value
    // without adding sessionDiff to the dependency array.
    let currentSessionDiff: SessionDiffState | null = null;
    setSessionDiff((prev) => {
      currentSessionDiff = prev;
      return prev;
    });
    if (!currentSessionDiff) return;

    const { sessionId, diff } = currentSessionDiff as SessionDiffState;
    setIsMerging(true);
    try {
      const res = await sessionMerge(sessionId, {
        expected_head: diff.workspace_head,
        use_diff3: true,
      });
      await rpcJson(res);
      setSessionDiff(null);
    } catch {
      setError(t('mergeFailed'));
    } finally {
      setIsMerging(false);
    }
  }, [t, setError]);

  const handleCancel = useCallback(async (currentRunGetter: () => Run | null): Promise<void> => {
    const runToCancel = currentRunGetter();
    if (!runToCancel) return;

    setIsCancelling(true);
    try {
      const res = await rpc.runs[':id'].cancel.$post({
        param: { id: runToCancel.id },
      });
      await rpcJson(res);
    } catch {
      setError(t('networkError'));
    } finally {
      setIsCancelling(false);
    }
  }, [t, setError]);

  const dismissSessionDiff = useCallback((): void => {
    setSessionDiff(null);
  }, []);

  return {
    sessionDiff,
    setSessionDiff,
    fetchSessionDiff,
    loadPendingSessionDiff,
    isMerging,
    handleMerge,
    isCancelling,
    setIsCancelling,
    handleCancel,
    dismissSessionDiff,
  };
}
