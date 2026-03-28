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

export function JobCard({
  job,
  logState,
  loadingJobId,
  onLoadLogs,
  onLoadMore,
}: JobCardProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-zinc-900 dark:text-zinc-100">{job.name}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {job.started_at ? formatDetailedRelativeDate(job.started_at) : t('notStarted')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-[11px] border rounded-full ${statusBadge(
              job.status,
              job.conclusion
            )}`}
          >
            {job.status}
          </span>
          <button
            className="flex items-center gap-1.5 px-2 py-1 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => onLoadLogs(job.id)}
            disabled={loadingJobId === job.id}
          >
            <Icons.Terminal className="w-3.5 h-3.5" />
            <span>{loadingJobId === job.id ? t('loading') : t('logs')}</span>
          </button>
        </div>
      </div>
      {job.steps && job.steps.length > 0 && (
        <div className="mt-3 space-y-1">
          {job.steps.map((step) => (
            <div key={step.number} className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{step.number}. {step.name}</span>
              <span className="uppercase">{step.status}</span>
            </div>
          ))}
        </div>
      )}
      {logState && (
        <div className="mt-3 space-y-2">
          <pre className="max-h-64 overflow-auto rounded-lg bg-black/60 p-3 text-xs text-zinc-200 whitespace-pre-wrap">
            {logState.text}
          </pre>
          {logState.hasMore && (
            <button
              className="text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400"
              onClick={() => onLoadMore(job.id)}
              disabled={loadingJobId === job.id}
            >
              {loadingJobId === job.id ? t('loading') : t('loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
