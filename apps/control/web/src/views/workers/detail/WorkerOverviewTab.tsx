import { useI18n } from '../../../store/i18n';
import type { Worker } from '../../../types';
import { getWorkerDisplayHostname, getWorkerUrl } from '../utils/workerUtils';

export interface WorkerOverviewTabProps {
  worker: Worker;
}

export function WorkerOverviewTab({ worker }: WorkerOverviewTabProps) {
  const { t } = useI18n();
  const workerHostname = getWorkerDisplayHostname(worker);
  const workerUrl = getWorkerUrl(worker);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('hostname')}</h4>
          {workerUrl ? (
            <a href={workerUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-900 dark:text-zinc-100 hover:underline">
              {workerHostname}
            </a>
          ) : (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{workerHostname}</span>
          )}
        </div>
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('createdAt')}</h4>
          <span className="text-sm text-zinc-900 dark:text-zinc-100">{worker.created_at ? new Date(worker.created_at).toLocaleDateString() : '-'}</span>
        </div>
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('lastUpdated')}</h4>
          <span className="text-sm text-zinc-900 dark:text-zinc-100">{worker.updated_at ? new Date(worker.updated_at).toLocaleDateString() : '-'}</span>
        </div>
      </div>
    </div>
  );
}
