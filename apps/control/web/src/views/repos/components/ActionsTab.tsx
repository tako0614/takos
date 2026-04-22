import { createEffect, createSignal, on } from "solid-js";
import { Show } from "solid-js";
import { Icons } from "../../../lib/Icons.tsx";
import { useToast } from "../../../store/toast.ts";
import { useConfirmDialog } from "../../../store/confirm-dialog.ts";
import { useI18n } from "../../../store/i18n.ts";
import {
  type JobLogState,
  LOG_CHUNK_BYTES,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
} from "./actions/actions-types.ts";
import { DispatchWorkflowForm } from "./actions/DispatchWorkflowForm.tsx";
import { RunsList } from "./actions/RunsList.tsx";
import { RunDetail } from "./actions/RunDetail.tsx";
import { rpc, rpcJson } from "../../../lib/rpc.ts";

interface ActionsTabProps {
  repoId: string;
}

export function ActionsTab(props: ActionsTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [runs, setRuns] = createSignal<WorkflowRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = createSignal(true);
  const [runsError, setRunsError] = createSignal<string | null>(null);
  const [selectedRun, setSelectedRun] = createSignal<WorkflowRunDetail | null>(
    null,
  );
  const [loadingRun, setLoadingRun] = createSignal(false);
  const [jobLogs, setJobLogs] = createSignal<Record<string, JobLogState>>({});
  const [loadingJobId, setLoadingJobId] = createSignal<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = createSignal(false);
  const [workflowPath, setWorkflowPath] = createSignal("");
  const [workflowRef, setWorkflowRef] = createSignal("");
  const [workflowInputs, setWorkflowInputs] = createSignal("");
  const [dispatching, setDispatching] = createSignal(false);
  let runsSeq = 0;
  let runDetailSeq = 0;

  const selectedRunId = () => selectedRun()?.id;

  const fetchRuns = async () => {
    const repoId = props.repoId;
    const seq = ++runsSeq;
    try {
      setLoadingRuns(true);
      setRunsError(null);
      const res = await rpc.repos[":repoId"].actions.runs.$get({
        param: { repoId },
        query: { limit: "25" },
      });
      const data = await rpcJson<{ runs?: WorkflowRunSummary[] }>(res);
      if (seq !== runsSeq || repoId !== props.repoId) return;
      setRuns(data.runs || []);
    } catch (err) {
      if (seq !== runsSeq || repoId !== props.repoId) return;
      setRunsError(
        err instanceof Error ? err.message : "Failed to fetch workflow runs",
      );
    } finally {
      if (seq === runsSeq && repoId === props.repoId) {
        setLoadingRuns(false);
      }
    }
  };

  createEffect(on(() => props.repoId, () => {
    fetchRuns();
  }));

  const fetchRunDetail = async (runId: string) => {
    const repoId = props.repoId;
    const seq = ++runDetailSeq;
    try {
      setLoadingRun(true);
      const res = await rpc.repos[":repoId"].actions.runs[":runId"].$get({
        param: { repoId, runId },
      });
      const data = await rpcJson<{ run: WorkflowRunDetail }>(res);
      if (seq !== runDetailSeq || repoId !== props.repoId) return;
      setSelectedRun(data.run);
    } catch (err) {
      if (seq !== runDetailSeq || repoId !== props.repoId) return;
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToLoad"),
      );
    } finally {
      if (seq === runDetailSeq && repoId === props.repoId) {
        setLoadingRun(false);
      }
    }
  };

  const handleSelectRun = (run: WorkflowRunSummary) => {
    setSelectedRun(null);
    setJobLogs({});
    fetchRunDetail(run.id);
  };

  const handleCancelRun = async (runId: string) => {
    const ok = await confirm({
      title: t("cancelWorkflowRun"),
      message: t("cancelRunMessage"),
      confirmText: t("cancelRunButton"),
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await rpc.repos[":repoId"].actions.runs[":runId"].cancel
        .$post({
          param: { repoId: props.repoId, runId },
        });
      await rpcJson(res);
      showToast("success", t("runCancelled"));
      await fetchRuns();
      if (selectedRunId() === runId) {
        await fetchRunDetail(runId);
      }
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToCancelRun"),
      );
    }
  };

  const handleRerun = async (runId: string) => {
    try {
      const res = await rpc.repos[":repoId"].actions.runs[":runId"].rerun.$post(
        {
          param: { repoId: props.repoId, runId },
        },
      );
      await rpcJson(res);
      showToast("success", t("workflowRerunQueued"));
      await fetchRuns();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToRerunWorkflow"),
      );
    }
  };

  const handleLoadLogs = async (jobId: string, offset = 0, append = false) => {
    if (jobLogs()[jobId] && offset === 0) return;
    try {
      setLoadingJobId(jobId);
      const res = await rpc.repos[":repoId"].actions.jobs[":jobId"].logs.$get({
        param: { repoId: props.repoId, jobId },
        query: { offset: String(offset), limit: String(LOG_CHUNK_BYTES) },
      });
      const data = await rpcJson<
        {
          logs?: string;
          next_offset?: number;
          has_more?: boolean;
          total_size?: number | null;
        }
      >(res);
      const logs = data.logs || "";
      setJobLogs((prev) => {
        const existing = prev[jobId];
        const text = append && existing ? `${existing.text}${logs}` : logs;
        return {
          ...prev,
          [jobId]: {
            text,
            nextOffset: data.next_offset ??
              (append && existing
                ? existing.nextOffset + logs.length
                : logs.length),
            hasMore: data.has_more ?? false,
            totalSize: data.total_size ?? existing?.totalSize ?? null,
          },
        };
      });
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToLoadLogs"),
      );
    } finally {
      setLoadingJobId(null);
    }
  };

  const handleLoadMore = (jobId: string) => {
    const logState = jobLogs()[jobId];
    if (!logState || !logState.hasMore) return;
    handleLoadLogs(jobId, logState.nextOffset, true);
  };

  const handleDispatch = async () => {
    if (!workflowPath().trim()) {
      showToast("error", t("workflowPathRequired"));
      return;
    }

    let parsedInputs: Record<string, unknown> | undefined;
    if (workflowInputs().trim()) {
      try {
        parsedInputs = JSON.parse(workflowInputs()) as Record<string, unknown>;
      } catch {
        showToast("error", t("inputsMustBeValidJson"));
        return;
      }
    }

    try {
      setDispatching(true);
      const res = await rpc.repos[":repoId"].actions.runs.$post({
        param: { repoId: props.repoId },
        json: {
          workflow: workflowPath().trim(),
          ref: workflowRef().trim() || undefined,
          inputs: parsedInputs,
        },
      });
      await rpcJson(res);
      showToast("success", t("workflowDispatched"));
      setDispatchOpen(false);
      setWorkflowInputs("");
      await fetchRuns();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToDispatchWorkflow"),
      );
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div class="flex flex-col gap-6 p-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
          <Icons.Terminal class="w-5 h-5 text-zinc-500" />
          <h3 class="text-lg font-semibold">{t("actionsTitle")}</h3>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => setDispatchOpen((prev) => !prev)}
          >
            <Icons.Play class="w-4 h-4" />
            <span>{t("runWorkflow")}</span>
          </button>
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={fetchRuns}
          >
            <Icons.Refresh class="w-4 h-4" />
            <span>{t("refresh")}</span>
          </button>
        </div>
      </div>

      <Show when={dispatchOpen()}>
        <DispatchWorkflowForm
          workflowPath={workflowPath()}
          setWorkflowPath={setWorkflowPath}
          workflowRef={workflowRef()}
          setWorkflowRef={setWorkflowRef}
          workflowInputs={workflowInputs()}
          setWorkflowInputs={setWorkflowInputs}
          dispatching={dispatching()}
          onDispatch={handleDispatch}
        />
      </Show>

      <div class="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-6">
        <RunsList
          runs={runs()}
          selectedRunId={selectedRunId()}
          loadingRuns={loadingRuns()}
          runsError={runsError()}
          onSelectRun={handleSelectRun}
        />

        <RunDetail
          run={selectedRun()}
          loadingRun={loadingRun()}
          jobLogs={jobLogs()}
          loadingJobId={loadingJobId()}
          onRerun={handleRerun}
          onCancel={handleCancelRun}
          onLoadLogs={handleLoadLogs}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  );
}
