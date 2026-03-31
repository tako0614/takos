import { useI18n } from '../../../store/i18n.ts';
import type { Worker } from '../../../types/index.ts';
import { getWorkerDisplayHostname, getWorkerUrl } from '../utils/workerUtils.ts';

export interface WorkerOverviewTabProps {
  worker: Worker;
}

export function WorkerOverviewTab({ worker }: WorkerOverviewTabProps) {
  const { t } = useI18n();
  const workerHostname = getWorkerDisplayHostname(worker);
  const workerUrl = getWorkerUrl(worker);

  return (
    <div class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('hostname')}</h4>
          {workerUrl ? (
            <a href={workerUrl} target="_blank" rel="noopener noreferrer" class="text-sm text-zinc-900 dark:text-zinc-100 hover:underline">
              {workerHostname}
            </a>
          ) : (
            <span class="text-sm text-zinc-500 dark:text-zinc-400">{workerHostname}</span>
          )}
        </div>
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('createdAt')}</h4>
          <span class="text-sm text-zinc-900 dark:text-zinc-100">{worker.created_at ? new Date(worker.created_at).toLocaleDateString() : '-'}</span>
        </div>
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('lastUpdated')}</h4>
          <span class="text-sm text-zinc-900 dark:text-zinc-100">{worker.updated_at ? new Date(worker.updated_at).toLocaleDateString() : '-'}</span>
        </div>
      </div>
    </div>
  );
}
