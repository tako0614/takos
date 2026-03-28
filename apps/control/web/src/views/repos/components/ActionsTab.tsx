import { useEffect, useState } from 'react';
import { Icons } from '../../../lib/Icons';
import { useToast } from '../../../store/toast';
import { useConfirmDialog } from '../../../store/confirm-dialog';
import { useI18n } from '../../../store/i18n';
import {
  type WorkflowRunSummary,
  type WorkflowRunDetail,
  type JobLogState,
  LOG_CHUNK_BYTES,
} from './actions/types';
import { DispatchWorkflowForm } from './actions/DispatchWorkflowForm';
import { RunsList } from './actions/RunsList';
import { RunDetail } from './actions/RunDetail';
import { rpc, rpcJson } from '../../../lib/rpc';

interface ActionsTabProps {
  repoId: string;
}

export function ActionsTab({ repoId }: ActionsTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogState>>({});
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [workflowPath, setWorkflowPath] = useState('');
  const [workflowRef, setWorkflowRef] = useState('');
  const [workflowInputs, setWorkflowInputs] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const selectedRunId = selectedRun?.id;

  useEffect(() => {
    fetchRuns();
  }, [repoId]);

  const fetchRuns = async () => {
    try {
      setLoadingRuns(true);
      setRunsError(null);
      const res = await rpc.repos[':repoId'].actions.runs.$get({
        param: { repoId },
        query: { limit: '25' },
      });
      const data = await rpcJson<{ runs?: WorkflowRunSummary[] }>(res);
      setRuns(data.runs || []);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Failed to fetch workflow runs');
    } finally {
      setLoadingRuns(false);
    }
  };

  const fetchRunDetail = async (runId: string) => {
    try {
      setLoadingRun(true);
      const res = await rpc.repos[':repoId'].actions.runs[':runId'].$get({
        param: { repoId, runId },
      });
      const data = await rpcJson<{ run: WorkflowRunDetail }>(res);
      setSelectedRun(data.run);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToLoad'));
    } finally {
      setLoadingRun(false);
    }
  };

  const handleSelectRun = (run: WorkflowRunSummary) => {
    setSelectedRun(null);
    setJobLogs({});
    fetchRunDetail(run.id);
  };

  const handleCancelRun = async (runId: string) => {
    const ok = await confirm({
      title: t('cancelWorkflowRun'),
      message: t('cancelRunMessage'),
      confirmText: t('cancelRunButton'),
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await rpc.repos[':repoId'].actions.runs[':runId'].cancel.$post({
        param: { repoId, runId },
      });
      await rpcJson(res);
      showToast('success', t('runCancelled'));
      await fetchRuns();
      if (selectedRunId === runId) {
        await fetchRunDetail(runId);
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToCancelRun'));
    }
  };

  const handleRerun = async (runId: string) => {
    try {
      const res = await rpc.repos[':repoId'].actions.runs[':runId'].rerun.$post({
        param: { repoId, runId },
      });
      await rpcJson(res);
      showToast('success', t('workflowRerunQueued'));
      await fetchRuns();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToRerunWorkflow'));
    }
  };

  const handleLoadLogs = async (jobId: string, offset = 0, append = false) => {
    if (jobLogs[jobId] && offset === 0) return;
    try {
      setLoadingJobId(jobId);
      const res = await rpc.repos[':repoId'].actions.jobs[':jobId'].logs.$get({
        param: { repoId, jobId },
        query: { offset: String(offset), limit: String(LOG_CHUNK_BYTES) },
      });
      const data = await rpcJson<{ logs?: string; next_offset?: number; has_more?: boolean; total_size?: number | null }>(res);
      const logs = data.logs || '';
      setJobLogs((prev) => {
        const existing = prev[jobId];
        const text = append && existing ? `${existing.text}${logs}` : logs;
        return {
          ...prev,
          [jobId]: {
            text,
            nextOffset: data.next_offset ?? (append && existing ? existing.nextOffset + logs.length : logs.length),
            hasMore: data.has_more ?? false,
            totalSize: data.total_size ?? existing?.totalSize ?? null,
          },
        };
      });
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToLoadLogs'));
    } finally {
      setLoadingJobId(null);
    }
  };

  const handleLoadMore = (jobId: string) => {
    const logState = jobLogs[jobId];
    if (!logState || !logState.hasMore) return;
    handleLoadLogs(jobId, logState.nextOffset, true);
  };

  const handleDispatch = async () => {
    if (!workflowPath.trim()) {
      showToast('error', t('workflowPathRequired'));
      return;
    }

    let parsedInputs: Record<string, unknown> | undefined;
    if (workflowInputs.trim()) {
      try {
        parsedInputs = JSON.parse(workflowInputs) as Record<string, unknown>;
      } catch {
        showToast('error', t('inputsMustBeValidJson'));
        return;
      }
    }

    try {
      setDispatching(true);
      const res = await rpc.repos[':repoId'].actions.runs.$post({
        param: { repoId },
        json: {
          workflow: workflowPath.trim(),
          ref: workflowRef.trim() || undefined,
          inputs: parsedInputs,
        },
      });
      await rpcJson(res);
      showToast('success', t('workflowDispatched'));
      setDispatchOpen(false);
      setWorkflowInputs('');
      await fetchRuns();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToDispatchWorkflow'));
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
          <Icons.Terminal className="w-5 h-5 text-zinc-500" />
          <h3 className="text-lg font-semibold">{t('actionsTitle')}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => setDispatchOpen((prev) => !prev)}
          >
            <Icons.Play className="w-4 h-4" />
            <span>{t('runWorkflow')}</span>
          </button>
          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={fetchRuns}
          >
            <Icons.Refresh className="w-4 h-4" />
            <span>{t('refresh')}</span>
          </button>
        </div>
      </div>

      {dispatchOpen && (
        <DispatchWorkflowForm
          workflowPath={workflowPath}
          setWorkflowPath={setWorkflowPath}
          workflowRef={workflowRef}
          setWorkflowRef={setWorkflowRef}
          workflowInputs={workflowInputs}
          setWorkflowInputs={setWorkflowInputs}
          dispatching={dispatching}
          onDispatch={handleDispatch}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-6">
        <RunsList
          runs={runs}
          selectedRunId={selectedRunId}
          loadingRuns={loadingRuns}
          runsError={runsError}
          onSelectRun={handleSelectRun}
        />

        <RunDetail
          run={selectedRun}
          loadingRun={loadingRun}
          jobLogs={jobLogs}
          loadingJobId={loadingJobId}
          onRerun={handleRerun}
          onCancel={handleCancelRun}
          onLoadLogs={handleLoadLogs}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
