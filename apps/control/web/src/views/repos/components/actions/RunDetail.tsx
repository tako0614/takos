import { Icons } from '../../../../lib/Icons';
import { useI18n } from '../../../../providers/I18nProvider';
import type { WorkflowRunDetail, JobLogState } from './types';
import { statusBadge } from './types';
import { JobCard } from './JobCard';
import { Button } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';

interface RunDetailProps {
  run: WorkflowRunDetail | null;
  loadingRun: boolean;
  jobLogs: Record<string, JobLogState>;
  loadingJobId: string | null;
  onRerun: (runId: string) => void;
  onCancel: (runId: string) => void;
  onLoadLogs: (jobId: string) => void;
  onLoadMore: (jobId: string) => void;
}

export function RunDetail({
  run,
  loadingRun,
  jobLogs,
  loadingJobId,
  onRerun,
  onCancel,
  onLoadLogs,
  onLoadMore,
}: RunDetailProps) {
  const { t } = useI18n();

  return (
    <Card padding="none">
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('runDetailsTitle')}</span>
        {run && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icons.Refresh className="w-3.5 h-3.5" />}
              onClick={() => onRerun(run.id)}
            >
              {t('rerun')}
            </Button>
            {run.status !== 'completed' && run.status !== 'cancelled' && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Icons.Square className="w-3.5 h-3.5" />}
                onClick={() => onCancel(run.id)}
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        )}
      </div>
      {loadingRun && (
        <div className="flex items-center gap-3 px-4 py-6" style={{ color: 'var(--color-text-secondary)' }}>
          <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <span>{t('loadingRun')}</span>
        </div>
      )}
      {!loadingRun && !run && (
        <div className="px-4 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('selectRunToSeeDetails')}</div>
      )}
      {run && !loadingRun && (
        <div className="px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{run.workflow_path}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {run.ref || 'unknown ref'} · {run.sha?.slice(0, 7) || 'unknown sha'}
              </div>
            </div>
            <span
              className={`px-2 py-0.5 text-[11px] border rounded-full ${statusBadge(
                run.status,
                run.conclusion
              )}`}
            >
              {run.status}
            </span>
          </div>

          <div className="space-y-2">
            {run.jobs.length === 0 && (
              <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('noJobsRecorded')}</div>
            )}
            {run.jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                logState={jobLogs[job.id]}
                loadingJobId={loadingJobId}
                onLoadLogs={onLoadLogs}
                onLoadMore={onLoadMore}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
