import { createSignal, type Setter } from 'solid-js';
import type { TranslationKey } from '../store/i18n';
import { rpc, rpcJson, rpcPath, sessionDiff as fetchSessionDiffRpc, sessionMerge } from '../lib/rpc';
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
  setSessionDiff: Setter<SessionDiffState | null>;
  fetchSessionDiff: (sessionId: string) => Promise<void>;
  loadPendingSessionDiff: (pending: PendingSessionDiffSummary | null) => Promise<void>;
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
  const [sessionDiff, setSessionDiff] = createSignal<SessionDiffState | null>(null);
  const [isMerging, setIsMerging] = createSignal(false);
  const [isCancelling, setIsCancelling] = createSignal(false);

  const fetchSessionDiff = async (sessionId: string): Promise<void> => {
    try {
      const res = await fetchSessionDiffRpc(sessionId);
      const data = await rpcJson<SessionDiff>(res);
      if (data.changes.length > 0) {
        setSessionDiff({ sessionId, diff: data });
      }
    } catch (err) {
      console.debug('Failed to fetch session diff:', err);
    }
  };

  const loadPendingSessionDiff = async (pending: PendingSessionDiffSummary | null): Promise<void> => {
    if (!pending?.sessionId) {
      setSessionDiff(null);
      return;
    }
    await fetchSessionDiff(pending.sessionId);
  };

  const handleMerge = async (): Promise<void> => {
    const currentSessionDiff = sessionDiff();
    if (!currentSessionDiff) return;

    const { sessionId, diff } = currentSessionDiff;
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
  };

  const handleCancel = async (currentRunGetter: () => Run | null): Promise<void> => {
    const runToCancel = currentRunGetter();
    if (!runToCancel) return;

    setIsCancelling(true);
    try {
      const res = await rpcPath(rpc, 'runs', ':id', 'cancel').$post({
        param: { id: runToCancel.id },
      }) as Response;
      await rpcJson(res);
    } catch {
      setError(t('networkError'));
    } finally {
      setIsCancelling(false);
    }
  };

  const dismissSessionDiff = (): void => {
    setSessionDiff(null);
  };

  return {
    get sessionDiff() { return sessionDiff(); },
    setSessionDiff,
    fetchSessionDiff,
    loadPendingSessionDiff,
    get isMerging() { return isMerging(); },
    handleMerge,
    get isCancelling() { return isCancelling(); },
    setIsCancelling,
    handleCancel,
    dismissSessionDiff,
  };
}
