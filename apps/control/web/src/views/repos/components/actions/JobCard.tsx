import { Show, For } from 'solid-js';
import { Icons } from '../../../../lib/Icons';
import { formatDetailedRelativeDate } from '../../../../lib/format';
import { useI18n } from '../../../../store/i18n';
import type { WorkflowJob, JobLogState } from './actions-types';
import { statusBadge } from './actions-types';

interface JobCardProps {
  job: WorkflowJob;
  logState: JobLogState | undefined;
  loadingJobId: string | null;
  onLoadLogs: (jobId: string) => void;
  onLoadMore: (jobId: string) => void;
}

export function JobCard(props: JobCardProps) {
  const { t } = useI18n();

  return (
    <div class="rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-sm text-zinc-900 dark:text-zinc-100">{props.job.name}</div>
          <div class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {props.job.started_at ? formatDetailedRelativeDate(props.job.started_at) : t('notStarted')}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            class={`px-2 py-0.5 text-[11px] border rounded-full ${statusBadge(
              props.job.status,
              props.job.conclusion
            )}`}
          >
            {props.job.status}
          </span>
          <button
            class="flex items-center gap-1.5 px-2 py-1 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => props.onLoadLogs(props.job.id)}
            disabled={props.loadingJobId === props.job.id}
          >
            <Icons.Terminal class="w-3.5 h-3.5" />
            <span>{props.loadingJobId === props.job.id ? t('loading') : t('logs')}</span>
          </button>
        </div>
      </div>
      <Show when={props.job.steps && props.job.steps.length > 0}>
        <div class="mt-3 space-y-1">
          <For each={props.job.steps}>{(step) => (
            <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{step.number}. {step.name}</span>
              <span class="uppercase">{step.status}</span>
            </div>
          )}</For>
        </div>
      </Show>
      <Show when={props.logState}>
        {(logState) => (
          <div class="mt-3 space-y-2">
            <pre class="max-h-64 overflow-auto rounded-lg bg-black/60 p-3 text-xs text-zinc-200 whitespace-pre-wrap">
              {logState().text}
            </pre>
            <Show when={logState().hasMore}>
              <button
                class="text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400"
                onClick={() => props.onLoadMore(props.job.id)}
                disabled={props.loadingJobId === props.job.id}
              >
                {props.loadingJobId === props.job.id ? t('loading') : t('loadMore')}
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
