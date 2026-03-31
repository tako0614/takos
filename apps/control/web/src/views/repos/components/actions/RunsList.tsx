import { Show, For } from 'solid-js';
import { Icons } from '../../../../lib/Icons.tsx';
import { formatDetailedRelativeDate } from '../../../../lib/format.ts';
import { useI18n } from '../../../../store/i18n.ts';
import type { WorkflowRunSummary } from './actions-types.ts';
import { statusBadge } from './actions-types.ts';

interface RunsListProps {
  runs: WorkflowRunSummary[];
  selectedRunId: string | undefined;
  loadingRuns: boolean;
  runsError: string | null;
  onSelectRun: (run: WorkflowRunSummary) => void;
}

export function RunsList(props: RunsListProps) {
  const { t } = useI18n();
  const hasRuns = () => props.runs.length > 0;

  return (
    <div class="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <span class="text-sm text-zinc-500 dark:text-zinc-400">{t('recentRuns')}</span>
        <Show when={props.loadingRuns}>
          <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('loading')}</span>
        </Show>
      </div>
      <Show when={props.runsError}>
        <div class="px-4 py-6 text-sm text-zinc-700 dark:text-zinc-300">{props.runsError}</div>
      </Show>
      <Show when={!props.runsError && !props.loadingRuns && !hasRuns()}>
        <div class="flex flex-col items-center justify-center gap-3 py-10 text-zinc-500 dark:text-zinc-400">
          <Icons.Terminal class="w-10 h-10" />
          <span>{t('noWorkflowRunsYet')}</span>
        </div>
      </Show>
      <Show when={hasRuns()}>
        <div class="divide-y divide-zinc-800">
          <For each={props.runs}>{(run) => (
            <button
              class={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors ${
                props.selectedRunId === run.id ? 'bg-white/5' : ''
              }`}
              onClick={() => props.onSelectRun(run)}
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {run.workflow_path}
                    </span>
                    <span
                      class={`px-2 py-0.5 text-[11px] border rounded-full ${statusBadge(
                        run.status,
                        run.conclusion
                      )}`}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {run.ref || 'unknown ref'} · {formatDetailedRelativeDate(run.created_at)}
                  </div>
                </div>
                <div class="flex flex-col items-end text-xs text-zinc-500 dark:text-zinc-400">
                  <Show when={run.run_number !== null}>
                    <span>#{run.run_number}</span>
                  </Show>
                  <Show when={run.actor?.name}>
                    <span>{run.actor!.name}</span>
                  </Show>
                </div>
              </div>
            </button>
          )}</For>
        </div>
      </Show>
    </div>
  );
}
