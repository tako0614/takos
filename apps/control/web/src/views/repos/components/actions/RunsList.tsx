import { Icons } from '../../../../lib/Icons';
import { formatDetailedRelativeDate } from '../../../../lib/format';
import { useI18n } from '../../../../store/i18n';
import type { WorkflowRunSummary } from './actions-types';
import { statusBadge } from './actions-types';

interface RunsListProps {
  runs: WorkflowRunSummary[];
  selectedRunId: string | undefined;
  loadingRuns: boolean;
  runsError: string | null;
  onSelectRun: (run: WorkflowRunSummary) => void;
}

export function RunsList({
  runs,
  selectedRunId,
  loadingRuns,
  runsError,
  onSelectRun,
}: RunsListProps) {
  const { t } = useI18n();
  const hasRuns = runs.length > 0;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('recentRuns')}</span>
        {loadingRuns && <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('loading')}</span>}
      </div>
      {runsError && (
        <div className="px-4 py-6 text-sm text-zinc-700 dark:text-zinc-300">{runsError}</div>
      )}
      {!runsError && !loadingRuns && !hasRuns && (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-zinc-500 dark:text-zinc-400">
          <Icons.Terminal className="w-10 h-10" />
          <span>{t('noWorkflowRunsYet')}</span>
        </div>
      )}
      {hasRuns && (
        <div className="divide-y divide-zinc-800">
          {runs.map((run) => (
            <button
              key={run.id}
              className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors ${
                selectedRunId === run.id ? 'bg-white/5' : ''
              }`}
              onClick={() => onSelectRun(run)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {run.workflow_path}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[11px] border rounded-full ${statusBadge(
                        run.status,
                        run.conclusion
                      )}`}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {run.ref || 'unknown ref'} · {formatDetailedRelativeDate(run.created_at)}
                  </div>
                </div>
                <div className="flex flex-col items-end text-xs text-zinc-500 dark:text-zinc-400">
                  {run.run_number !== null && (
                    <span>#{run.run_number}</span>
                  )}
                  {run.actor?.name && <span>{run.actor.name}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
